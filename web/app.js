/* OCE dashboard — vanilla JS, no build step. Talks to the Apps Script web app (apps-script/40_Api.gs). */
'use strict';

const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxLpeSVROLACHa2i6CIlWddMSmKdoyKAaZ7QJmJWDVW-1s_LCM9JyrllYeZHGQFPmCO/exec';
const store = {
  get endpoint() { return localStorage.getItem('oce.endpoint') || DEFAULT_ENDPOINT; },
  get key() { return localStorage.getItem('oce.key') || ''; },
  save(endpoint, key) { localStorage.setItem('oce.endpoint', endpoint); localStorage.setItem('oce.key', key); },
  clear() { localStorage.removeItem('oce.endpoint'); localStorage.removeItem('oce.key'); }
};

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? esc(v) : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
const num = (v) => Number(v || 0).toLocaleString();
const safeUrl = (u) => (/^https?:\/\//i.test(String(u)) ? esc(u) : '#');
const short = (u, n = 70) => { const s = String(u || '').replace(/^https?:\/\//, ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/* ------------------------------------------------------------------ API */
async function api(action, params = {}, method = 'GET') {
  if (!store.key) throw new Error('Not connected. Open Settings and add the web app URL and API key.');
  let res;
  if (method === 'GET') {
    const qs = new URLSearchParams({ action, key: store.key });
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, v); });
    res = await fetch(store.endpoint + '?' + qs.toString(), { method: 'GET', redirect: 'follow', cache: 'no-store' });
  } else {
    res = await fetch(store.endpoint, {
      method: 'POST', redirect: 'follow', cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, key: store.key, ...params })
    });
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('The web app did not return JSON. Check the URL and that it is deployed for "Anyone".'); }
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data.data;
}
const post = (action, params) => api(action, params, 'POST');

function toast(msg, kind = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), kind === 'err' ? 8000 : 3500);
}

async function guard(fn, btn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, 'err'); } finally { if (btn) btn.disabled = false; }
}

/* ------------------------------------------------------------------ navigation */
const views = ['overview', 'missions', 'review', 'contacts', 'campaigns', 'settings'];
let current = 'overview';
function show(view) {
  current = view;
  views.forEach((v) => $('view-' + v).classList.toggle('hidden', v !== view));
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  location.hash = view;
  load(view);
}
document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
document.querySelectorAll('[data-action=refresh]').forEach((b) => b.addEventListener('click', () => load(current)));

function load(view) {
  if (view === 'settings') return loadSettings();
  if (!store.key) { setConn(false); if (view !== 'settings') renderSetupNotice(); return; }
  ({ overview: loadOverview, missions: loadMissions, review: loadCandidates, contacts: loadContacts, campaigns: loadCampaigns }[view] || (() => {}))();
}

function setConn(ok, dash) {
  $('connState').textContent = ok ? 'Connected' : 'Not connected';
  $('connState').className = 'conn ' + (ok ? 'on' : 'off');
  if (dash) {
    const d = dash.delivery;
    $('modeBadge').textContent = d.mode + (d.mode === 'PRODUCTION' && d.send_enabled ? ' · LIVE' : '');
    $('modeBadge').className = 'mode ' + (d.mode === 'PRODUCTION' && d.send_enabled ? 'live' : '');
    $('navPending').textContent = num(dash.candidates.pending);
  }
}

function renderSetupNotice() {
  const n = $('setupNotice');
  n.classList.remove('hidden');
  n.innerHTML = 'OCE is not connected. Go to <a href="#settings" data-go="settings">Settings</a> and paste your web app URL and API key (run <code>oceSetup()</code> in the Apps Script editor to get them).';
  n.querySelector('[data-go]').addEventListener('click', (e) => { e.preventDefault(); show('settings'); });
}

/* ------------------------------------------------------------------ overview */
async function loadOverview() {
  await guard(async () => {
    const d = await api('dashboard');
    setConn(true, d);
    $('setupNotice').classList.add('hidden');
    const warnings = [];
    if (d.automation.legacy_triggers) warnings.push(d.automation.legacy_triggers + ' old v1 trigger(s) still installed — run oceSetup() once to remove them.');
    if (warnings.length) { $('setupNotice').classList.remove('hidden'); $('setupNotice').innerHTML = warnings.map(esc).join('<br>'); }
    const k = [
      ['Running missions', d.missions.running, `${num(d.missions.total)} total`],
      ['Pages collected', d.queue.completed, `${num(d.queue.queued)} waiting · ${num(d.queue.failed + d.queue.blocked)} failed/blocked`],
      ['To review', d.candidates.pending, `${num(d.candidates.total)} candidates · ${num(d.candidates.with_email)} with e-mail`],
      ['Eligible contacts', d.contacts.eligible, `${num(d.contacts.total)} contacts · ${num(d.contacts.suppressed)} suppressed`],
      ['Sent today', d.delivery.sent_today, `limit ${num(d.delivery.daily_limit)} · ${esc(d.delivery.mode)}`],
      ['Automation', d.automation.enabled ? 'On' : 'Idle', d.automation.enabled ? `every ${d.automation.interval_minutes} min` : 'starts with work']
    ];
    $('kpis').innerHTML = k.map(([label, value, sub]) => `<div class="kpi"><span>${esc(label)}</span><strong>${typeof value === 'number' ? num(value) : esc(value)}</strong><small>${sub}</small></div>`).join('');
    const ev = await api('events.recent', { limit: 15 });
    $('events').innerHTML = ev.length ? ev.map((e) => `<li class="lvl-${esc(String(e.level).toLowerCase())}"><time>${fmtDate(e.timestamp)}</time><span>${esc(e.component)}</span>${esc(e.message)}</li>`).join('') : '<li class="muted">No activity yet.</li>';
  });
}

/* ------------------------------------------------------------------ missions */
let selectedMission = null;
let queuePage = 1;
let missionTimer = null;

$('missionForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const btn = e.submitter;
  guard(async () => {
    const m = await post('missions.create', {
      objective: $('objective').value.trim(), max_pages: $('maxPages').value, max_depth: $('maxDepth').value,
      same_site: $('sameSite').checked, seeds: $('seeds').value, skip_discovery: $('skipDiscovery').checked
    });
    toast(m.status === 'RUNNING' ? `Mission started with ${m.seed_count} starting sources.` : (m.notes || 'Mission could not start.'), m.status === 'RUNNING' ? 'ok' : 'err');
    $('objective').value = '';
    $('discoveryPreview').classList.add('hidden');
    selectedMission = m.mission_id;
    await loadMissions();
  }, btn);
});

$('previewDiscovery').addEventListener('click', (e) => guard(async () => {
  const objective = $('objective').value.trim();
  if (!objective) throw new Error('Type an objective first.');
  const d = await api('discover.preview', { objective, limit: 12 });
  const box = $('discoveryPreview');
  box.classList.remove('hidden');
  box.innerHTML = `<p class="muted">Via ${esc(d.via)} · ${d.seeds.length} sources</p>` +
    (d.seeds.length ? `<ul class="seed-list">${d.seeds.map((s) => `<li><b>${esc(s.score)}</b> <a href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${esc(short(s.url, 80))}</a><small>${esc(s.reason || s.source_type)}</small></li>`).join('')}</ul>` : '<p>No sources found — add starting URLs under Options.</p>');
}, e.currentTarget));

$('runWorker').addEventListener('click', (e) => guard(async () => {
  toast('Collecting for up to a minute…');
  const s = await post('worker.run', { max_seconds: 60, mission_id: selectedMission || '' });
  toast(s.skipped ? s.skipped : `Processed ${s.processed} pages, ${s.candidates} contacts found/updated.`);
  await loadMissions();
}, e.currentTarget));

async function loadMissions() {
  await guard(async () => {
    const list = await api('missions.list', { limit: 50 });
    setConn(true);
    $('missionRows').innerHTML = list.length ? list.map((m) => `
      <tr class="${m.mission_id === selectedMission ? 'selected' : ''}" data-id="${esc(m.mission_id)}">
        <td><a href="#" data-open="${esc(m.mission_id)}">${esc(m.objective)}</a>${m.notes ? `<div class="muted small">${esc(m.notes)}</div>` : ''}</td>
        <td><span class="status s-${esc(String(m.status).toLowerCase())}">${esc(m.status)}</span></td>
        <td><div class="bar"><i style="width:${Math.max(0, Math.min(100, m.progress))}%"></i></div><small>${esc(m.progress)}%</small></td>
        <td>${num(m.pages_done)} / ${num(m.pages_total)}<small class="muted"> of ${num(m.max_pages)}</small></td>
        <td>${num(m.candidates_found)}</td>
        <td>${fmtDate(m.created_at)}</td>
        <td><button class="ghost small" data-open="${esc(m.mission_id)}">Open</button></td>
      </tr>`).join('') : '<tr><td colspan="7" class="muted">No missions yet. Start one above.</td></tr>';
    $('missionRows').querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); selectedMission = a.dataset.open; queuePage = 1; loadMissionDetail(); }));
    if (selectedMission) await loadMissionDetail();
    clearTimeout(missionTimer);
    if (list.some((m) => m.status === 'RUNNING') && current === 'missions') missionTimer = setTimeout(loadMissions, 20000);
  });
}

async function loadMissionDetail() {
  if (!selectedMission) return;
  await guard(async () => {
    const [m, q] = await Promise.all([
      api('missions.get', { mission_id: selectedMission }),
      api('queue.page', { mission_id: selectedMission, page: queuePage, page_size: 25, status: $('qStatus').value, q: $('qSearch').value })
    ]);
    $('missionDetail').classList.remove('hidden');
    $('mdTitle').textContent = m.objective;
    const actions = [];
    if (m.status === 'RUNNING') actions.push(['pause', 'Pause']);
    if (m.status === 'PAUSED') actions.push(['resume', 'Resume']);
    if (['RUNNING', 'PAUSED'].includes(m.status)) actions.push(['cancel', 'Cancel']);
    actions.push(['review', 'Review contacts']);
    $('mdActions').innerHTML = actions.map(([a, l]) => `<button class="ghost small${a === 'cancel' ? ' danger' : ''}" data-m="${a}">${l}</button>`).join('');
    $('mdActions').querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => missionAction(b.dataset.m, b)));
    const s = m.queue;
    $('mdStats').innerHTML = [['Total', s.total], ['Waiting', s.queued + s.scraping], ['Collected', s.completed], ['Failed', s.failed], ['Blocked', s.blocked], ['Skipped', s.skipped]]
      .map(([l, v]) => `<div><strong>${num(v)}</strong><span>${l}</span></div>`).join('') + `<div><strong>${esc(m.discovery_via || '—')}</strong><span>Discovery</span></div>`;
    $('queueRows').innerHTML = q.items.length ? q.items.map((r) => `<tr>
      <td><a href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer" title="${esc(r.url)}">${esc(short(r.url))}</a></td>
      <td><span class="status s-${esc(String(r.status).toLowerCase())}">${esc(r.status)}</span></td>
      <td>${esc(r.priority)}</td><td>${esc(r.depth)}</td><td class="muted small">${esc(r.error || (r.http_status ? 'HTTP ' + r.http_status : ''))}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">Nothing here.</td></tr>';
    pager($('queuePager'), q, (p) => { queuePage = p; loadMissionDetail(); });
  });
}
$('qStatus').addEventListener('change', () => { queuePage = 1; loadMissionDetail(); });
$('qSearch').addEventListener('input', debounce(() => { queuePage = 1; loadMissionDetail(); }, 400));

function missionAction(a, btn) {
  if (a === 'review') { rMission = selectedMission; show('review'); return; }
  if (a === 'cancel' && !confirm('Cancel this mission? Waiting pages will not be collected.')) return;
  guard(async () => { await post('missions.' + a, { mission_id: selectedMission }); await loadMissions(); }, btn);
}

$('scanForm').addEventListener('submit', (e) => {
  e.preventDefault();
  guard(async () => {
    const r = await api('scan.url', { url: $('scanUrl').value.trim() });
    const box = $('scanResult');
    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="scan-grid">
        <div><span class="muted">Title</span><b>${esc(r.title || '—')}</b></div>
        <div><span class="muted">Organisation</span><b>${esc(r.organization || '—')}</b></div>
        <div><span class="muted">Category</span><b>${esc(r.category)}</b></div>
        <div><span class="muted">Location</span><b>${esc([r.location, r.country].filter(Boolean).join(', ') || '—')}</b></div>
        <div class="wide"><span class="muted">Address</span><b>${esc(r.address || '—')}</b></div>
        <div class="wide"><span class="muted">E-mails</span>${r.emails.length ? r.emails.map((x) => `<span class="tag">${esc(x)}</span>`).join('') : '—'}</div>
        <div class="wide"><span class="muted">Phones</span>${r.phones.length ? r.phones.map((x) => `<span class="tag">${esc(x)}</span>`).join('') : '—'}</div>
        <div class="wide"><span class="muted">Best links to follow</span><ul class="seed-list">${r.top_links.slice(0, 10).map((l) => `<li><b>${esc(l.priority)}</b> ${esc(short(l.url, 80))}</li>`).join('') || '<li>—</li>'}</ul></div>
      </div><p class="muted small">Consent: ${esc(r.marketing_consent)} — public visibility is not permission to market.</p>`;
  }, e.submitter);
});

/* ------------------------------------------------------------------ review */
let candPage = 1;
let rMission = '';
const selected = new Set();

async function loadCandidates() {
  await guard(async () => {
    const d = await api('candidates.page', { status: $('rStatus').value, q: $('rSearch').value, min_confidence: $('rMinConf').value, mission_id: rMission, page: candPage, page_size: 50 });
    setConn(true);
    selected.clear(); updateSel();
    $('candRows').innerHTML = d.items.length ? d.items.map((c) => `<tr>
      <td><input type="checkbox" data-sel="${esc(c.candidate_id)}" aria-label="Select"></td>
      <td>${c.email ? `<b>${esc(c.email)}</b>` : '<span class="muted">no e-mail</span>'}${c.phone ? `<div class="small">${esc(c.phone)}</div>` : ''}${c.person_name ? `<div class="small">${esc(c.person_name)}${c.role ? ' · ' + esc(c.role) : ''}</div>` : ''}</td>
      <td>${esc(c.organization || '—')}<div class="small muted">${esc(c.category)}</div></td>
      <td>${esc([c.location, c.country].filter(Boolean).join(', ') || '—')}</td>
      <td><span class="conf ${c.confidence >= 70 ? 'hi' : c.confidence >= 45 ? 'mid' : 'lo'}">${esc(c.confidence)}</span><div class="small muted">${esc(c.sources_count)} source${c.sources_count > 1 ? 's' : ''}</div></td>
      <td class="small">${esc(c.evidence)}<div>${c.source_urls.slice(0, 2).map((u) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener noreferrer">${esc(short(u, 40))}</a>`).join(' ')}</div></td>
      <td><span class="status s-${esc(String(c.review_status).toLowerCase())}">${esc(c.review_status)}</span>${c.lawful_basis ? `<div class="small muted">${esc(c.lawful_basis)}</div>` : ''}</td></tr>`).join('')
      : `<tr><td colspan="7" class="muted">No candidates${rMission ? ' for this mission' : ''}.${rMission ? ' <a href="#" id="clearMission">Show all</a>' : ''}</td></tr>`;
    const cm = $('clearMission'); if (cm) cm.addEventListener('click', (e) => { e.preventDefault(); rMission = ''; loadCandidates(); });
    $('candRows').querySelectorAll('[data-sel]').forEach((cb) => cb.addEventListener('change', () => { cb.checked ? selected.add(cb.dataset.sel) : selected.delete(cb.dataset.sel); updateSel(); }));
    pager($('candPager'), d, (p) => { candPage = p; loadCandidates(); });
    $('navPending').textContent = $('rStatus').value === 'PENDING' && !rMission && !$('rSearch').value ? num(d.total) : $('navPending').textContent;
  });
}
function updateSel() { $('selCount').textContent = `${selected.size} selected`; $('selAll').checked = false; }
$('selAll').addEventListener('change', (e) => {
  $('candRows').querySelectorAll('[data-sel]').forEach((cb) => { cb.checked = e.target.checked; e.target.checked ? selected.add(cb.dataset.sel) : selected.delete(cb.dataset.sel); });
  $('selCount').textContent = `${selected.size} selected`;
});
['rStatus', 'rMinConf'].forEach((id) => $(id).addEventListener('change', () => { candPage = 1; loadCandidates(); }));
$('rSearch').addEventListener('input', debounce(() => { candPage = 1; loadCandidates(); }, 400));
$('basis').addEventListener('change', () => $('consentSource').classList.toggle('hidden', $('basis').value !== 'CONSENT'));
document.querySelectorAll('[data-decision]').forEach((b) => b.addEventListener('click', () => {
  if (!selected.size) return toast('Select at least one row.', 'err');
  const decision = b.dataset.decision;
  const basis = $('basis').value;
  if (decision === 'APPROVE' && basis === 'NONE' && !confirm('Approve without a lawful basis? Contacts will be stored but cannot receive campaigns until you record one.')) return;
  guard(async () => {
    const r = await post('candidates.review', { ids: [...selected], decision, lawful_basis: basis, consent_status: basis === 'CONSENT' ? 'YES' : 'UNKNOWN', consent_source: $('consentSource').value, tags: $('reviewTags').value });
    toast(`${r.updated} updated · ${r.contacts_created} new contacts${r.without_email ? ` · ${r.without_email} without e-mail` : ''}`);
    await loadCandidates();
  }, b);
}));
$('exportCandidates').addEventListener('click', (e) => guard(async () => {
  const r = await api('export.candidates', { status: $('rStatus').value, q: $('rSearch').value, mission_id: rMission });
  const blob = new Blob([r.csv], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: r.filename });
  a.click(); URL.revokeObjectURL(a.href);
  toast(`Exported ${r.rows} rows.`);
}, e.currentTarget));

/* ------------------------------------------------------------------ contacts */
let contactPage = 1;
async function loadContacts() {
  await guard(async () => {
    const d = await api('contacts.page', { q: $('cSearch').value, eligible: $('cEligible').checked ? 'TRUE' : '', page: contactPage, page_size: 50 });
    setConn(true);
    $('cTotals').textContent = `${num(d.total)} shown · ${num(d.eligible_total)} eligible overall`;
    $('contactRows').innerHTML = d.items.length ? d.items.map((c) => `<tr>
      <td>${esc(c.email)}</td><td>${esc([c.first_name, c.last_name].filter(Boolean).join(' ') || '—')}</td><td>${esc(c.organization || '—')}</td>
      <td>${esc(c.lawful_basis || '—')}</td><td>${esc(c.consent_status || '—')}</td><td><span class="status s-${esc(String(c.status).toLowerCase())}">${esc(c.status)}</span></td>
      <td>${c.eligible ? '<span class="yes">Yes</span>' : `<span class="no" title="${esc(c.eligibility_reason)}">No · ${esc(c.eligibility_reason.replace(/_/g, ' ').toLowerCase())}</span>`}</td>
      <td>${num(c.send_count)}</td></tr>`).join('') : '<tr><td colspan="8" class="muted">No contacts yet. Approve candidates in Review or import a CSV.</td></tr>';
    pager($('contactPager'), d, (p) => { contactPage = p; loadContacts(); });
  });
}
$('cSearch').addEventListener('input', debounce(() => { contactPage = 1; loadContacts(); }, 400));
$('cEligible').addEventListener('change', () => { contactPage = 1; loadContacts(); });
$('csvImport').addEventListener('click', (e) => guard(async () => {
  const f = $('csvFile').files[0];
  if (!f) throw new Error('Choose a CSV file.');
  if (f.size > 4 * 1024 * 1024) throw new Error('CSV is larger than 4 MB; split it into smaller files.');
  const r = await post('contacts.import', { csv: await f.text(), tags: $('csvTags').value, source: 'CSV: ' + f.name });
  toast(`Imported: ${r.created} new, ${r.updated} updated, ${r.skipped} skipped.`, r.skipped ? 'warn' : 'ok');
  await loadContacts();
}, e.currentTarget));

/* ------------------------------------------------------------------ campaigns */
let segments = [];
async function loadCampaigns() {
  await guard(async () => {
    const [list, segs, dash] = await Promise.all([api('campaigns.list'), api('segments.list'), api('dashboard')]);
    setConn(true, dash);
    segments = segs;
    $('ceSegment').innerHTML = '<option value="">All eligible contacts</option>' + segs.map((s) => `<option value="${esc(s.segment_id)}">${esc(s.segment_name || s.segment_id)}</option>`).join('');
    const d = dash.delivery;
    const n = $('deliveryNotice');
    n.classList.remove('hidden');
    n.className = 'notice ' + (d.mode === 'PRODUCTION' && d.send_enabled ? 'live' : '');
    n.innerHTML = d.mode === 'DRY_RUN' ? '<b>DRY RUN</b> — activating a campaign simulates delivery; no e-mail leaves Google. Switch to TEST in Settings to send yourself samples.'
      : d.mode === 'TEST' ? '<b>TEST MODE</b> — only “Send test to me” sends, and only to OCE_TEST_RECIPIENT.'
        : `<b>PRODUCTION</b> — ${d.send_enabled ? 'sending is ON' : 'sending is OFF (SEND_ENABLED)'}${d.production_approved ? '' : ' · production not approved (run oceApproveProduction)'} · ${num(d.sent_today)}/${num(d.daily_limit)} sent today${d.blocked_reason ? ' · paused now: ' + esc(d.blocked_reason) : ''}`;
    $('campaignRows').innerHTML = list.length ? list.map((c) => `<tr>
      <td><b>${esc(c.name)}</b><div class="small muted">${esc(c.subject)}</div>${c.problems.length ? `<div class="small warn-text">${c.problems.map(esc).join('<br>')}</div>` : ''}</td>
      <td><span class="status s-${esc(String(c.status).toLowerCase())}">${esc(c.status)}</span></td>
      <td>${esc((segments.find((s) => s.segment_id === c.segment_id) || {}).segment_name || (c.segment_id ? c.segment_id : 'All eligible'))}</td>
      <td>${num(c.queue.pending)}</td><td>${num(c.queue.sent + c.queue.simulated)}${c.queue.simulated ? ' <small class="muted">(sim)</small>' : ''}</td><td>${num(c.queue.failed)}</td>
      <td class="btns">${campaignButtons(c)}</td></tr>`).join('') : '<tr><td colspan="7" class="muted">No campaigns yet.</td></tr>';
    $('campaignRows').querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => campaignAction(b.dataset.c, b.dataset.id, list, b)));
    renderRuleEditor();
  });
}
function campaignButtons(c) {
  const b = [`<button class="ghost small" data-c="edit" data-id="${esc(c.campaign_id)}">Edit</button>`];
  if (['DRAFT', 'PAUSED', 'COMPLETED'].includes(c.status)) b.push(`<button class="primary small" data-c="ACTIVE" data-id="${esc(c.campaign_id)}">Activate</button>`);
  if (c.status === 'ACTIVE') b.push(`<button class="ghost small" data-c="PAUSED" data-id="${esc(c.campaign_id)}">Pause</button>`, `<button class="ghost small" data-c="run" data-id="${esc(c.campaign_id)}">Run now</button>`);
  return b.join('');
}
function campaignAction(a, id, list, btn) {
  if (a === 'edit') return openEditor(list.find((c) => c.campaign_id === id));
  if (a === 'run') return guard(async () => { const r = await post('delivery.run', { campaign_id: id }); toast(r.skipped ? 'Not sent: ' + r.skipped : `Sent ${r.sent}, simulated ${r.simulated}, failed ${r.failed}.`, r.skipped ? 'warn' : 'ok'); await loadCampaigns(); }, btn);
  if (a === 'ACTIVE' && !confirm('Activate this campaign? Eligible contacts in the audience will be queued and processed automatically within the sending window.')) return;
  guard(async () => { await post('campaigns.status', { campaign_id: id, status: a }); toast('Campaign ' + a.toLowerCase()); await loadCampaigns(); }, btn);
}
function openEditor(c) {
  $('campaignEditor').classList.remove('hidden');
  $('previewBox').classList.add('hidden');
  $('ceTitle').textContent = c ? 'Edit: ' + c.name : 'New campaign';
  $('ceId').value = c ? c.campaign_id : '';
  [['ceName', 'name'], ['ceSubject', 'subject'], ['cePreheader', 'preheader'], ['ceBody', 'body_html'], ['ceFromName', 'from_name'], ['ceFromEmail', 'from_email'], ['ceReplyTo', 'reply_to'], ['ceDailyCap', 'daily_cap'], ['ceSegment', 'segment_id']]
    .forEach(([el, k]) => { $(el).value = c ? (c[k] ?? '') : ''; });
  $('campaignEditor').scrollIntoView({ behavior: 'smooth' });
}
$('newCampaign').addEventListener('click', () => openEditor(null));
$('ceClose').addEventListener('click', () => $('campaignEditor').classList.add('hidden'));
$('campaignForm').addEventListener('submit', (e) => {
  e.preventDefault();
  guard(async () => {
    const c = await post('campaigns.save', { campaign: {
      campaign_id: $('ceId').value || undefined, name: $('ceName').value, segment_id: $('ceSegment').value, subject: $('ceSubject').value, preheader: $('cePreheader').value,
      body_html: $('ceBody').value, from_name: $('ceFromName').value, from_email: $('ceFromEmail').value, reply_to: $('ceReplyTo').value, daily_cap: $('ceDailyCap').value
    } });
    $('ceId').value = c.campaign_id;
    toast(c.problems.length ? 'Saved. Before activating: ' + c.problems.join(' ') : 'Saved.', c.problems.length ? 'warn' : 'ok');
    await loadCampaigns();
  }, e.submitter);
});
$('cePreview').addEventListener('click', (e) => guard(async () => {
  if (!$('ceId').value) throw new Error('Save the campaign first.');
  const p = await api('campaigns.preview', { campaign_id: $('ceId').value });
  const box = $('previewBox');
  box.classList.remove('hidden');
  box.innerHTML = `<p><b>Audience:</b> ${num(p.audience)} eligible · <b>From:</b> ${esc(p.from)} · <b>Sample:</b> ${esc(p.sample_email)}</p><p><b>Subject:</b> ${esc(p.subject)}</p>${p.problems.length ? `<p class="warn-text">${p.problems.map(esc).join('<br>')}</p>` : ''}<iframe sandbox="" title="Preview"></iframe>`;
  box.querySelector('iframe').srcdoc = p.html;
}, e.currentTarget));
$('ceTest').addEventListener('click', (e) => guard(async () => {
  if (!$('ceId').value) throw new Error('Save the campaign first.');
  const r = await post('campaigns.send_test', { campaign_id: $('ceId').value });
  toast(r.sent ? `Sent ${r.sent} test e-mail(s) to ${r.recipient}.` : 'Test failed: ' + r.failed.join('; '), r.sent ? 'ok' : 'err');
}, e.currentTarget));

const FIELDS = ['category', 'country', 'location', 'organization', 'role', 'tags', 'email', 'lawful_basis', 'consent_status', 'source'];
const OPS = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'is_empty', 'not_empty'];
function renderRuleEditor() { if (!$('sgRules').children.length) addRule(); }
function addRule() {
  const row = document.createElement('div');
  row.className = 'rule';
  row.innerHTML = `<select class="f">${FIELDS.map((f) => `<option>${f}</option>`).join('')}</select><select class="o">${OPS.map((o) => `<option>${o}</option>`).join('')}</select><input class="v" placeholder="value"><button type="button" class="ghost small" aria-label="Remove">✕</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  $('sgRules').appendChild(row);
}
$('sgAdd').addEventListener('click', addRule);
$('sgSave').addEventListener('click', (e) => guard(async () => {
  const rules = [...$('sgRules').querySelectorAll('.rule')].map((r) => ({ field: r.querySelector('.f').value, operator: r.querySelector('.o').value, value: r.querySelector('.v').value }));
  const s = await post('segments.save', { segment: { segment_name: $('sgName').value || 'Segment', rules } });
  toast(`Segment saved: ${s.audience} eligible contacts match.`);
  await loadCampaigns();
  $('ceSegment').value = s.segment_id;
}, e.currentTarget));

/* ------------------------------------------------------------------ settings */
async function loadSettings() {
  $('endpoint').value = store.endpoint;
  $('apiKey').value = store.key;
  if (!store.key) return;
  await guard(async () => {
    const s = await api('settings.get');
    setConn(true);
    $('settingsFields').innerHTML = s.settings.filter((x) => x.editable).map((x) => {
      const bool = /^(TRUE|FALSE)$/i.test(x.value) && !/HOUR|LIMIT|SIZE|PAGES|DEPTH/.test(x.key);
      const input = x.key === 'DELIVERY_MODE' ? `<select name="${esc(x.key)}">${['DRY_RUN', 'TEST', 'PRODUCTION'].map((m) => `<option ${m === x.value ? 'selected' : ''}>${m}</option>`).join('')}</select>`
        : x.key === 'DELIVERY_PROVIDER' ? `<select name="${esc(x.key)}">${['RESEND', 'ENDPOINT'].map((m) => `<option ${m === x.value ? 'selected' : ''}>${m}</option>`).join('')}</select>`
          : bool ? `<select name="${esc(x.key)}"><option ${x.value === 'TRUE' ? 'selected' : ''}>TRUE</option><option ${x.value === 'FALSE' ? 'selected' : ''}>FALSE</option></select>`
            : `<input name="${esc(x.key)}" value="${esc(x.value)}">`;
      return `<label><span><b>${esc(x.key)}</b><small>${esc(x.description)}</small></span>${input}</label>`;
    }).join('');
    $('settingsFields').dataset.orig = JSON.stringify(Object.fromEntries(s.settings.map((x) => [x.key, x.value])));
    $('secretsList').innerHTML = s.secrets.map((x) => `<span class="tag ${x.configured ? 'ok' : ''}">${esc(x.key)}: ${x.configured ? 'set' : 'not set'}</span>`).join('');
  });
}
$('connForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const endpoint = $('endpoint').value.trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(endpoint) && !/^http:\/\/localhost(:\d+)?\/exec$/.test(endpoint)) return toast('The web app URL should look like https://script.google.com/macros/s/…/exec', 'err');
  store.save(endpoint, $('apiKey').value.trim());
  guard(async () => { await api('dashboard'); toast('Connected.'); show('overview'); }, e.submitter);
});
$('forget').addEventListener('click', () => { store.clear(); $('apiKey').value = ''; setConn(false); toast('Connection details removed from this browser.'); });
$('settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const orig = JSON.parse($('settingsFields').dataset.orig || '{}');
  const changed = {};
  new FormData(e.target).forEach((v, k) => { if (String(v) !== String(orig[k] ?? '')) changed[k] = v; });
  if (!Object.keys(changed).length) return toast('Nothing changed.');
  if (changed.DELIVERY_MODE === 'PRODUCTION' || changed.SEND_ENABLED === 'TRUE') {
    if (!confirm('You are enabling real e-mail delivery. Have you sent and checked a test e-mail, set your postal address and verified your sender domain?')) return;
  }
  guard(async () => { await post('settings.set', { settings: changed }); toast('Saved ' + Object.keys(changed).join(', ')); await loadSettings(); }, e.submitter);
});

/* ------------------------------------------------------------------ helpers */
function pager(el, d, go) {
  if (!d || d.total_pages <= 1) { el.innerHTML = d && d.total ? `<span class="muted">${num(d.total)} rows</span>` : ''; return; }
  el.innerHTML = `<button class="ghost small" ${d.page <= 1 ? 'disabled' : ''} data-p="${d.page - 1}">‹ Prev</button><span>Page ${d.page} of ${d.total_pages} · ${num(d.total)} rows</span><button class="ghost small" ${d.page >= d.total_pages ? 'disabled' : ''} data-p="${d.page + 1}">Next ›</button>`;
  el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.p))));
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

show(views.includes(location.hash.slice(1)) ? location.hash.slice(1) : (store.key ? 'overview' : 'settings'));
// Keep the sidebar badges (mode, pending reviews) current regardless of the opening view.
if (store.key && current !== 'overview') api('dashboard').then((d) => setConn(true, d)).catch(() => {});
