/* OCE Mission Control V1
 * LEGO block: simple objective -> backend mission -> live persistent progress.
 * This replaces browser-only discovery as the normal operator path.
 *
 * Pagination is display-only: it reads the persistent queue from the backend and
 * never changes queue creation, discovery, worker limits, or recursive crawling.
 */

const OCE_MISSION_POLL_MS = 2500;
let oceMissionId = '';
let oceMissionTimer = null;
let oceQueuePage = 1;
let oceQueuePageSize = 25;
let oceQueueRequestSerial = 0;

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
    COLLECTING: 'Collecting public sources',
    COMPLETED: 'Mission complete',
    COMPLETED_WITH_ISSUES: 'Mission complete with issues',
    FAILED: 'Mission failed'
  }[status] || status || 'Working';
}

function renderQueueRows(items) {
  const body = scout$('scoutQueueRows');
  if (!body) return;
  const queue = Array.isArray(items) ? items : [];
  body.innerHTML = queue.length
    ? queue.map((item, index) => `
      <tr>
        <td>${index + 1 + ((oceQueuePage - 1) * oceQueuePageSize)}</td>
        <td><span class="queue-priority">${scoutEsc(item.priority)}</span></td>
        <td><a href="${scoutEsc(item.url)}" target="_blank" rel="noopener">${scoutEsc(item.url)}</a></td>
        <td>${scoutEsc(item.source || 'mission')}</td>
        <td>${scoutEsc(item.status)}</td>
        <td>${scoutEsc(item.queued_at ? new Date(item.queued_at).toLocaleString() : '')}</td>
      </tr>`).join('')
    : '<tr><td colspan="6">No queue records on this page.</td></tr>';
}

function ensureQueuePager() {
  const card = document.querySelector('.scout-queue-card');
  if (!card) return null;
  let pager = card.querySelector('#oceQueuePager');
  if (pager) return pager;

  pager = document.createElement('div');
  pager.id = 'oceQueuePager';
  pager.className = 'queue-pager';
  pager.innerHTML = `
    <button type="button" class="secondary" id="oceQueuePrev">Previous</button>
    <span id="oceQueuePageLabel">Page 1 of 1</span>
    <button type="button" class="secondary" id="oceQueueNext">Next</button>
    <label>Rows <select id="oceQueuePageSize"><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>`;
  card.querySelector('.table-wrap').after(pager);

  pager.querySelector('#oceQueuePrev').onclick = () => loadMissionQueuePage(oceQueuePage - 1);
  pager.querySelector('#oceQueueNext').onclick = () => loadMissionQueuePage(oceQueuePage + 1);
  pager.querySelector('#oceQueuePageSize').value = String(oceQueuePageSize);
  pager.querySelector('#oceQueuePageSize').onchange = (event) => {
    oceQueuePageSize = Number(event.target.value) || 25;
    loadMissionQueuePage(1);
  };
  return pager;
}

function renderQueuePager(pageData) {
  const pager = ensureQueuePager();
  if (!pager) return;
  const totalPages = Number(pageData && pageData.total_pages || 0);
  const page = Number(pageData && pageData.page || 1);
  const total = Number(pageData && pageData.total || 0);
  pager.querySelector('#oceQueuePageLabel').textContent = totalPages
    ? `Page ${page} of ${totalPages} · ${total} total`
    : 'Page 1 of 0 · 0 total';
  pager.querySelector('#oceQueuePrev').disabled = !(pageData && pageData.has_previous);
  pager.querySelector('#oceQueueNext').disabled = !(pageData && pageData.has_next);
  pager.querySelector('#oceQueuePageSize').value = String(oceQueuePageSize);
}

async function loadMissionQueuePage(page) {
  const requestedPage = Math.max(1, Number(page || 1));
  const serial = ++oceQueueRequestSerial;
  try {
    const action = oceMissionId ? 'mission_queue_page' : 'queue_page';
    const params = oceMissionId
      ? { mission_id: oceMissionId, page: String(requestedPage), page_size: String(oceQueuePageSize) }
      : { page: String(requestedPage), page_size: String(oceQueuePageSize) };
    const payload = await missionApi(action, params);
    if (serial !== oceQueueRequestSerial) return;
    const data = payload.queue || {};
    oceQueuePage = Number(data.page || requestedPage);
    renderQueueRows(data.items || []);
    renderQueuePager(data);
  } catch (error) {
    if (serial !== oceQueueRequestSerial) return;
    const body = scout$('scoutQueueRows');
    if (body) body.innerHTML = `<tr><td colspan="6">Queue page temporarily unavailable: ${scoutEsc(String(error.message || error))}</td></tr>`;
  }
}

function renderPersistentQueue(mission) {
  const stats = mission.queue || {};

  scout$('scoutQueueCount').textContent = String(stats.total || 0);
  scout$('scoutQueuedCount').textContent = String((stats.queued || 0) + (stats.scraping || 0));
  scout$('scoutDoneCount').textContent = String(stats.completed || 0);
  scout$('scoutFailedCount').textContent = String((stats.failed || 0) + (stats.blocked || 0));

  ensureQueuePager();
}

function renderMission(mission) {
  if (!mission) return;
  const q = mission.queue || {};
  const total = Number(q.total || 0);
  const processed = Number(q.completed || 0) + Number(q.failed || 0) + Number(q.blocked || 0);
  const active = Number(q.queued || 0) + Number(q.scraping || 0);

  let detail = `${processed} processed · ${active} active · ${total} sources discovered`;
  if (mission.status === 'COMPLETED_WITH_ISSUES') detail += ' · review failed/blocked sources';
  if (mission.status === 'COMPLETED') detail += ' · all queued sources processed';

  missionProgress(mission.progress, missionStatusText(mission.status), detail);
  renderPersistentQueue(mission);

  const plan = scout$('discoveryPlan');
  if (plan) {
    plan.classList.remove('hidden');
    scout$('discoveryPlanText').textContent = `${mission.topic} · ${total} persistent source records · ${mission.phase}`;
  }

  scoutSetStatus(`Mission ${missionStatusText(mission.status).toLowerCase()}: ${processed} processed, ${active} active, ${total} discovered.`);
}

async function pollMission() {
  if (!oceMissionId) return;
  try {
    const payload = await missionApi('mission_status', { mission_id: oceMissionId });
    renderMission(payload.mission);
    await loadMissionQueuePage(oceQueuePage);

    const terminal = ['COMPLETED', 'COMPLETED_WITH_ISSUES', 'FAILED'].includes(payload.mission.status);
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
  oceQueuePage = 1;
  oceQueueRequestSerial += 1;

  scout$('scoutRun').disabled = true;
  scout$('scoutRun').textContent = 'Starting…';
  scoutSetStatus('Mission Control is starting the OCE engine…');
  missionProgress(3, 'Starting mission', 'Understanding the objective and selecting public discovery sources.');

  try {
    const payload = await missionApi('start_mission', { topic });
    const mission = payload.mission;
    oceMissionId = mission.mission_id;
    renderMission(mission);
    await loadMissionQueuePage(1);

    // Kick the first controlled collection immediately for this mission.
    // The scheduled worker remains responsible for continued global processing.
    fetch(missionApiUrl('run_worker', { limit: '1', mission_id: oceMissionId }), { cache: 'no-store' }).catch(() => {});

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

function initMissionControl() {
  const run = scout$('scoutRun');
  if (!run) return;
  run.onclick = startPersistentMission;

  const notice = document.querySelector('.scout-queue-card .notice');
  if (notice) notice.textContent = 'Persistent queue. Showing the live global queue until a mission is selected; mission runs are then filtered automatically.';

  scout$('scoutClear').onclick = () => scoutSetStatus('Persistent queue is managed by OCE Mission Control and is not cleared from the browser.');
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

  // The queue exists independently of the browser's current mission state.
  // Load it immediately so the operator can see the live persistent queue.
  loadMissionQueuePage(1);
}

document.addEventListener('DOMContentLoaded', initMissionControl);
