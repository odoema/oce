/* OCE Source Scout V3
 * LEGO block: mission -> automatic source planning -> discovery -> ranking -> queue.
 *
 * The normal operator experience is topic-first. Seed URLs are an internal
 * implementation detail and may be supplied only through the advanced override.
 * Discovery never bypasses login, CAPTCHA, paywalls or access controls.
 *
 * Mission Control owns the persistent queue on the main OCE mission page. This
 * legacy local queue remains available as a standalone scout LEGO, but it must
 * never paint over Mission Control's persistent counters or table.
 */

const SCOUT_STORAGE_KEY = 'oce_source_queue_v3';
const SCOUT_MAX_HARD = 100;
const SCOUT_SECOND_LEVEL_LIMIT = 8;

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
  let raw = String(value || '').trim().replace(/\\+$/g, '');
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname || '/';
    return url.toString().replace(/\/$/, '') || `${url.protocol}//${url.host}`;
  } catch (_) {
    return '';
  }
}

function scoutOrigin(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_) {
    return '';
  }
}

function scoutHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return '';
  }
}

function scoutIsCandidate(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  return !/\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|rar|7z|mp4|mp3|avi|mov|css|js|woff|woff2|ttf)(\?|$)/i.test(url.toLowerCase());
}

function scoutScore(url, topic, label) {
  const haystack = `${url} ${topic || ''} ${label || ''}`.toLowerCase();
  let score = 40;

  if (/contact|about|company|business|directory|member|members|supplier|vendor|partner|organization|organisation|association|registry|listing|market|services|team|staff|firm|firms|auditor|audit|accounting/.test(haystack)) score += 30;
  if (/uganda|ug\b|kampala|entebbe|jinja|gulu|mbarara|mbale|arua|nebbi|lira|fort portal|masaka/.test(haystack)) score += 10;

  String(topic || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8).forEach(term => {
    if (term.length > 2 && haystack.includes(term)) score += 4;
  });

  return Math.min(99, score);
}

function scoutParseManualSeeds() {
  return String(scout$('scoutSeeds').value || '')
    .replace(/\\n/g, '\n')
    .split(/[\r\n,]+/)
    .map(scoutNormalizeUrl)
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
}

function scoutSetProgress(percent, stage, detail) {
  const box = scout$('missionProgress');
  if (!box) return;
  box.classList.remove('hidden');
  const safe = Math.max(0, Math.min(100, Math.round(percent)));
  scout$('missionPercent').textContent = `${safe}%`;
  scout$('missionStage').textContent = stage;
  scout$('missionDetail').textContent = detail;
  scout$('missionProgressBar').style.width = `${safe}%`;
}

function scoutShowPlan(plan) {
  const box = scout$('discoveryPlan');
  if (!box) return;
  box.classList.remove('hidden');
  const names = (plan.seeds || []).slice(0, 4).map(seed => seed.name).join(' · ');
  scout$('discoveryPlanText').textContent = names
    ? `${plan.seeds.length} public sources selected automatically: ${names}${plan.seeds.length > 4 ? ' · …' : ''}`
    : 'No suitable public discovery sources were found yet.';
}

function scoutRenderQueue() {
  // Mission Control is the authoritative persistent queue on this page. Do not
  // let the legacy localStorage queue write 25/25/etc. over the real mission state.
  if (scout$('missionExpand')) return;

  const queue = scoutLoadQueue();
  const body = scout$('scoutQueueRows');
  scout$('scoutQueueCount').textContent = String(queue.length);
  scout$('scoutQueuedCount').textContent = String(queue.filter(x => x.status === 'QUEUED').length);
  scout$('scoutDoneCount').textContent = String(queue.filter(x => x.status === 'COMPLETED').length);
  scout$('scoutFailedCount').textContent = String(queue.filter(x => x.status === 'FAILED' || x.status === 'BLOCKED').length);

  body.innerHTML = queue.length
    ? queue.map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><span class="queue-priority">${item.priority}</span></td>
        <td><a href="${scoutEsc(item.url)}" target="_blank" rel="noopener">${scoutEsc(item.url)}</a></td>
        <td>${scoutEsc(item.source || 'automatic discovery')}</td>
        <td>${scoutEsc(item.status)}</td>
        <td>${scoutEsc(item.discovered_at ? new Date(item.discovered_at).toLocaleString() : '')}</td>
      </tr>`).join('')
    : '<tr><td colspan="6">No sources queued yet.</td></tr>';
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
  if (!response.ok || !payload || !payload.ok) throw new Error((payload && payload.error) || `Collector returned HTTP ${response.status}`);
  return payload.result;
}

async function scoutFetchResilient(seed) {
  try {
    return { result: await scoutFetch(seed), requested: seed, used: seed, recovered: false };
  } catch (primaryError) {
    const origin = scoutOrigin(seed);
    if (!origin || origin === seed) throw primaryError;
    try {
      return {
        result: await scoutFetch(origin), requested: seed, used: origin, recovered: true,
        recoveryMessage: `${seed} was unavailable; discovered from ${origin}.`
      };
    } catch (_) {
      throw primaryError;
    }
  }
}

function scoutCollectLinks(result, sourceUrl, topic, sameDomainOnly, allowedHosts, discovered, seen) {
  const links = Array.isArray(result && result.links) ? result.links : [];
  links.forEach(link => {
    const url = scoutNormalizeUrl(link && link.url);
    const label = String((link && link.label) || '').trim();
    if (!scoutIsCandidate(url)) return;
    if (sameDomainOnly && !allowedHosts.has(scoutHost(url))) return;
    if (!url || url === scoutNormalizeUrl(sourceUrl) || seen.has(url)) return;
    seen.add(url);
    discovered.push({
      url, source: sourceUrl, label,
      priority: scoutScore(url, topic, label), status: 'QUEUED',
      discovered_at: new Date().toISOString(), depth: 1
    });
  });
}

async function runScout() {
  if (!CONFIG.COLLECTOR_ENDPOINT) return scoutSetStatus('OCE is waiting for its deployed collector endpoint.');

  const topic = String(scout$('scoutTopic').value || '').trim();
  if (!topic) return scoutSetStatus('Tell OCE what you are looking for first.');

  const manualSeeds = scoutParseManualSeeds();
  const plan = manualSeeds.length
    ? { mode: 'MANUAL_OVERRIDE', topic, seeds: manualSeeds.map((url, i) => ({ id: `manual-${i + 1}`, name: 'Manual source', url, score: 80, source_type: 'MANUAL', discovery_reason: 'operator supplied' })) }
    : ocePlanDiscovery(topic, { country: 'UG', limit: 6 });

  if (!plan.seeds.length) return scoutSetStatus('OCE could not find suitable public discovery sources for that topic yet.');

  const maxSources = Math.min(SCOUT_MAX_HARD, Math.max(1, Number(scout$('scoutMax').value || 25)));
  const sameDomainOnly = scout$('scoutSameDomain').checked;
  const seeds = plan.seeds.map(seed => scoutNormalizeUrl(seed.url)).filter(Boolean);
  const seedHosts = new Set(seeds.map(scoutHost));
  const discovered = [];
  const seen = new Set(seeds);
  let completed = 0;
  let failures = 0;
  let recovered = 0;
  let secondLevelScans = 0;
  const messages = [];

  scout$('scoutRun').disabled = true;
  scout$('scoutRun').textContent = 'Running…';
  scoutSetProgress(5, 'Planning', `Selected ${seeds.length} public discovery sources for “${topic}”.`);
  scoutShowPlan(plan);
  scoutSetStatus('Discovery mission started…');

  try {
    const totalSeeds = seeds.length;
    for (let i = 0; i < seeds.length; i += 1) {
      const seed = seeds[i];
      scoutSetProgress(10 + ((i / totalSeeds) * 25), 'Discovering public sources', `Opening discovery source ${i + 1} of ${totalSeeds}.`);
      try {
        const fetched = await scoutFetchResilient(seed);
        completed += 1;
        if (fetched.recovered) {
          recovered += 1;
          messages.push(fetched.recoveryMessage);
        }
        scoutCollectLinks(fetched.result, fetched.used, topic, sameDomainOnly, seedHosts, discovered, seen);
      } catch (error) {
        failures += 1;
        messages.push(`${seed}: ${String(error.message || error)}`);
      }
    }

    scoutSetProgress(42, 'Expanding discovery', `${discovered.length} candidate pages found. Following the strongest public pages for deeper discovery.`);

    const level2Candidates = discovered
      .slice()
      .sort((a, b) => b.priority - a.priority)
      .slice(0, SCOUT_SECOND_LEVEL_LIMIT);

    for (let i = 0; i < level2Candidates.length; i += 1) {
      if (discovered.length >= maxSources * 3) break;
      const candidate = level2Candidates[i];
      scoutSetProgress(42 + ((i / Math.max(1, level2Candidates.length)) * 18), 'Expanding discovery', `Checking high-value page ${i + 1} of ${level2Candidates.length}.`);
      try {
        const fetched = await scoutFetchResilient(candidate.url);
        secondLevelScans += 1;
        const links = Array.isArray(fetched.result && fetched.result.links) ? fetched.result.links : [];
        links.forEach(link => {
          const url = scoutNormalizeUrl(link && link.url);
          const label = String((link && link.label) || '').trim();
          if (!scoutIsCandidate(url)) return;
          if (sameDomainOnly && !seedHosts.has(scoutHost(url))) return;
          if (seen.has(url)) return;
          seen.add(url);
          discovered.push({
            url, source: candidate.url, label,
            priority: Math.min(99, scoutScore(url, topic, label) + 5), status: 'QUEUED',
            discovered_at: new Date().toISOString(), depth: 2
          });
        });
      } catch (error) {
        messages.push(`${candidate.url}: ${String(error.message || error)}`);
      }
    }

    scoutSetProgress(64, 'Ranking sources', `Ranking ${discovered.length} candidate pages against the mission topic.`);

    const unique = discovered
      .sort((a, b) => b.priority - a.priority)
      .slice(0, maxSources);

    const added = scoutAddQueue(unique);

    scoutSetProgress(72, 'Queue prepared', `${added} new sources are ready for controlled collection.`);

    let status = `Discovery complete. ${added} new source${added === 1 ? '' : 's'} queued from ${completed} public discovery source${completed === 1 ? '' : 's'}.`;
    if (secondLevelScans) status += ` ${secondLevelScans} deeper page${secondLevelScans === 1 ? '' : 's'} explored.`;
    if (recovered) status += ` ${recovered} source${recovered === 1 ? '' : 's'} recovered via site root.`;
    if (failures) status += ` ${failures} source${failures === 1 ? '' : 's'} failed.`;
    status += ' Persistent collection will continue in the Queue Worker block.';

    scoutSetStatus(status);
    scoutSetProgress(72, 'Discovery complete', 'The next stage is persistent collection and result tracking.');

    if (messages.length && failures) console.info('OCE Source Scout diagnostics:', messages);
  } finally {
    scout$('scoutRun').disabled = false;
    scout$('scoutRun').textContent = 'Start Discovery';
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
