/* OCE Discovery Intelligence V1.0
 * LEGO block: objective -> query expansion -> candidate search -> ranked candidates.
 * This module does NOT replace the persistent queue or recursive crawler.
 * It only produces candidate URLs that a later gateway/mission step may inject
 * through the existing registerAndQueueSource() path.
 */

const OCE_DISCOVERY_INTELLIGENCE = {
  VERSION: '1.0.0',
  MAX_QUERIES: 12,
  MAX_CANDIDATES: 50,
  PROVIDER: 'BING_RSS'
};

function buildDiscoveryPlan(objective) {
  const text = String(objective || '').trim();
  if (!text) throw Error('Discovery objective is required.');

  const normalized = normalizeDiscoveryObjective_(text);
  const location = inferLocation_(normalized);
  const entity = inferEntity_(normalized, location);
  const queries = expandDiscoveryQueries_(normalized, entity, location);

  return {
    ok: true,
    version: OCE_DISCOVERY_INTELLIGENCE.VERSION,
    objective: text,
    entity: entity,
    location: location,
    queries: queries.slice(0, OCE_DISCOVERY_INTELLIGENCE.MAX_QUERIES),
    source_hints: buildSourceHints_(entity, location),
    generated_at: new Date().toISOString()
  };
}

function discoverSearchCandidates(objective) {
  const plan = buildDiscoveryPlan(objective);
  const candidates = [];
  const seen = {};

  plan.queries.forEach(function(query, queryIndex) {
    if (candidates.length >= OCE_DISCOVERY_INTELLIGENCE.MAX_CANDIDATES) return;

    const items = searchBingRss_(query);
    items.forEach(function(item) {
      if (candidates.length >= OCE_DISCOVERY_INTELLIGENCE.MAX_CANDIDATES) return;
      const url = canonicalDiscoveryUrl_(item.url);
      if (!url || seen[url]) return;
      seen[url] = true;

      const score = scoreDiscoveryCandidate_(url, item.title, item.description, plan, queryIndex);
      candidates.push({
        url: url,
        title: item.title || '',
        description: item.description || '',
        query: query,
        provider: OCE_DISCOVERY_INTELLIGENCE.PROVIDER,
        score: score,
        source_type: classifyDiscoverySource_(url, plan),
        provenance: 'DISCOVERY_INTELLIGENCE_V1'
      });
    });
  });

  candidates.sort(function(a, b) { return b.score - a.score; });
  return {
    ok: true,
    version: OCE_DISCOVERY_INTELLIGENCE.VERSION,
    objective: plan.objective,
    plan: plan,
    candidate_count: candidates.length,
    candidates: candidates
  };
}

function queueDiscoveryCandidates(objective, maxCandidates) {
  const result = discoverSearchCandidates(objective);
  if (!result.candidates.length) {
    return {ok:true, objective:result.objective, discovered:0, attempted:0, queued:0, results:[]};
  }

  const requested = Number(maxCandidates || result.candidates.length);
  const limit = Math.max(1, Math.min(requested, result.candidates.length));
  const queued = [];

  for (let i = 0; i < limit; i++) {
    const candidate = result.candidates[i];
    try {
      const queuedResult = registerAndQueueSource({
        url: candidate.url,
        source_type: candidate.source_type,
        topic: result.objective,
        label: candidate.title,
        priority: candidate.score,
        provenance: candidate.provenance,
        notes: 'Search candidate via ' + candidate.provider + '; query=' + candidate.query
      });
      queued.push({
        url: candidate.url,
        score: candidate.score,
        status: queuedResult.status,
        queue_id: queuedResult.queue_id || ''
      });
    } catch (err) {
      queued.push({
        url: candidate.url,
        score: candidate.score,
        status: 'FAILED',
        error: String(err.message || err)
      });
    }
  }

  return {
    ok: true,
    objective: result.objective,
    discovered: result.candidate_count,
    attempted: limit,
    queued: queued.filter(function(item) { return item.status === 'QUEUED'; }).length,
    results: queued
  };
}

function searchBingRss_(query) {
  const endpoint = 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(query);
  try {
    const response = UrlFetchApp.fetch(endpoint, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true
    });
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) return [];

    const document = XmlService.parse(response.getContentText());
    const root = document.getRootElement();
    const channel = root.getChild('channel');
    if (!channel) return [];

    return channel.getChildren('item').map(function(item) {
      return {
        title: childText_(item, 'title'),
        url: childText_(item, 'link'),
        description: childText_(item, 'description')
      };
    });
  } catch (err) {
    console.warn('Bing RSS discovery failed: ' + String(err.message || err));
    return [];
  }
}

function expandDiscoveryQueries_(objective, entity, location) {
  const queries = [];
  const base = [entity, location].filter(Boolean).join(' ').trim() || objective;
  const variants = [
    base,
    base + ' directory',
    base + ' list',
    base + ' registry',
    base + ' database',
    base + ' official',
    base + ' association',
    base + ' providers',
    base + ' organizations',
    base + ' companies',
    'site:go.ug ' + base,
    'site:org ' + base
  ];

  variants.forEach(function(query) {
    const clean = String(query || '').replace(/\s+/g, ' ').trim();
    if (clean && queries.indexOf(clean) < 0) queries.push(clean);
  });

  if (queries.length === 0) queries.push(objective);
  return queries;
}

function buildSourceHints_(entity, location) {
  const text = String(entity || '').toLowerCase();
  const hints = ['DIRECTORY', 'REGISTRY', 'ORGANIZATION', 'OFFICIAL_WEBSITE'];
  if (/hospital|health|clinic|medical/.test(text)) hints.unshift('HEALTH_FACILITY');
  if (/school|university|college|education/.test(text)) hints.unshift('EDUCATION');
  if (/company|business|supplier|vendor|enterprise/.test(text)) hints.unshift('BUSINESS');
  if (location) hints.push('LOCAL_OR_REGIONAL');
  return hints.filter(function(value, index, array) { return array.indexOf(value) === index; });
}

function scoreDiscoveryCandidate_(url, title, description, plan, queryIndex) {
  const text = (String(url || '') + ' ' + String(title || '') + ' ' + String(description || '')).toLowerCase();
  let score = 50 - Math.min(queryIndex * 2, 20);

  if (plan.location && text.indexOf(plan.location.toLowerCase()) >= 0) score += 12;
  if (plan.entity && text.indexOf(plan.entity.toLowerCase()) >= 0) score += 15;
  if (/\.go\.ug\b/.test(String(url || '').toLowerCase())) score += 15;
  if (/\.(gov|org|edu)(\.[a-z]{2})?$/.test(getHostname_(url))) score += 8;
  if (/directory|registry|register|database|official|association/.test(text)) score += 5;
  if (/facebook|instagram|twitter|x\.com|youtube|tiktok/.test(getHostname_(url))) score -= 15;
  if (/login|signup|account|cart|checkout/.test(text)) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function classifyDiscoverySource_(url, plan) {
  const host = getHostname_(url).toLowerCase();
  if (/\.go\.ug$/.test(host)) return 'GOVERNMENT_SOURCE';
  if (/\.edu\.ug$/.test(host)) return 'EDUCATION_SOURCE';
  if (/\.org$/.test(host)) return 'ORGANIZATION_SOURCE';
  if (plan.source_hints.indexOf('BUSINESS') >= 0) return 'BUSINESS_SOURCE';
  return 'WEB_SOURCE';
}

function inferLocation_(text) {
  const known = ['uganda', 'kampala', 'northern uganda', 'west nile', 'gulu', 'arua', 'nebbi', 'jinja', 'mbarara'];
  const lower = text.toLowerCase();
  for (let i = 0; i < known.length; i++) {
    if (lower.indexOf(known[i]) >= 0) return known[i];
  }
  return '';
}

function inferEntity_(text, location) {
  let entity = text;
  if (location) entity = entity.replace(new RegExp('\\b' + escapeRegExp_(location) + '\\b', 'ig'), '');
  return entity.replace(/\b(in|within|around|near|for)\b/gi, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeDiscoveryObjective_(text) {
  return text.replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function canonicalDiscoveryUrl_(value) {
  let url = String(value || '').trim();
  if (!/^https?:\/\//i.test(url)) return '';
  url = url.replace(/#.*$/, '');
  return url.length > 2048 ? '' : url;
}

function getHostname_(url) {
  const match = String(url || '').match(/^https?:\/\/([^\/]+)/i);
  return match ? match[1].toLowerCase() : '';
}

function childText_(element, name) {
  const child = element.getChild(name);
  return child ? child.getText() : '';
}

function escapeRegExp_(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function testDiscoveryIntelligence() {
  const plan = buildDiscoveryPlan('Hospitals in Uganda');
  console.log(JSON.stringify(plan, null, 2));
  return plan;
}
