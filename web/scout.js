/* OCE Source Scout V2
 * LEGO block: seed URLs -> resilient discovery -> normalize -> deduplicate -> score -> queue
 * Discovery only. It never bypasses login, CAPTCHA, paywalls or access controls.
 * It does not automatically scrape the discovered queue.
 */

const SCOUT_STORAGE_KEY = 'oce_source_queue_v2';
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
  localStorage.setItem(
    SCOUT_STORAGE_KEY,
    JSON.stringify(queue.slice(0, SCOUT_MAX_HARD))
  );
}

function scoutNormalizeUrl(value) {
  let raw = String(value || '')
    .trim()
    .replace(/\\+$/g, '');

  if (!raw) return '';

  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }

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
  const lower = url.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|rar|7z|mp4|mp3|avi|mov|css|js|woff|woff2|ttf)(\?|$)/i.test(lower)) return false;
  return true;
}

function scoutScore(url, topic, label) {
  const haystack = `${url} ${topic || ''} ${label || ''}`.toLowerCase();
  let score = 40;

  if (/contact|about|company|business|directory|member|members|supplier|vendor|partner|organization|organisation|association|registry|listing|market|services|team|staff/.test(haystack)) {
    score += 30;
  }

  if (/uganda|ug\b|kampala|entebbe|jinja|gulu|mbarara|mbale|arua|nebbi|lira|fort portal|masaka/.test(haystack)) {
    score += 10;
  }

  const terms = String(topic || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 8);

  terms.forEach(term => {
    if (term.length > 2 && haystack.includes(term)) score += 4;
  });

  return Math.min(99, score);
}

function scoutParseSeeds() {
  return String(scout$('scoutSeeds').value || '')
    .replace(/\\n/g, '\n')
    .split(/[\r\n,]+/)
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

  body.innerHTML = queue.length
    ? queue.map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><span class="queue-priority">${item.priority}</span></td>
        <td><a href="${scoutEsc(item.url)}" target="_blank" rel="noopener">${scoutEsc(item.url)}</a></td>
        <td>${scoutEsc(item.source || 'discovery')}</td>
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
  const response = await fetch(endpoint, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store'
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload || !payload.ok) {
    throw new Error((payload && payload.error) || `Collector returned HTTP ${response.status}`);
  }

  return payload.result;
}

async function scoutFetchResilient(seed) {
  try {
    return {
      result: await scoutFetch(seed),
      requested: seed,
      used: seed,
      recovered: false
    };
  } catch (primaryError) {
    const origin = scoutOrigin(seed);

    if (!origin || origin === seed) {
      throw primaryError;
    }

    /*
     * If a supplied path is dead, try the public site root.
     * This is recovery, not access-control bypass.
     */
    try {
      return {
        result: await scoutFetch(origin),
        requested: seed,
        used: origin,
        recovered: true,
        recoveryMessage: `${seed} was unavailable; discovered from ${origin}.`
      };
    } catch (_) {
      throw primaryError;
    }
  }
}

function scoutCollectLinks(result, sourceUrl, topic, sameDomainOnly, allowedHosts, discovered) {
  const links = Array.isArray(result && result.links) ? result.links : [];

  links.forEach(link => {
    const url = scoutNormalizeUrl(link && link.url);
    const label = String((link && link.label) || '').trim();

    if (!scoutIsCandidate(url)) return;
    if (sameDomainOnly && !allowedHosts.has(scoutHost(url))) return;
    if (!url || url === scoutNormalizeUrl(sourceUrl)) return;

    discovered.push({
      url,
      source: sourceUrl,
      label,
      priority: scoutScore(url, topic, label),
      status: 'QUEUED',
      discovered_at: new Date().toISOString(),
      depth: 1
    });
  });
}

async function runScout() {
  if (!CONFIG.COLLECTOR_ENDPOINT) {
    return scoutSetStatus('OCE is waiting for its deployed collector endpoint.');
  }

  const seeds = scoutParseSeeds();
  if (!seeds.length) {
    return scoutSetStatus('Enter at least one public seed URL for the Source Scout.');
  }

  const maxSources = Math.min(
    SCOUT_MAX_HARD,
    Math.max(1, Number(scout$('scoutMax').value || 25))
  );

  const topic = String(scout$('scoutTopic').value || '').trim();
  const sameDomainOnly = scout$('scoutSameDomain').checked;
  const seedHosts = new Set(seeds.map(scoutHost));
  const discovered = [];
  const seen = new Set(seeds.map(scoutNormalizeUrl));

  let completed = 0;
  let failures = 0;
  let recovered = 0;
  let secondLevelScans = 0;
  const messages = [];

  scout$('scoutRun').disabled = true;
  scout$('scoutRun').textContent = 'Scouting…';
  scoutSetStatus(`Scouting ${seeds.length} seed${seeds.length === 1 ? '' : 's'}…`);

  try {
    /* LEVEL 1: scan every seed. */
    for (const seed of seeds) {
      try {
        const fetched = await scoutFetchResilient(seed);
        completed += 1;
        if (fetched.recovered) {
          recovered += 1;
          messages.push(fetched.recoveryMessage);
        }

        scoutCollectLinks(
          fetched.result,
          fetched.used,
          topic,
          sameDomainOnly,
          seedHosts,
          discovered
        );
      } catch (error) {
        failures += 1;
        messages.push(`${seed}: ${String(error.message || error)}`);
      }
    }

    /*
     * LEVEL 2: follow the best few discovered public pages.
     * This makes Scout useful on directory landing pages where
     * the first page only links to category/member pages.
     */
    const level2Candidates = discovered
      .filter(item => !seen.has(item.url))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, SCOUT_SECOND_LEVEL_LIMIT);

    for (const candidate of level2Candidates) {
      if (discovered.length >= maxSources * 3) break;

      try {
        const fetched = await scoutFetchResilient(candidate.url);
        secondLevelScans += 1;

        const links = Array.isArray(fetched.result && fetched.result.links)
          ? fetched.result.links
          : [];

        links.forEach(link => {
          const url = scoutNormalizeUrl(link && link.url);
          const label = String((link && link.label) || '').trim();

          if (!scoutIsCandidate(url)) return;
          if (sameDomainOnly && !seedHosts.has(scoutHost(url))) return;
          if (seen.has(url)) return;

          discovered.push({
            url,
            source: candidate.url,
            label,
            priority: Math.min(99, scoutScore(url, topic, label) + 5),
            status: 'QUEUED',
            discovered_at: new Date().toISOString(),
            depth: 2
          });

          seen.add(url);
        });
      } catch (error) {
        messages.push(`${candidate.url}: ${String(error.message || error)}`);
      }
    }

    const unique = [];
    const finalSeen = new Set();

    discovered
      .sort((a, b) => b.priority - a.priority)
      .forEach(item => {
        if (unique.length >= maxSources) return;
        if (finalSeen.has(item.url)) return;
        finalSeen.add(item.url);
        unique.push(item);
      });

    const added = scoutAddQueue(unique);

    let status = `Scout complete. ${added} new source${added === 1 ? '' : 's'} queued. `;
    status += `${completed} seed${completed === 1 ? '' : 's'} opened`;
    if (secondLevelScans) status += ` + ${secondLevelScans} deeper page${secondLevelScans === 1 ? '' : 's'}`;
    status += '.';

    if (recovered) status += ` ${recovered} seed${recovered === 1 ? '' : 's'} recovered via site root.`;
    if (failures) status += ` ${failures} seed${failures === 1 ? '' : 's'} failed.`;

    if (added === 0 && completed === 0) {
      status += ' No accessible public seed was found.';
    } else if (added === 0) {
      status += ' The accessible page did not expose additional candidate links.';
    }

    scoutSetStatus(status);

    if (messages.length && failures) {
      console.info('OCE Source Scout diagnostics:', messages);
    }
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
  const blob = new Blob([
    JSON.stringify({
      exported_at: new Date().toISOString(),
      queue
    }, null, 2)
  ], { type: 'application/json' });

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
