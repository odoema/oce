/* OCE Discovery Intelligence V3
 * LEGO block: objective -> query expansion -> external search candidates -> ranked seeds.
 *
 * The crawler remains the collection engine. This block only discovers candidate URLs and ranks them.
 * No API key is stored in source code. Configure Script Properties:
 *   OCE_SEARCH_PROVIDER=BRAVE
 *   OCE_SEARCH_API_KEY=<secret>
 *
 * Brave's Web Search API is used as a candidate generator. Search results are never treated as facts;
 * OCE queues the URLs for its normal robots-aware crawler and extracts evidence from the source itself.
 */

const OCE_DISCOVERY = {
  VERSION: '3.0.0',
  MAX_QUERIES: 10,
  RESULTS_PER_QUERY: 20,
  MAX_CANDIDATES: 60,
  DEFAULT_SEEDS: 8,
  PROVIDER: 'BRAVE'
};

// Curated authoritative sources remain useful, but only as supplemental hints for matching geographies.
const OCE_DISCOVERY_CATALOG = [
  { id: 'icpau-firms', name: 'ICPAU licensed firms portal', url: 'https://icpauportal.com/external_portal/firms', country: 'UG', keywords: ['auditor', 'audit', 'accountant', 'accounting', 'cpa', 'assurance', 'tax', 'professional'], authority: 99, type: 'REGULATORY_REGISTER' },
  { id: 'icpau', name: 'Institute of Certified Public Accountants of Uganda', url: 'https://www.icpau.co.ug/accountancy-practice', country: 'UG', keywords: ['auditor', 'audit', 'accountant', 'accounting', 'cpa', 'assurance', 'tax'], authority: 98, type: 'PROFESSIONAL_BODY' },
  { id: 'ursb', name: 'Uganda Registration Services Bureau', url: 'https://ursb.go.ug/search-ursb-registries/', country: 'UG', keywords: ['business', 'company', 'supplier', 'vendor', 'firm', 'organization', 'organisation', 'ngo', 'registry'], authority: 98, type: 'BUSINESS_REGISTRY' },
  { id: 'yellow-uganda', name: 'Yellow Uganda business directory', url: 'https://www.yellow.ug/', country: 'UG', keywords: ['business', 'company', 'supplier', 'vendor', 'restaurant', 'hotel', 'retail', 'service', 'directory', 'shop'], authority: 78, type: 'BUSINESS_DIRECTORY' },
  { id: 'startup-uganda', name: 'Startup Uganda directory', url: 'https://portal.startup.ug/directory', country: 'UG', keywords: ['startup', 'business', 'technology', 'tech', 'company', 'innovation'], authority: 82, type: 'STARTUP_DIRECTORY' },
  { id: 'myugandaonline', name: 'MyUgandaOnline directory', url: 'https://myugandaonline.com/directory.php', country: 'UG', keywords: ['business', 'company', 'supplier', 'vendor', 'directory', 'service'], authority: 70, type: 'BUSINESS_DIRECTORY' },
  { id: 'companydata-uganda', name: 'CompanyData Uganda directory', url: 'https://companydata.com/directory/business-directory-uganda/', country: 'UG', keywords: ['business', 'company', 'firm', 'directory'], authority: 68, type: 'BUSINESS_DIRECTORY' }
];

function discoveryTokens_(topic) {
  return String(topic || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter(function (t) { return t.length > 2; })
    .map(function (t) { return t.replace(/(ies)$/, 'y').replace(/s$/, ''); })
    .slice(0, 18);
}

function discoveryCountryCode_(topic) {
  const t = String(topic || '').toLowerCase();
  const map = {
    uganda: 'UG', ugandan: 'UG', kenya: 'KE', kenyan: 'KE', tanzania: 'TZ',
    rwanda: 'RW', burundi: 'BI', nigeria: 'NG', ghana: 'GH', zambia: 'ZM',
    zimbabwe: 'ZW', malawi: 'MW', ethiopia: 'ET', southafrica: 'ZA', 'south africa': 'ZA',
    usa: 'US', 'united states': 'US', uk: 'GB', 'united kingdom': 'GB', canada: 'CA',
    australia: 'AU', india: 'IN'
  };
  const keys = Object.keys(map).sort(function (a, b) { return b.length - a.length; });
  for (let i = 0; i < keys.length; i++) if (t.indexOf(keys[i]) >= 0) return map[keys[i]];
  return '';
}

function discoveryQueryVariants_(objective) {
  const base = String(objective || '').replace(/\s+/g, ' ').trim();
  const variants = [
    base,
    base + ' list',
    base + ' directory',
    base + ' registry',
    base + ' official',
    base + ' association',
    base + ' providers',
    base + ' database'
  ];
  const country = discoveryCountryCode_(base);
  if (country) {
    variants.push(base + ' site:gov.' + country.toLowerCase());
    variants.push(base + ' site:org.' + country.toLowerCase());
  } else {
    variants.push(base + ' site:gov');
    variants.push(base + ' site:org');
  }
  const seen = {};
  return variants.filter(function (q) {
    q = q.replace(/\s+/g, ' ').trim();
    if (!q || seen[q.toLowerCase()]) return false;
    seen[q.toLowerCase()] = true;
    return true;
  }).slice(0, OCE_DISCOVERY.MAX_QUERIES);
}

function discoveryCatalogSeeds_(topic, limit) {
  const tokens = discoveryTokens_(topic);
  const country = discoveryCountryCode_(topic);
  if (!country) return [];
  return OCE_DISCOVERY_CATALOG.map(function (entry) {
    let match = 0;
    tokens.forEach(function (token) {
      if (entry.keywords.some(function (k) { return k === token || (token.length > 3 && (k.indexOf(token) === 0 || token.indexOf(k) === 0)); })) match += 1;
    });
    if (entry.country !== country || match === 0) return null;
    return {
      name: entry.name,
      url: ouCanonicalUrl_(entry.url),
      score: Math.min(99, Math.round(entry.authority * 0.55 + Math.min(match, 3) * 14)),
      source_type: entry.type,
      reason: 'curated authoritative source: geography + topic match',
      provenance: 'DISCOVERY_CATALOG'
    };
  }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, limit);
}

function scoreSearchCandidate_(result, objective, queryHits) {
  const url = String(result.url || '');
  const title = String(result.title || '');
  const description = String(result.description || '');
  const hay = (url + ' ' + title + ' ' + description).toLowerCase();
  const host = ouHostOf_(url);
  const path = url.replace(/^https?:\/\/[^\/]+/i, '');
  const tokens = discoveryTokens_(objective);
  let score = 42;
  let authority = 0;
  const reasons = [];

  if (/\.(gov|gov\.[a-z]{2,}|edu|edu\.[a-z]{2,})$/i.test(host)) { score += 24; authority += 24; reasons.push('public-sector/education domain'); }
  else if (/\.(org|org\.[a-z]{2,})$/i.test(host)) { score += 14; authority += 14; reasons.push('organization domain'); }
  if (discoveryCountryCode_(objective) && /\.(ug|ke|tz|rw|ng|gh|za|zm|zw|mw|et)$/i.test(host)) { score += 7; authority += 7; reasons.push('geographic domain match'); }
  if (/(directory|directories|registry|register|association|member|members|listing|listings|providers|companies|businesses|firms|find|database)/i.test(path + ' ' + title)) { score += 13; reasons.push('directory/registry signal'); }
  if (result.is_source_local || result.is_source_both) { score += 4; reasons.push('search provider local signal'); }

  let matches = 0;
  tokens.forEach(function (token) { if (hay.indexOf(token) >= 0) matches += 1; });
  if (matches) { score += Math.min(22, matches * 4); reasons.push(matches + ' objective term matches'); }
  if (queryHits > 1) { score += Math.min(10, queryHits * 2); reasons.push('found by multiple query variants'); }
  if (/(facebook|instagram|linkedin|tiktok|youtube|x\.com|twitter|login|signin|signup|checkout|cart)/i.test(host + path)) { score -= 25; reasons.push('low-value/navigation signal'); }
  if (/\.(pdf|jpg|jpeg|png|gif|zip|docx?|xlsx?|pptx?)($|\?)/i.test(url)) { score -= 30; reasons.push('non-HTML asset'); }

  return { score: Math.max(0, Math.min(99, Math.round(score))), authority: Math.min(99, authority), reasons: reasons };
}

function searchBrave_(query, options) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('OCE_SEARCH_API_KEY');
  if (!key) return [];
  const country = String(options && options.country || '').toUpperCase();
  const params = [
    'q=' + encodeURIComponent(query),
    'count=' + Math.min(20, Number(options && options.count) || OCE_DISCOVERY.RESULTS_PER_QUERY),
    'search_lang=en',
    'safesearch=moderate'
  ];
  if (country) params.push('country=' + encodeURIComponent(country));
  const url = 'https://api.search.brave.com/res/v1/web/search?' + params.join('&');
  const response = UrlFetchApp.fetch(url, {
    method: 'get', muteHttpExceptions: true,
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': key }
  });
  if (response.getResponseCode() !== 200) throw Error('Brave Search returned HTTP ' + response.getResponseCode());
  const data = JSON.parse(response.getContentText() || '{}');
  return (data.web && data.web.results) || [];
}

function searchWithConfiguredProvider_(objective, limit) {
  const props = PropertiesService.getScriptProperties();
  const provider = String(props.getProperty('OCE_SEARCH_PROVIDER') || OCE_DISCOVERY.PROVIDER).toUpperCase();
  const key = props.getProperty('OCE_SEARCH_API_KEY');
  if (!key) return [];
  if (provider !== 'BRAVE') return [];

  const queries = discoveryQueryVariants_(objective);
  const country = discoveryCountryCode_(objective);
  const byUrl = {};
  const queryHits = {};
  queries.forEach(function (query) {
    try {
      searchBrave_(query, { country: country, count: OCE_DISCOVERY.RESULTS_PER_QUERY }).forEach(function (r) {
        const url = ouCanonicalUrl_(r.url);
        if (!url || ouIsStaticAsset_(url) || OC_DENY_HOST.test(ouHostOf_(url))) return;
        const path = url.replace(/^https?:\/\/[^\/]+/i, '');
        if (/(^|\/)(login|log-in|signin|sign-in|signup|sign-up|checkout|cart)(\/|$)/i.test(path)) return;
        const keyUrl = url.toLowerCase();
        queryHits[keyUrl] = (queryHits[keyUrl] || 0) + 1;
        byUrl[keyUrl] = {
          title: String(r.title || url),
          description: String(r.description || ''),
          url: url,
          is_source_local: Boolean(r.is_source_local),
          is_source_both: Boolean(r.is_source_both),
          queries: queryHits[keyUrl]
        };
      });
    } catch (err) {
      console.warn('OCE search provider failed for query: ' + query + ' — ' + String(err && err.message || err));
    }
  });

  return Object.keys(byUrl).map(function (k) {
    const r = byUrl[k];
    const scored = scoreSearchCandidate_(r, objective, queryHits[k]);
    return {
      name: r.title.slice(0, 160),
      url: r.url,
      score: scored.score,
      authority: scored.authority,
      source_type: 'SEARCH_RESULT',
      reason: 'search: BRAVE · ' + scored.reasons.join('; '),
      description: r.description.slice(0, 500),
      query_hits: queryHits[k]
    };
  }).sort(function (a, b) { return b.score - a.score; }).slice(0, Math.max(1, Math.min(limit || OCE_DISCOVERY.MAX_CANDIDATES, OCE_DISCOVERY.MAX_CANDIDATES)));
}

function planDiscoverySeeds_(topic, options) {
  const limit = Math.max(1, Math.min(OCE_DISCOVERY.DEFAULT_SEEDS, Number(options && options.limit) || OCE_DISCOVERY.DEFAULT_SEEDS));
  const objective = String(topic || '').trim();
  const catalog = discoveryCatalogSeeds_(objective, limit);
  const searched = searchWithConfiguredProvider_(objective, OCE_DISCOVERY.MAX_CANDIDATES);
  const merged = [];
  const seen = {};

  searched.concat(catalog).forEach(function (candidate) {
    const canonical = ouCanonicalUrl_(candidate.url);
    if (!canonical || seen[canonical]) return;
    seen[canonical] = true;
    merged.push(candidate);
  });

  return {
    seeds: merged.sort(function (a, b) { return b.score - a.score; }).slice(0, limit),
    via: searched.length ? (catalog.length ? 'search+catalog' : 'search') : (catalog.length ? 'catalog' : 'none'),
    search_configured: Boolean(keyConfigured_()),
    queries: discoveryQueryVariants_(objective)
  };
}

function keyConfigured_() { return Boolean(PropertiesService.getScriptProperties().getProperty('OCE_SEARCH_API_KEY')); }

function buildDiscoveryPlan(objective) { return planDiscoverySeeds_(objective, { limit: OCE_DISCOVERY.DEFAULT_SEEDS }); }
function discoverSearchCandidates(objective) { return searchWithConfiguredProvider_(String(objective || ''), OCE_DISCOVERY.MAX_CANDIDATES); }

function testDiscoveryIntelligence() {
  const plan = planDiscoverySeeds_('Auditor firms in Uganda', { limit: 8 });
  console.log(JSON.stringify(plan, null, 2));
  return plan;
}
