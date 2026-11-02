/* OCE Mission Control V2
 * Simple objective -> ranked public discovery -> live persistent progress.
 * Fast mode selects the highest-ranked 300 sources first. Operators can explicitly
 * expand the mission in additional batches without losing deferred discoveries.
 *
 * Mission Control is the authoritative UI for the persistent Source Queue. The
 * legacy browser-local scout queue must never overwrite these counters or rows.
 */

const OCE_MISSION_POLL_MS = 2500;
const OCE_QUEUE_DEFAULT_PAGE_SIZE = 25;
let oceMissionId = '';
let oceMissionTimer = null;
let oceQueuePage = 1;
let oceQueuePageSize = OCE_QUEUE_DEFAULT_PAGE_SIZE;
let oceQueueTotalPages = 0;
let oceQueueRequestSeq = 0;
let oceMissionWorkerBusy = false;

function missionApiUrl(action, params = {}) {
  const query = new URLSearchParams({ action, ...params });
  return `${CONFIG.COLLECTOR_ENDPOINT}?${query.toString()}`;
}

async function missionApi(action, params = {}) {
  const response = await fetch(missionApiUrl(action, params), {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !payload.ok) {
    throw new Error((payload && payload.error) || `Mission API returned HTTP ${response.status}`);
  }
  return payload;
}

function missionProgress(percent, stage, detail) {
  const box = scout$('missionProgress');
  if (!box) return;
  box.classList.remove('hidden');
  const safe = Math.max(0, Math.min(100, Math.round(percent || 0)));
  scout$('missionPercent').textContent = `${safe}%`;
  scout$('missionStage').textContent = stage;
  scout$('missionDetail').textContent = detail;
  scout$('missionProgressBar').style.width = `${safe}%`;
}

function missionStatusText(status) {
  return {
    PLANNING: 'Planning',
    QUEUED: 'Discovery queued',
    COLLECTING: 'Collecting top-ranked sources',
    BATCH_READY: 'Fast batch ready',
    COMPLETED: 'Mission complete',
    COMPLETED_WITH_ISSUES: 'Mission complete with issues',
    FAILED: 'Mission failed'
  }[status] || status || 'Working';
}

function renderMissionCounters(queue) {
  const q = queue || {};
  const persistent = Number(q.persistent_total || q.total || 0);
  const active = Number(q.queued || 0) + Number(q.scraping || 0);
  const completed = Number(q.completed || 0);
  const failedBlocked = Number(q.failed || 0) + Number(q.blocked || 0);

  const selected = scout$('scoutQueueCount');
  const activeEl = scout$('scoutQueuedCount');
  const done = scout$('scoutDoneCount');
  const failed = scout$('scoutFailedCount');

  if (selected) selected.textContent = String(persistent);
  if (activeEl) activeEl.textContent = String(active);
  if (done) done.textContent = String(completed);
  if (failed) failed.textContent = String(failedBlocked);
}

function setQueuePaginationControls() {
  const prev = scout$('queuePrev');
  const next = scout$('queueNext');
  const hasPages = oceQueueTotalPages > 0;
  const hasMission = Boolean(oceMissionId);

  if (prev) {
    prev.disabled = !hasMission || !hasPages || oceQueuePage <= 1;
    prev.setAttribute('aria-disabled', String(prev.disabled));
  }
  if (next) {
    next.disabled = !hasMission || !hasPages || oceQueuePage >= oceQueueTotalPages;
    next.setAttribute('aria-disabled', String(next.disabled));
  }
}

function renderPersistentQueue(items, pagination) {
  const queue = Array.isArray(items) ? items : [];
  const page = pagination || {};
  const currentPage = Number(page.page || oceQueuePage || 1);
  const pageSize = Number(page.page_size || oceQueuePageSize || OCE_QUEUE_DEFAULT_PAGE_SIZE);
  const total = Number(page.total || 0);
  const totalPages = Number(page.total_pages || 0);

  oceQueuePage = currentPage;
  oceQueuePageSize = pageSize;
  oceQueueTotalPages = totalPages;

  const body = scout$('scoutQueueRows');
  const startIndex = total ? ((currentPage - 1) * pageSize) : 0;
  if (body) {
    body.innerHTML = queue.length
      ? queue.map((item, index) => `
        <tr>
          <td>${startIndex + index + 1}</td>
          <td><span class="queue-priority">${scoutEsc(item.priority)}</span></td>
          <td><a href="${scoutEsc(item.url)}" target="_blank" rel="noopener">${scoutEsc(item.url || 'URL unavailable')}</a></td>
          <td>${scoutEsc(item.source || 'mission')}</td>
          <td>${scoutEsc(item.status)}</td>
          <td>${scoutEsc(item.queued_at ? new Date(item.queued_at).toLocaleString() : '')}</td>
        </tr>`).join('')
      : '<tr><td colspan="6">No source records on this page.</td></tr>';
  }

  const info = scout$('queuePageInfo');
  const label = scout$('queuePageLabel');
  if (info) {
    if (!total) info.textContent = 'No queue records loaded.';
    else {
      const first = startIndex + 1;
      const last = Math.min(startIndex + queue.length, total);
      info.textContent = `Showing ${first}–${last} of ${total} sources`;
    }
  }
  if (label) label.textContent = `Page ${currentPage} of ${Math.max(1, totalPages)}`;
  setQueuePaginationControls();
}

async function loadMissionQueuePage(page = oceQueuePage) {
  if (!oceMissionId) {
    renderPersistentQueue([], {page:1,page_size:oceQueuePageSize,total:0,total_pages:0});
    return;
  }

  const requestedPage = Math.max(1, Math.floor(Number(page) || 1));
  const requestSeq = ++oceQueueRequestSeq;

  try {
    const payload = await missionApi('mission_queue_page', {
      mission_id: oceMissionId,
      page: String(requestedPage),
      page_size: String(oceQueuePageSize)
    });

    if (requestSeq !== oceQueueRequestSeq) return;
    if (!payload.queue || !Array.isArray(payload.queue.items)) {
      throw new Error('Gateway returned an invalid Source Queue pagination payload.');
    }
    renderPersistentQueue(payload.queue.items, payload.queue);
  } catch (error) {
    if (requestSeq !== oceQueueRequestSeq) return;
    setQueuePaginationControls();
    scoutSetStatus(`Source Queue pagination temporarily unavailable: ${String(error.message || error)}`);
  }
}

function renderMission(mission) {
  if (!mission) return;
  const q = mission.queue || {};
  const total = Number(q.total || 0);
  const processed = Number(q.completed || 0) + Number(q.failed || 0) + Number(q.blocked || 0);
  const active = Number(q.queued || 0) + Number(q.scraping || 0);
  const deferred = Number(q.deferred || 0);
  const persistent = Number(q.persistent_total || total);
  const limit = Number(mission.active_limit || 300);

  renderMissionCounters(q);

  let detail = `${processed} processed · ${active} active · top ${limit} selected`;
  if (deferred) detail += ` · ${deferred} waiting`;
  detail += ` · ${persistent} persistent sources`;

  missionProgress(mission.progress, missionStatusText(mission.status), detail);
  loadMissionQueuePage(oceQueuePage);

  const plan = scout$('discoveryPlan');
  if (plan) {
    plan.classList.remove('hidden');
    scout$('discoveryPlanText').textContent = `${mission.topic} · Fast set: top ${limit} · ${deferred} waiting for expansion · batch ${mission.batch_number || 1}`;
  }

  const expand = scout$('missionExpand');
  const batch = scout$('missionBatchSize');
  if (expand) {
    expand.disabled = !mission.mission_id || !deferred;
    expand.textContent = deferred ? 'Run Next Batch' : 'No More Waiting Sources';
  }
  if (batch) batch.disabled = !mission.mission_id || !deferred;

  setQueuePaginationControls();
  scoutSetStatus(`Mission ${missionStatusText(mission.status).toLowerCase()}: ${processed} processed, ${active} active, ${deferred} waiting.`);
}

async function runMissionWorker(limit = 1) {
  if (!oceMissionId || oceMissionWorkerBusy) return null;

  oceMissionWorkerBusy = true;
  try {
    const payload = await missionApi('run_worker', {
      limit: String(Math.max(1, Math.min(10, limit))),
      mission_id: oceMissionId
    });
    return payload.worker || null;
  } finally {
    oceMissionWorkerBusy = false;
  }
}

async function pollMission() {
  if (!oceMissionId) return;
  try {
    const payload = await missionApi('mission_status', { mission_id: oceMissionId });
    const mission = payload.mission;
    renderMission(mission);

    const active = Number(mission.queue?.queued || 0) + Number(mission.queue?.scraping || 0);
    const terminal = ['COMPLETED', 'COMPLETED_WITH_ISSUES', 'FAILED'].includes(mission.status) && Number(mission.queue?.deferred || 0) === 0;

    if (terminal) {
      if (oceMissionTimer) clearInterval(oceMissionTimer);
      oceMissionTimer = null;
      scout$('scoutRun').disabled = false;
      scout$('scoutRun').textContent = 'Start New Mission';
      return;
    }

    // Keep the worker LEGO alive while the mission page is open. The Apps Script
    // trigger remains the background fallback; this heartbeat prevents a live
    // browser mission from sitting QUEUED if the trigger is delayed or missing.
    if (active > 0) {
      try {
        await runMissionWorker(1);
      } catch (workerError) {
        scoutSetStatus(`Mission worker error: ${String(workerError.message || workerError)}`);
      }
    }
  } catch (error) {
    scoutSetStatus(`Mission tracking temporarily unavailable: ${String(error.message || error)}`);
  }
}

async function startPersistentMission() {
  if (!CONFIG.COLLECTOR_ENDPOINT) return scoutSetStatus('OCE is waiting for its deployed collector endpoint.');

  const topic = String(scout$('scoutTopic').value || '').trim();
  if (!topic) return scoutSetStatus('Tell OCE what you are looking for first.');

  if (oceMissionTimer) clearInterval(oceMissionTimer);
  oceMissionTimer = null;
  oceMissionId = '';
  oceQueuePage = 1;
  oceQueueTotalPages = 0;
  oceQueueRequestSeq += 1;
  oceMissionWorkerBusy = false;

  scout$('scoutRun').disabled = true;
  scout$('scoutRun').textContent = 'Starting…';
  scoutSetStatus('Mission Control is starting the OCE engine in FAST mode…');
  missionProgress(3, 'Starting mission', 'Selecting the highest-ranked public sources first. Fast mode targets 300 sources.');
  renderMissionCounters({persistent_total:0,queued:0,scraping:0,completed:0,failed:0,blocked:0});
  renderPersistentQueue([], {page:1,page_size:oceQueuePageSize,total:0,total_pages:0});

  try {
    const payload = await missionApi('start_mission', { topic, active_limit: '300' });
    const mission = payload.mission;
    oceMissionId = mission.mission_id;
    renderMission(mission);

    scoutSetStatus('Mission started. Collecting the active mission sources…');
    try {
      const worker = await runMissionWorker(5);
      if (worker && worker.processed === 0 && worker.mission_id) {
        scoutSetStatus('Mission worker ran but found no queued records for this mission.');
      }
    } catch (workerError) {
      scoutSetStatus(`Mission worker error: ${String(workerError.message || workerError)}`);
    }

    await pollMission();
    oceMissionTimer = setInterval(pollMission, OCE_MISSION_POLL_MS);
    scout$('scoutRun').textContent = 'Mission Running…';
  } catch (error) {
    scout$('scoutRun').disabled = false;
    scout$('scoutRun').textContent = 'Start Discovery';
    missionProgress(0, 'Mission could not start', String(error.message || error));
    scoutSetStatus(String(error.message || error));
  }
}

async function expandCurrentMission() {
  if (!oceMissionId) return scoutSetStatus('Start a mission before running another source batch.');
  const batch = Math.max(1, Math.min(5000, Number(scout$('missionBatchSize').value || 300)));
  const button = scout$('missionExpand');
  if (button) {
    button.disabled = true;
    button.textContent = 'Expanding…';
  }
  scoutSetStatus(`Activating the next ${batch} highest-ranked waiting sources…`);
  try {
    const payload = await missionApi('expand_mission', { mission_id: oceMissionId, additional: String(batch) });
    oceQueuePage = 1;
    oceQueueRequestSeq += 1;
    renderMission(payload.result.mission);
    scoutSetStatus(`Added the next ${payload.result.promoted || 0} sources to the active mission set.`);
    try {
      await runMissionWorker(5);
    } catch (workerError) {
      scoutSetStatus(`Mission worker error: ${String(workerError.message || workerError)}`);
    }
    await pollMission();
  } catch (error) {
    scoutSetStatus(String(error.message || error));
  } finally {
    if (button) button.disabled = false;
  }
}

function initMissionControl() {
  const run = scout$('scoutRun');
  if (!run) return;
  run.onclick = startPersistentMission;

  const expand = scout$('missionExpand');
  if (expand) expand.onclick = expandCurrentMission;

  const prev = scout$('queuePrev');
  const next = scout$('queueNext');
  const pageSize = scout$('queuePageSize');
  if (prev) prev.onclick = () => {
    if (oceQueuePage > 1) {
      oceQueuePage -= 1;
      loadMissionQueuePage(oceQueuePage);
    }
  };
  if (next) next.onclick = () => {
    if (oceQueuePage < oceQueueTotalPages) {
      oceQueuePage += 1;
      loadMissionQueuePage(oceQueuePage);
    }
  };
  if (pageSize) pageSize.onchange = () => {
    oceQueuePageSize = Math.max(1, Math.min(100, Number(pageSize.value || 25)));
    oceQueuePage = 1;
    loadMissionQueuePage(1);
  };

  const notice = document.querySelector('.scout-queue-card .notice');
  if (notice) notice.textContent = 'Fast mode processes the highest-ranked 300 sources first. Lower-ranked discoveries remain persistent and can be activated in additional batches. Use the pagination controls to browse the complete mission source queue.';

  scout$('scoutClear').onclick = () => scoutSetStatus('Persistent queue is managed by OCE Mission Control. Lower-ranked sources are deferred, not deleted.');
  scout$('scoutExport').onclick = () => {
    if (!oceMissionId) return scoutSetStatus('Start a mission before exporting its persistent queue.');
    missionApi('mission_status', { mission_id: oceMissionId }).then(payload => {
      const blob = new Blob([JSON.stringify(payload.mission, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'oce-mission-status.json';
      link.click();
      URL.revokeObjectURL(url);
    }).catch(error => scoutSetStatus(String(error.message || error)));
  };
}

document.addEventListener('DOMContentLoaded', initMissionControl);
