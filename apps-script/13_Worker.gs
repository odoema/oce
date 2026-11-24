/**
 * 13_Worker: the collection engine. Runs inside a time budget, in rounds:
 *   lease -> fetch in parallel -> extract -> store result + candidates -> expand frontier -> flush
 * Every round is flushed, so an interrupted execution loses at most one round (and leases recover it).
 */

/**
 * @param {Object=} opts {max_seconds, max_pages, mission_id}
 * @return {Object} summary
 */
function oceRunWorker_(opts) {
  opts = opts || {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: true, skipped: 'Another worker is running' };
  var summary = { ok: true, started_at: new Date().toISOString(), rounds: 0, processed: 0, completed: 0, failed: 0, blocked: 0, skipped: 0, retried: 0, candidates: 0, queued: 0, recovered: 0 };
  try {
    oceResetTables_();
    var started = Date.now();
    var budgetMs = oceClamp_(opts.max_seconds || oceSettingNumber_('CRAWL_TICK_SECONDS', 240), 10, 330, 240) * 1000;
    var maxPages = opts.max_pages ? Number(opts.max_pages) : Infinity;
    var batchSize = oceClamp_(oceSettingNumber_('CRAWL_BATCH_SIZE', 8), 1, 20, 8);
    summary.recovered = oceRecoverStaleLeases_();
    oceFlushAll_();
    var hostState = {};
    var touched = {};

    while (Date.now() - started < budgetMs - 25000 && summary.processed < maxPages) {
      var lease = oceLeaseBatch_(Math.min(batchSize, maxPages - summary.processed), hostState, opts.mission_id || '');
      var leased = lease.picked;
      if (!leased.length) {
        // Work exists but every host is cooling down: wait briefly instead of ending the tick.
        if (lease.wait_ms > 0 && lease.wait_ms <= 30000 && Date.now() - started + lease.wait_ms < budgetMs - 25000) {
          Utilities.sleep(lease.wait_ms + 50);
          continue;
        }
        break;
      }
      oceTable_('SOURCE_QUEUE').flush();
      var outcomes = oceFetchMany_(leased.map(function (r) { return r.url; }));
      leased.forEach(function (row, i) {
        var res = oceProcessOutcome_(row, outcomes[i]);
        touched[oceQueueMissionId_(row)] = true;
        summary.processed++;
        summary.candidates += res.candidates;
        summary.queued += res.queued;
        if (res.status === 'COMPLETED') summary.completed++;
        else if (res.status === 'BLOCKED') summary.blocked++;
        else if (res.status === 'SKIPPED') summary.skipped++;
        else if (res.status === 'QUEUED') summary.retried++;
        else summary.failed++;
      });
      summary.rounds++;
      oceFlushAll_();
    }
    Object.keys(touched).forEach(function (id) { if (id) oceRefreshMission_(id); });
    if (!Object.keys(touched).length) oceRefreshAllMissions_();
    oceFlushAll_();
    summary.elapsed_ms = Date.now() - started;
    summary.active_work = oceHasPendingWork_();
    if (summary.processed) oceLog_('INFO', 'worker', 'Tick processed ' + summary.processed + ' pages', summary);
    oceFlushAll_();
    return summary;
  } catch (err) {
    oceLog_('ERROR', 'worker', String(err && err.message || err), { stack: String(err && err.stack || '').slice(0, 1500) });
    try { oceFlushAll_(); } catch (e) { /* ignore */ }
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function oceProcessOutcome_(row, outcome) {
  var missionId = oceQueueMissionId_(row);
  var mission = oceTable_('MISSIONS').get('mission_id', missionId) || { mission_id: missionId, objective: '' };
  var out = { status: '', candidates: 0, queued: 0 };
  var page = null;
  if (outcome.ok) {
    try {
      page = oceExtractPage_(outcome.html, outcome.final_url || row.url);
    } catch (err) {
      outcome.ok = false; outcome.status = 'FAILED'; outcome.error = 'Extraction failed: ' + String(err.message || err);
    }
  }
  if (page) {
    var respect = oceSettingBool_('RESPECT_ROBOTS', true);
    var xr = String(outcome.x_robots || '');
    var noindex = respect && (page.noindex || /\b(noindex|none)\b/.test(xr));
    var nofollow = respect && (page.nofollow || /\b(nofollow|none)\b/.test(xr));
    if (noindex) {
      // The site asked not to be indexed: keep no contact data from this page.
      outcome.status = 'SKIPPED';
      outcome.ok = false;
      outcome.error = 'noindex: page asks not to be indexed (contact data not collected)';
    } else {
      var candidates = outcome.pdf ? oceDocumentCandidates_(outcome, page, missionId) : oceBuildCandidates_(page, { mission_id: missionId });
      out.candidates = oceUpsertCandidates_(candidates).touched;
    }
    var depth = Number(row.depth || 0);
    var maxDepth = mission.max_depth === '' || mission.max_depth === undefined ? oceSettingNumber_('CRAWL_MAX_DEPTH', 2) : Number(mission.max_depth);
    if (depth < maxDepth && String(mission.status).toUpperCase() === 'RUNNING') {
      var sameSite = mission.same_site === '' || mission.same_site === undefined ? oceSettingBool_('CRAWL_SAME_SITE', true) : String(mission.same_site).toUpperCase() !== 'FALSE';
      if (!nofollow) {
        var links = oceScoreLinks_(page, { objective: mission.objective, same_site: sameSite }).slice(0, 40);
        var enq = oceEnqueue_(mission, links.map(function (l) {
          return { url: l.url, label: l.label, priority: Math.round(l.priority * 0.9 + (Number(row.priority) || 0) * 0.1) - depth * 5, depth: depth + 1, parent_url: row.url, source_type: 'DISCOVERED_PAGE' };
        }));
        out.queued = enq.queued;
      }
      // Seeds also contribute their site's sitemap (once per site per mission).
      if (depth === 0 && !outcome.pdf && oceSettingBool_('CRAWL_USE_SITEMAPS', true)) out.queued += oceSeedFromSitemaps_(mission, row, page, sameSite);
    }
  }
  oceSaveResult_(row, outcome, page, out.candidates);
  out.status = oceCompleteQueueItem_(row, outcome);
  return out;
}

function oceSaveResult_(row, outcome, page, candidateCount) {
  if (page && /^noindex/.test(String(outcome.error || ''))) page = { title: page.title, description: '', language: page.language, links: page.links, text: '', emails: [], phones: [], organization: '', address: '', socials: [], text_excerpt: '' };
  oceTable_('SOURCE_RESULTS').append([{
    result_id: oceUuid_(), queue_id: row.queue_id, source_id: row.source_id, mission_id: oceQueueMissionId_(row),
    url: row.url, final_url: outcome.final_url || row.url, status: outcome.ok ? 'COMPLETED' : outcome.status,
    http_status: outcome.http_status || '', content_type: String(outcome.content_type || '').split(';')[0],
    title: page ? page.title : '', description: page ? page.description : '', language: page ? page.language : '',
    collected_at: new Date(), collector_version: OCE.VERSION, fetch_ms: outcome.fetch_ms || '', bytes: outcome.bytes || '',
    link_count: page ? page.links.length : 0, table_count: 0, text_length: page ? page.text.length : 0,
    error: oceClean_(outcome.error || '', 500),
    emails: page ? page.emails.slice(0, 20).join('; ') : '', phones: page ? page.phones.slice(0, 10).join('; ') : '',
    organization: page ? page.organization : '', address: page ? page.address : '', socials: page ? page.socials.join(' ') : '',
    candidate_count: candidateCount || 0, text_excerpt: page ? page.text_excerpt : ''
  }]);
}

/** True when any RUNNING mission still has collectable work. */
function oceHasPendingWork_() {
  var running = oceRunningMissionIds_();
  if (!Object.keys(running).length) return false;
  return !!oceTable_('SOURCE_QUEUE').find(function (r) {
    var s = String(r.status).toUpperCase();
    return (s === 'QUEUED' || s === 'SCRAPING') && running[oceQueueMissionId_(r)];
  });
}

/** Ad-hoc single page analysis (no persistence). Used by the dashboard "Scan a page" tool. */
function oceScanUrl_(url) {
  var canonical = oceCanonicalUrl_(/^https?:\/\//i.test(url) ? url : 'https://' + url);
  if (!canonical) throw new Error('Invalid URL');
  var outcome = oceFetchPage_(canonical);
  var page = oceExtractPage_(outcome.html, outcome.final_url);
  return {
    url: canonical, final_url: outcome.final_url, http_status: outcome.http_status, title: page.title, description: page.description,
    organization: page.organization, address: page.address, country: page.country, location: page.location, category: page.category,
    emails: page.emails, phones: page.phones, socials: page.socials, jsonld_types: page.jsonld_types,
    candidates: outcome.pdf ? oceDocumentCandidates_(outcome, page, '') : oceBuildCandidates_(page, {}),
    document: outcome.pdf ? { name: outcome.doc_name, characters: String(outcome.text || '').length } : null, top_links: oceScoreLinks_(page, { objective: '' }).slice(0, 25),
    text_excerpt: page.text_excerpt, marketing_consent: 'NOT_ESTABLISHED'
  };
}

/** Candidates from a PDF: per-entry context for lists, page-level rules as a fallback. */
function oceDocumentCandidates_(outcome, page, missionId) {
  var list = oceBuildListCandidates_(outcome.text, outcome.final_url || outcome.url, { mission_id: missionId, doc_name: outcome.doc_name });
  if (list.length) return list;
  // No e-mails: keep a single organisation contact only when the document is clearly about one organisation.
  var single = oceBuildCandidates_(page, { mission_id: missionId }).filter(function (c) { return c.organization && c.address; });
  return single.slice(0, 1);
}
