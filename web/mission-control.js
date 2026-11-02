/* OCE Mission Control V2
 * Simple objective -> ranked public discovery -> live persistent progress.
 * Fast mode selects the highest-ranked 300 sources first. Operators can explicitly
 * expand the mission in additional batches without losing deferred discoveries.
 */

const OCE_MISSION_POLL_MS = 2500;
let oceMissionId = '';
let oceMissionTimer = null;

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

function renderPersistentQueue(mission) {
  const queue = Array.isArray(mission.queue_items) ? mission.queue_items : [];
  const stats = mission.queue || {};

  scout$('scoutQueueCount').textContent = String(stats.total || 0);
  scout$('scoutQueuedCount').textContent = String((stats.queued || 0) + (stats.scraping || 0));
  scout$('scoutDoneCount').textContent = String(stats.completed || 0);
  scout$('scoutFailedCount').textContent = String((stats.failed || 0) + (stats.blocked || 0));

  const body = scout$('scoutQueueRows');
  body.innerHTML = queue.length
    ? queue.map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><span class="queue-priority">${scoutEsc(item.priority)}</span></td>
        <td><a href="${scoutEsc(item.url)}" target="_blank" rel="noopener">${scoutEsc(item.url)}</a></td>
        <td>${scoutEsc(item.source || 'mission')}</td>
        <td>${scoutEsc(item.status)}</td>
        <td>${scoutEsc(item.queued_at ? new Date(item.queued_at).toLocaleString() : '')}</td>
      </tr>`).join('')
    : '<tr><td colspan="6">Waiting for the first persistent collection result…</td></tr>';
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

  let detail = `${processed} processed · ${active} active · top ${limit} selected`;
  if (deferred) detail += ` · ${deferred} waiting`;
  detail += ` · ${persistent} persistent sources`;
  if (mission.status === 'COMPLETED_WITH_ISSUES') detail += ' · review failed/blocked sources';

  missionProgress(mission.progress, missionStatusText(mission.status), detail);
  renderPersistentQueue(mission);

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

  scoutSetStatus(`Mission ${missionStatusText(mission.status).toLowerCase()}: ${processed} processed, ${active} active, ${deferred} waiting.`);
}

async function pollMission() {
  if (!oceMissionId) return;
  try {
    const payload = await missionApi('mission_status', { mission_id: oceMissionId });
    renderMission(payload.mission);

    const terminal = ['COMPLETED', 'COMPLETED_WITH_ISSUES', 'FAILED'].includes(payload.mission.status) && Number(payload.mission.queue?.deferred || 0) === 0;
    if (terminal) {
      if (oceMissionTimer) clearInterval(oceMissionTimer);
      oceMissionTimer = null;
      scout$('scoutRun').disabled = false;
      scout$('scoutRun').textContent = 'Start New Mission';
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

  scout$('scoutRun').disabled = true;
  scout$('scoutRun').textContent = 'Starting…';
  scoutSetStatus('Mission Control is starting the OCE engine in FAST mode…');
  missionProgress(3, 'Starting mission', 'Selecting the highest-ranked public sources first. Fast mode targets 300 sources.');

  try {
    const payload = await missionApi('start_mission', { topic, active_limit: '300' });
    const mission = payload.mission;
    oceMissionId = mission.mission_id;
    renderMission(mission);

    fetch(missionApiUrl('run_worker', { limit: '1' }), { cache: 'no-store' }).catch(() => {});

    oceMissionTimer = setInterval(pollMission, OCE_MISSION_POLL_MS);
    setTimeout(pollMission, 900);
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
    renderMission(payload.result.mission);
    scoutSetStatus(`Added the next ${payload.result.promoted || 0} sources to the active mission set.`);
    fetch(missionApiUrl('run_worker', { limit: '1' }), { cache: 'no-store' }).catch(() => {});
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

  const notice = document.querySelector('.scout-queue-card .notice');
  if (notice) notice.textContent = 'Fast mode processes the highest-ranked 300 sources first. Lower-ranked discoveries remain persistent and can be activated in additional batches.';

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
