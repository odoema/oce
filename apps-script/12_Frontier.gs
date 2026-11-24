/**
 * 12_Frontier: the persistent crawl queue (SOURCE_QUEUE) and source catalogue (SOURCE_REGISTRY).
 *
 * Queue states: QUEUED -> SCRAPING (leased) -> COMPLETED | FAILED | BLOCKED | SKIPPED | CANCELLED
 * Guarantees:
 *  - a URL is queued at most once per mission (canonical URL de-duplication)
 *  - mission page budget, depth limit and per-domain cap are enforced at enqueue time
 *  - leased items that never finish (timeouts, quota kills) are recovered automatically
 *  - transient failures retry with exponential backoff up to CRAWL_MAX_ATTEMPTS
 */

var OCE_FRONTIER = {
  LEASE_MINUTES: 10,
  BACKOFF_MINUTES: [5, 30, 180]
};

/**
 * Adds URLs to a mission's queue.
 * @param {Object} mission MISSIONS row
 * @param {Object[]} items [{url, priority, depth, parent_url, source_type, label}]
 * @return {{queued:number, duplicates:number, rejected:number, budget_exhausted:boolean}}
 */
function oceEnqueue_(mission, items) {
  var queue = oceTable_('SOURCE_QUEUE');
  var missionId = String(mission.mission_id);
  var maxPages = Number(mission.max_pages) || oceSettingNumber_('CRAWL_MAX_PAGES', 150);
  var maxDepth = Number(mission.max_depth);
  if (!isFinite(maxDepth) || mission.max_depth === '') maxDepth = oceSettingNumber_('CRAWL_MAX_DEPTH', 2);
  var maxPerDomain = oceSettingNumber_('CRAWL_MAX_PER_DOMAIN', 60);

  var state = oceMissionQueueState_(missionId);
  var result = { queued: 0, duplicates: 0, rejected: 0, budget_exhausted: false };
  var now = new Date();
  var rows = [];

  (items || []).forEach(function (item) {
    var canonical = oceCanonicalUrl_(item.url);
    if (!canonical) { result.rejected++; return; }
    try { oceAssertPublicUrl_(canonical); } catch (err) { result.rejected++; return; }
    if (oceIsAssetUrl_(canonical)) { result.rejected++; return; }
    var depth = Number(item.depth || 0);
    if (depth > maxDepth) { result.rejected++; return; }
    if (state.keys[canonical]) { result.duplicates++; return; }
    if (state.total >= maxPages) { result.budget_exhausted = true; return; }
    var domain = oceHostOf_(canonical);
    if ((state.domains[domain] || 0) >= maxPerDomain) { result.rejected++; return; }

    var source = oceRegisterSource_(canonical, item, mission);
    state.keys[canonical] = true;
    state.total++;
    state.domains[domain] = (state.domains[domain] || 0) + 1;
    rows.push({
      queue_id: oceUuid_(), source_id: source.source_id, url: canonical, canonical_url: canonical, domain: domain,
      priority: Math.round(Number(item.priority || 0)), status: 'QUEUED', queued_at: now, attempt_count: 0,
      source: String(item.source_type || 'DISCOVERED_PAGE') + '|mission_id=' + missionId,
      mission_id: missionId, depth: depth, parent_url: item.parent_url || '', next_attempt_at: '', lease_until: ''
    });
    result.queued++;
  });
  if (rows.length) queue.append(rows);
  return result;
}

/** Per-execution memo of a mission's queue footprint (for O(1) de-duplication). */
function oceMissionQueueState_(missionId) {
  var memo = oceRuntimeCache_();
  memo.queueState = memo.queueState || {};
  if (memo.queueState[missionId]) return memo.queueState[missionId];
  var state = { keys: {}, total: 0, domains: {} };
  oceTable_('SOURCE_QUEUE').all().forEach(function (r) {
    if (oceQueueMissionId_(r) !== missionId) return;
    var key = String(r.canonical_url || oceCanonicalUrl_(r.url) || r.url);
    state.keys[key] = true;
    state.total++;
    var d = String(r.domain || oceHostOf_(r.url));
    state.domains[d] = (state.domains[d] || 0) + 1;
  });
  memo.queueState[missionId] = state;
  return state;
}

/** v1 rows stored the mission id inside the `source` column; v2 has a dedicated column. */
function oceQueueMissionId_(row) {
  if (row.mission_id) return String(row.mission_id);
  var m = String(row.source || '').match(/mission_id=([\w-]+)/);
  return m ? m[1] : '';
}

function oceRegisterSource_(canonical, item, mission) {
  var registry = oceTable_('SOURCE_REGISTRY');
  var existing = registry.get('canonical_url', canonical);
  if (existing) {
    if (Number(item.priority || 0) > Number(existing.priority || 0)) registry.update(existing, { priority: Math.round(Number(item.priority)) });
    return existing;
  }
  return registry.append([{
    source_id: oceUuid_(), url: canonical, canonical_url: canonical, domain: oceHostOf_(canonical),
    source_type: item.source_type || 'DISCOVERED_PAGE', topic: mission.objective || '', label: oceClean_(item.label, 200),
    priority: Math.round(Number(item.priority || 0)), discovered_at: new Date(), last_status: 'DISCOVERED',
    scan_count: 0, queue_status: 'QUEUED', provenance: (item.source_type || 'DISCOVERED_PAGE') + '|mission_id=' + mission.mission_id,
    notes: item.parent_url ? 'Found on ' + item.parent_url : ''
  }])[0];
}

/**
 * Picks the next items to collect across all RUNNING missions and leases them.
 * Politeness per host: one URL per round, at least max(1s, robots Crawl-delay) between requests,
 * and at most CRAWL_PER_HOST_PER_TICK requests per tick.
 * @param {Object} hostState host -> {count, last} (shared across the rounds of one tick)
 * @return {{picked:Object[], wait_ms:number}} wait_ms > 0 when work exists but every host is cooling down
 */
function oceLeaseBatch_(limit, hostState, onlyMissionId) {
  var queue = oceTable_('SOURCE_QUEUE');
  var running = oceRunningMissionIds_();
  var now = new Date();
  var nowMs = now.getTime();
  var leaseUntil = new Date(nowMs + OCE_FRONTIER.LEASE_MINUTES * 60000);
  var perHostMax = oceSettingNumber_('CRAWL_PER_HOST_PER_TICK', 40);
  var candidates = queue.filter(function (r) {
    if (String(r.status).toUpperCase() !== 'QUEUED') return false;
    var mid = oceQueueMissionId_(r);
    if (onlyMissionId ? mid !== onlyMissionId : !running[mid]) return false;
    var next = oceToDate_(r.next_attempt_at);
    return !next || next <= now;
  });
  candidates.sort(function (a, b) {
    return (Number(b.priority) || 0) - (Number(a.priority) || 0) || (Number(a.depth) || 0) - (Number(b.depth) || 0);
  });
  var picked = [];
  var roundHosts = {};
  var waitMs = 0;
  for (var i = 0; i < candidates.length && picked.length < limit; i++) {
    var r = candidates[i];
    var host = String(r.domain || oceHostOf_(r.url));
    if (roundHosts[host]) continue;
    var st = hostState[host] || (hostState[host] = { count: 0, last: 0, interval: oceHostIntervalMs_(r.url) });
    if (st.count >= perHostMax) continue;
    var ready = st.last + st.interval - nowMs;
    if (ready > 0) { waitMs = waitMs ? Math.min(waitMs, ready) : ready; continue; }
    roundHosts[host] = true;
    st.count++;
    st.last = nowMs;
    queue.update(r, { status: 'SCRAPING', started_at: now, lease_until: leaseUntil });
    picked.push(r);
  }
  return { picked: picked, wait_ms: picked.length ? 0 : waitMs };
}

/** Minimum gap between two requests to one host: 1 s, or the robots.txt Crawl-delay if larger. */
function oceHostIntervalMs_(url) {
  var delay = 0;
  if (oceSettingBool_('RESPECT_ROBOTS', true)) {
    try { delay = oceRobotsCrawlDelay_(url); } catch (err) { delay = 0; }
  }
  return Math.max(1000, Math.round(delay * 1000));
}

/** Returns leased items whose lease expired (execution killed mid-flight) to the queue. */
function oceRecoverStaleLeases_() {
  var queue = oceTable_('SOURCE_QUEUE');
  var now = new Date();
  var maxAttempts = oceSettingNumber_('CRAWL_MAX_ATTEMPTS', 3);
  var recovered = 0;
  queue.all().forEach(function (r) {
    if (String(r.status).toUpperCase() !== 'SCRAPING') return;
    var lease = oceToDate_(r.lease_until);
    var started = oceToDate_(r.started_at);
    var expired = lease ? lease < now : (!started || now - started > OCE_FRONTIER.LEASE_MINUTES * 60000);
    if (!expired) return;
    var attempts = Number(r.attempt_count || 0) + 1;
    queue.update(r, attempts >= maxAttempts
      ? { status: 'FAILED', attempt_count: attempts, completed_at: now, last_error: 'Lease expired repeatedly', lease_until: '' }
      : { status: 'QUEUED', attempt_count: attempts, lease_until: '', last_error: 'Recovered after interrupted run' });
    recovered++;
  });
  return recovered;
}

/** Records the outcome for a leased queue item and updates the registry. */
function oceCompleteQueueItem_(row, outcome) {
  var queue = oceTable_('SOURCE_QUEUE');
  var registry = oceTable_('SOURCE_REGISTRY');
  var now = new Date();
  var maxAttempts = oceSettingNumber_('CRAWL_MAX_ATTEMPTS', 3);
  var status = outcome.status;
  var patch = { http_status: outcome.http_status || '', lease_until: '', last_error: oceClean_(outcome.error || '', 500) };
  if (status === 'RETRY') {
    var attempts = Number(row.attempt_count || 0) + 1;
    if (attempts >= maxAttempts) {
      patch.status = 'FAILED'; patch.completed_at = now; patch.attempt_count = attempts;
    } else {
      var wait = OCE_FRONTIER.BACKOFF_MINUTES[Math.min(attempts - 1, OCE_FRONTIER.BACKOFF_MINUTES.length - 1)];
      patch.status = 'QUEUED'; patch.attempt_count = attempts; patch.next_attempt_at = new Date(now.getTime() + wait * 60000);
    }
  } else {
    patch.status = status === 'OK' ? 'COMPLETED' : status;
    patch.completed_at = now;
    if (status !== 'OK') patch.attempt_count = Number(row.attempt_count || 0) + 1;
  }
  queue.update(row, patch);
  var source = registry.get('source_id', row.source_id) || registry.get('canonical_url', row.canonical_url || row.url);
  if (source) {
    registry.update(source, {
      last_status: patch.status, http_status: outcome.http_status || '', queue_status: patch.status,
      last_scanned_at: patch.status === 'COMPLETED' ? now : source.last_scanned_at,
      scan_count: Number(source.scan_count || 0) + (patch.status === 'COMPLETED' ? 1 : 0)
    });
  }
  return patch.status;
}

/** Status counts for one mission (or all when missionId is empty). */
function oceQueueStats_(missionId) {
  var out = { total: 0, queued: 0, scraping: 0, completed: 0, failed: 0, blocked: 0, skipped: 0, cancelled: 0 };
  oceTable_('SOURCE_QUEUE').all().forEach(function (r) {
    if (missionId && oceQueueMissionId_(r) !== missionId) return;
    out.total++;
    var s = String(r.status || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(out, s)) out[s]++;
  });
  return out;
}

/** Server-side paging for the dashboard. */
function oceQueuePage_(opts) {
  opts = opts || {};
  var size = oceClamp_(opts.page_size, 1, 100, 25);
  var status = String(opts.status || '').toUpperCase();
  var mission = String(opts.mission_id || '');
  var q = String(opts.q || '').toLowerCase();
  var rank = { SCRAPING: 0, QUEUED: 1, COMPLETED: 2, FAILED: 3, BLOCKED: 4, SKIPPED: 5, CANCELLED: 6 };
  var rows = oceTable_('SOURCE_QUEUE').filter(function (r) {
    if (mission && oceQueueMissionId_(r) !== mission) return false;
    if (status && String(r.status).toUpperCase() !== status) return false;
    if (q && String(r.url).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) {
    return (rank[String(a.status).toUpperCase()] || 9) - (rank[String(b.status).toUpperCase()] || 9) ||
      (Number(b.priority) || 0) - (Number(a.priority) || 0);
  });
  var total = rows.length;
  var pages = Math.max(1, Math.ceil(total / size));
  var page = oceClamp_(opts.page, 1, pages, 1);
  return {
    page: page, page_size: size, total: total, total_pages: pages,
    items: rows.slice((page - 1) * size, page * size).map(function (r) {
      return { queue_id: r.queue_id, url: r.url, priority: Number(r.priority) || 0, status: r.status, depth: Number(r.depth) || 0,
        attempt_count: Number(r.attempt_count) || 0, error: r.last_error, http_status: r.http_status, mission_id: oceQueueMissionId_(r),
        queued_at: r.queued_at, completed_at: r.completed_at };
    })
  };
}
