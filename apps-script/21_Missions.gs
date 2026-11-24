/**
 * 21_Missions: objective-driven collection runs.
 * Status: RUNNING -> COMPLETED | COMPLETED_WITH_ISSUES ; operator controls: PAUSED, CANCELLED. FAILED when no seeds.
 */

/**
 * @param {string} objective e.g. "Auditor firms in Uganda"
 * @param {Object=} opts {max_pages, max_depth, same_site, seeds:[url], seed_limit}
 */
function oceCreateMission_(objective, opts) {
  opts = opts || {};
  objective = oceClean_(objective, 300);
  if (!objective) throw new Error('Mission objective is required.');
  var manual = (opts.seeds || []).map(function (u) { return oceCanonicalUrl_(/^https?:\/\//i.test(u) ? u : 'https://' + u); }).filter(Boolean);
  var discovery = opts.skip_discovery ? { seeds: [], via: 'manual', queries: [] } : oceDiscover_(objective, opts.seed_limit || 10);
  var seeds = manual.map(function (u) { return { url: u, name: 'Manual seed', score: 90, source_type: 'MANUAL_SEED' }; }).concat(discovery.seeds);
  var now = new Date();
  var mission = oceTable_('MISSIONS').append([{
    mission_id: oceUuid_(), objective: objective, status: seeds.length ? 'RUNNING' : 'FAILED', created_at: now, updated_at: now,
    max_pages: oceClamp_(opts.max_pages || oceSettingNumber_('CRAWL_MAX_PAGES', 150), 1, 5000, 150),
    max_depth: oceClamp_(opts.max_depth === undefined || opts.max_depth === '' ? oceSettingNumber_('CRAWL_MAX_DEPTH', 2) : opts.max_depth, 0, 5, 2),
    same_site: opts.same_site === undefined ? oceSettingBool_('CRAWL_SAME_SITE', true) : !!opts.same_site,
    seed_count: seeds.length, pages_total: 0, pages_done: 0, pages_failed: 0, pages_skipped: 0, candidates_found: 0,
    progress: 0, discovery_via: opts.skip_discovery ? 'manual' : (manual.length ? 'manual+' : '') + discovery.via,
    notes: seeds.length ? '' : 'No public starting sources found. Add manual seed URLs or configure OCE_SEARCH_API_KEY.'
  }])[0];
  if (seeds.length) {
    var res = oceEnqueue_(mission, seeds.map(function (s) {
      return { url: s.url, label: s.name, priority: s.score, depth: 0, source_type: s.source_type || 'DISCOVERY_SEED' };
    }));
    oceTable_('MISSIONS').update(mission, { seed_count: res.queued, pages_total: res.queued });
    if (!res.queued) oceTable_('MISSIONS').update(mission, { status: 'FAILED', notes: 'All starting sources were rejected (invalid, private or duplicate).' });
  }
  oceFlushAll_();
  if (String(mission.status) === 'RUNNING') oceEnsureAutomation_();
  oceLog_('INFO', 'missions', 'Mission created: ' + objective, { mission_id: mission.mission_id, seeds: seeds.length, via: mission.discovery_via });
  oceFlushAll_();
  return oceMissionView_(mission, true);
}

function oceSetMissionStatus_(missionId, status) {
  var allowed = { PAUSED: 1, RUNNING: 1, CANCELLED: 1 };
  status = String(status || '').toUpperCase();
  if (!allowed[status]) throw new Error('Unsupported mission status: ' + status);
  var missions = oceTable_('MISSIONS');
  var m = missions.get('mission_id', missionId);
  if (!m) throw new Error('Mission not found');
  missions.update(m, { status: status, updated_at: new Date(), completed_at: status === 'CANCELLED' ? new Date() : m.completed_at });
  if (status === 'CANCELLED') {
    var queue = oceTable_('SOURCE_QUEUE');
    queue.all().forEach(function (r) {
      if (oceQueueMissionId_(r) === missionId && /^(QUEUED|SCRAPING)$/i.test(String(r.status))) queue.update(r, { status: 'CANCELLED', completed_at: new Date(), lease_until: '' });
    });
  }
  oceFlushAll_();
  if (status === 'RUNNING') { oceRefreshMission_(missionId); oceFlushAll_(); oceEnsureAutomation_(); }
  return oceMissionView_(m, true);
}

function oceRunningMissionIds_() {
  var out = {};
  oceTable_('MISSIONS').all().forEach(function (m) { if (String(m.status).toUpperCase() === 'RUNNING') out[String(m.mission_id)] = true; });
  return out;
}

/** Recomputes counters, progress and terminal state from the queue. */
function oceRefreshMission_(missionId) {
  var missions = oceTable_('MISSIONS');
  var m = missions.get('mission_id', missionId);
  if (!m) return null;
  var q = oceQueueStats_(missionId);
  var processed = q.completed + q.failed + q.blocked + q.skipped + q.cancelled;
  var candidates = oceTable_('CANDIDATES').count(function (c) { return String(c.mission_ids || '').indexOf(missionId) >= 0; });
  var patch = {
    pages_total: q.total, pages_done: q.completed, pages_failed: q.failed + q.blocked, pages_skipped: q.skipped,
    candidates_found: candidates, updated_at: new Date()
  };
  var status = String(m.status).toUpperCase();
  if (status === 'RUNNING') {
    if (q.total && !q.queued && !q.scraping) {
      patch.status = (q.failed + q.blocked) > q.completed ? 'COMPLETED_WITH_ISSUES' : 'COMPLETED';
      patch.completed_at = new Date();
      patch.progress = 100;
    } else {
      var budget = Math.max(Number(m.max_pages) || q.total, q.total, 1);
      // Progress blends work done against both the discovered frontier and the page budget.
      patch.progress = Math.min(99, Math.round(100 * processed / Math.max(q.total, Math.min(budget, q.total * 1.5 + 1))));
    }
  } else if (/COMPLETED|CANCELLED/.test(status)) {
    patch.progress = status === 'CANCELLED' ? Number(m.progress) || 0 : 100;
  }
  missions.update(m, patch);
  return m;
}

function oceRefreshAllMissions_() {
  oceTable_('MISSIONS').all().forEach(function (m) {
    if (/^(RUNNING|PAUSED)$/i.test(String(m.status))) oceRefreshMission_(String(m.mission_id));
  });
}

function oceMissionView_(m, withQueue) {
  if (!m) return null;
  var view = {
    mission_id: m.mission_id, objective: m.objective, status: m.status, progress: Number(m.progress) || 0,
    created_at: m.created_at, updated_at: m.updated_at, completed_at: m.completed_at,
    max_pages: Number(m.max_pages) || 0, max_depth: Number(m.max_depth) || 0, same_site: String(m.same_site).toUpperCase() !== 'FALSE',
    seed_count: Number(m.seed_count) || 0, pages_total: Number(m.pages_total) || 0, pages_done: Number(m.pages_done) || 0,
    pages_failed: Number(m.pages_failed) || 0, pages_skipped: Number(m.pages_skipped) || 0,
    candidates_found: Number(m.candidates_found) || 0, discovery_via: m.discovery_via, notes: m.notes
  };
  if (withQueue) view.queue = oceQueueStats_(String(m.mission_id));
  return view;
}

function oceListMissions_(limit) {
  return oceTable_('MISSIONS').all().slice().sort(function (a, b) {
    return (oceToDate_(b.created_at) || 0) - (oceToDate_(a.created_at) || 0);
  }).slice(0, oceClamp_(limit, 1, 200, 50)).map(function (m) { return oceMissionView_(m, false); });
}

function oceGetMission_(missionId) {
  var m = oceRefreshMission_(missionId);
  oceFlushAll_();
  if (!m) throw new Error('Mission not found');
  return oceMissionView_(m, true);
}
