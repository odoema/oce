/* OCE Source Scout V1
 * LEGO block: seed URLs -> discover links -> normalize -> deduplicate -> score -> queue
 * This block does not scrape the queue automatically. It feeds the existing collector safely.
 */

const SCOUT_STORAGE_KEY = 'oce_source_queue_v1';
const SCOUT_MAX_HARD = 100;

function scout$(id) {
  return document.getElementById(id);
}

function scoutEsc(value) {
  return String(value ?? '').replace(/[&<>\"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;'
  }[c]));
}

function scoutLoadQueue() {
  try {
    const raw = localStorage.getItem(SCOUT_STORAGE_KEY);
    const queue = raw ? JSON.parse(raw) : [];
    return Array.isArray(queue) ? queue : [];
  } catch (_) {
    return [];
  }
}

function scoutSaveQueue(queue) {
  localStorage.setItem(SCOUT_STORAGE_KEY, JSON.stringify(queue.slice(0, SCOUT_MAX_HARD)));
}

function scoutNormalizeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname || '/';
    return url.toString().replace(/\/$/, '') || `${url.protocol}//${url.host}`;
  } catch (_) {
    return '';
  }
}

function scoutHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
}

function scoutIsCandidate(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const lower = url.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|rar|mp4|mp3|avi|mov|css|js|xml)(\?|$)/i.test(lower)) return false;
  return true;
}

function scoutScore(url, topic) {
  const haystack = `${url} ${topic || ''}`.toLowerCase();
  let score = 40;
  if (/contact|about|company|business|directory|member|members|supplier|vendor|partner|organization|organisation/.test(url.toLowerCase())) score += 30;
  if (/uganda|ug|kampala|entebbe|jinja|gulu|mbarara|mbale|arua|nebbi/.test(url.toLowerCase())) score += 10;
  const terms = String(topic || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8);
  terms.forEach(term => { if (term.length > 2 && haystack.includes(term)) score += 4; });
  return Math.min(99, score);
}

function scoutParseSeeds() {
  return String(scout$('scoutSeeds').value || '')
    .split(/\r?\n|,/)
    .map(scoutNormalizeUrl)
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
}

function scoutRenderQueue() {
  const queue = scoutLoadQueue();
  const body = scout$('scoutQueueRows');
  scout$('scoutQueueCount').textContent = String(queue.length);
  scout$('scoutQueuedCount').textContent = String(queue.filter(x => x.status === 'QUEUED').length);
  scout$('scoutDoneCount').textContent = String(queue.filter(x => x.status === 'COMPLETED').length);
  scout$('scoutFailedCount').textContent = String(queue.filter(x => x.status === 'FAILED' || x.status === 'BLOCKED').length);

  body.innerHTML = queue.length ? queue.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><span class="queue-priority">${item.priority}</span></td>
      <td><a href="${scoutEsc(item.url)}" target="_blank" rel="noopener">${scoutEsc(item.url)}</a></td>
      <td>${scoutEsc(item.source || 'discovery')}</td>
      <td>${scoutEsc(item.status)}</td>
      <td>${scoutEsc(item.discovered_at ? new Date(item.discovered_at).toLocaleString() : '')}</td>
    </tr>`).join('') : '<tr><td colspan="6">No sources queued yet.</td></tr>';
}

function scoutAddQueue(items) {
  const queue = scoutLoadQueue();
  const known = new Set(queue.map(item => item.url));
  let added = 0;

  items.forEach(item => {
    if (!item.url || known.has(item.url)) return;
    known.add(item.url);
    queue.push(item);
    added += 1;
  });

  queue.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
  scoutSaveQueue(queue);
  scoutRenderQueue();
  return added;
}

async function scoutFetch(seed) {
  const endpoint = `${CONFIG.COLLECTOR_ENDPOINT}?url=${encodeURIComponent(seed)}`;
  const response = await fetch(endpoint, { method: 'GET', redirect: 'follow', cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !payload.ok) {
    throw new Error((payload && payload.error) || `Collector returned HTTP ${response.status}`);
  }
  return payload.result;
}

async function runScout() {
  if (!CONFIG.COLLECTOR_ENDPOINT) return setStatus('OCE is waiting for its deployed collector endpoint.');

  const seeds = scoutParseSeeds();
  if (!seeds.length) return setStatus('Enter at least one public seed URL for the Source Scout.');

  const maxSources = Math.min(
    SCOUT_MAX_HARD,
    Math.max(1, Number(scout$('scoutMax').value || 25))
  );
  const topic = String(scout$('scoutTopic').value || '').trim();
  const sameDomainOnly = scout$('scoutSameDomain').checked;
  const seedHosts = new Set(seeds.map(scoutHost));
  const discovered = [];
  let completed = 0;
  let failures = 0;

  scout$('scoutRun').disabled = true;
  scout$('scoutRun').textContent = 'Scouting…';
  scoutSetStatus(`Scouting ${seeds.length} seed source${seeds.length === 1 ? '' : 's'}…`);

  try {
    for (const seed of seeds) {
      if (discovered.length >= maxSources) break;

      try {
        const result = await scoutFetch(seed);
        completed += 1;

        const links = Array.isArray(result.links) ? result.links : [];
        links.forEach(link => {
          const url = scoutNormalizeUrl(link && link.url);
          if (!scoutIsCandidate(url)) return;
          if (sameDomainOnly && !seedHosts.has(scoutHost(url))) return;
          if (url === seed) return;
          discovered.push({
            url,
            source: seed,
            label: String((link && link.label) || '').trim(),
            priority: scoutScore(`${url} ${(link && link.label) || ''}`, topic),
            status: 'QUEUED',
            discovered_at: new Date().toISOString(),
            depth: 1
          });
        });
      } catch (_) {
        failures += 1;
      }
    }

    const unique = [];
    const seen = new Set();
    discovered
      .sort((a, b) => b.priority - a.priority)
      .forEach(item => {
        if (seen.has(item.url) || unique.length >= maxSources) return;
        seen.add(item.url);
        unique.push(item);
      });

    const added = scoutAddQueue(unique);
    scoutSetStatus(`Scout complete. ${added} new source${added === 1 ? '' : 's'} queued from ${completed} seed${completed === 1 ? '' : 's'}. ${failures ? failures + ' seed(s) failed.' : 'No seed failures.'}`);
  } finally {
    scout$('scoutRun').disabled = false;
    scout$('scoutRun').textContent = 'Find & Queue Sources';
  }
}

function scoutSetStatus(text) {
  const el = scout$('scoutStatus');
  el.textContent = text;
  el.classList.remove('hidden');
}

function scoutExportQueue() {
  const queue = scoutLoadQueue();
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), queue }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'oce-source-queue.json';
  link.click();
  URL.revokeObjectURL(url);
}

function scoutClearQueue() {
  if (!confirm('Clear the local OCE source queue? This does not delete anything from a remote source.')) return;
  localStorage.removeItem(SCOUT_STORAGE_KEY);
  scoutRenderQueue();
  scoutSetStatus('Source queue cleared.');
}

function scoutInspect(url) {
  scout$('url').value = url;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initScout() {
  if (!scout$('scoutRun')) return;
  scout$('scoutRun').onclick = runScout;
  scout$('scoutExport').onclick = scoutExportQueue;
  scout$('scoutClear').onclick = scoutClearQueue;
  scout$('scoutQueueRows').addEventListener('click', event => {
    const anchor = event.target.closest('a');
    if (!anchor) return;
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    scoutInspect(anchor.href);
  });
  scoutRenderQueue();
}

document.addEventListener('DOMContentLoaded', initScout);
