/**
 * 20_Discovery: objective -> ranked public starting points (seeds).
 *
 * Providers, in order of preference:
 *   1. Brave Web Search API (Script Properties: OCE_SEARCH_PROVIDER=BRAVE, OCE_SEARCH_API_KEY)
 *   2. Bing RSS (no key; best effort)
 *   3. Curated catalogue of authoritative registers/directories (geography + topic matched)
 * Search results are candidates only; facts always come from collecting the page itself.
 */

var OCE_DISCOVERY = {
  MAX_QUERIES: 8,
  RESULTS_PER_QUERY: 20,
  MAX_CANDIDATES: 60,
  DENY_HOSTS: /(^|\.)(facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com|pinterest\.com|wikipedia\.org|amazon\.[a-z.]+|bing\.com|google\.[a-z.]+|reddit\.com|quora\.com)$/i
};

var OCE_DISCOVERY_CATALOG = [
  { name: 'ICPAU licensed firms portal', url: 'https://icpauportal.com/external_portal/firms', country: 'UG', keywords: ['auditor', 'audit', 'accountant', 'accounting', 'cpa', 'assurance', 'tax'], authority: 99, type: 'REGULATORY_REGISTER' },
  { name: 'ICPAU accountancy practice', url: 'https://www.icpau.co.ug/accountancy-practice', country: 'UG', keywords: ['auditor', 'audit', 'accountant', 'accounting', 'cpa', 'assurance'], authority: 98, type: 'PROFESSIONAL_BODY' },
  { name: 'Uganda Law Society', url: 'https://uls.or.ug/', country: 'UG', keywords: ['law', 'lawyer', 'advocate', 'legal', 'attorney'], authority: 92, type: 'PROFESSIONAL_BODY' },
  { name: 'Uganda Medical and Dental Practitioners Council', url: 'https://umdpc.com/', country: 'UG', keywords: ['doctor', 'medical', 'dental', 'clinic', 'hospital', 'health'], authority: 92, type: 'REGULATORY_REGISTER' },
  { name: 'Uganda Investment Authority', url: 'https://www.ugandainvest.go.ug/', country: 'UG', keywords: ['investor', 'investment', 'business', 'company', 'manufactur', 'industry'], authority: 90, type: 'GOVERNMENT' },
  { name: 'Uganda Tourism Board', url: 'https://www.utb.go.ug/', country: 'UG', keywords: ['hotel', 'tour', 'travel', 'lodge', 'safari', 'hospitality', 'tourism'], authority: 88, type: 'GOVERNMENT' },
  { name: 'Yellow Uganda business directory', url: 'https://www.yellow.ug/', country: 'UG', keywords: ['business', 'company', 'supplier', 'vendor', 'restaurant', 'hotel', 'retail', 'service', 'directory', 'shop', 'firm'], authority: 78, type: 'BUSINESS_DIRECTORY' },
  { name: 'Startup Uganda directory', url: 'https://portal.startup.ug/directory', country: 'UG', keywords: ['startup', 'technology', 'tech', 'innovation', 'software'], authority: 82, type: 'STARTUP_DIRECTORY' },
  { name: 'Kenya business directory (Yellow Kenya)', url: 'https://www.yellowpageskenya.com/', country: 'KE', keywords: ['business', 'company', 'supplier', 'service', 'directory', 'firm'], authority: 75, type: 'BUSINESS_DIRECTORY' },
  { name: 'ICPAK member firms', url: 'https://www.icpak.com/', country: 'KE', keywords: ['auditor', 'audit', 'accountant', 'accounting', 'cpa'], authority: 95, type: 'PROFESSIONAL_BODY' }
];

var OCE_COUNTRY_WORDS = { uganda: 'UG', ugandan: 'UG', kampala: 'UG', kenya: 'KE', kenyan: 'KE', nairobi: 'KE', tanzania: 'TZ', rwanda: 'RW', kigali: 'RW',
  burundi: 'BI', nigeria: 'NG', lagos: 'NG', ghana: 'GH', accra: 'GH', zambia: 'ZM', ethiopia: 'ET', 'south africa': 'ZA', 'united kingdom': 'GB', usa: 'US', 'united states': 'US' };

function oceDiscoveryCountry_(objective) {
  var t = ' ' + String(objective || '').toLowerCase() + ' ';
  var keys = Object.keys(OCE_COUNTRY_WORDS).sort(function (a, b) { return b.length - a.length; });
  for (var i = 0; i < keys.length; i++) if (t.indexOf(' ' + keys[i] + ' ') >= 0 || t.indexOf(' ' + keys[i] + ',') >= 0) return OCE_COUNTRY_WORDS[keys[i]];
  return '';
}

function oceDiscoveryQueries_(objective) {
  var base = oceClean_(objective, 200);
  var country = oceDiscoveryCountry_(base);
  var q = [base, base + ' directory', base + ' list contacts', base + ' association members', base + ' registered', base + ' contact us email'];
  if (country) q.push(base + ' site:' + country.toLowerCase());
  q.push(base + ' "@" email phone');
  return oceUnique_(q).slice(0, OCE_DISCOVERY.MAX_QUERIES);
}

/** @return {{seeds:Object[], via:string, queries:string[], search_configured:boolean}} */
function oceDiscover_(objective, limit) {
  limit = oceClamp_(limit, 1, 30, 10);
  var queries = oceDiscoveryQueries_(objective);
  var provider = String(oceSecret_('OCE_SEARCH_PROVIDER') || 'BRAVE').toUpperCase();
  var hasKey = !!oceSecret_('OCE_SEARCH_API_KEY');
  var via = [];
  var results = [];
  if (hasKey && provider === 'BRAVE') {
    results = oceSearchBrave_(queries, oceDiscoveryCountry_(objective));
    if (results.length) via.push('brave');
  }
  if (!results.length) {
    results = oceSearchBingRss_(queries.slice(0, 5));
    if (results.length) via.push('bing-rss');
  }
  var scored = oceRankSearchResults_(results, objective);
  var catalog = oceCatalogSeeds_(objective);
  if (catalog.length) via.push('catalog');
  var merged = [];
  var seen = {};
  scored.concat(catalog).forEach(function (c) {
    var key = oceCanonicalUrl_(c.url);
    if (!key || seen[key]) return;
    seen[key] = true;
    c.url = key;
    merged.push(c);
  });
  // Diversity: at most two seeds per site so one directory cannot dominate a mission.
  var perSite = {};
  var seeds = merged.sort(function (a, b) { return b.score - a.score; }).filter(function (c) {
    var s = oceSiteOf_(c.url);
    perSite[s] = (perSite[s] || 0) + 1;
    return perSite[s] <= 2;
  }).slice(0, limit);
  return { seeds: seeds, via: via.join('+') || 'none', queries: queries, search_configured: hasKey };
}

function oceSearchBrave_(queries, country) {
  var key = oceSecret_('OCE_SEARCH_API_KEY');
  var requests = queries.map(function (q) {
    var params = ['q=' + encodeURIComponent(q), 'count=' + OCE_DISCOVERY.RESULTS_PER_QUERY, 'safesearch=moderate', 'text_decorations=false'];
    if (country) params.push('country=' + country);
    return { url: 'https://api.search.brave.com/res/v1/web/search?' + params.join('&'), method: 'get', muteHttpExceptions: true,
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': key } };
  });
  var out = [];
  try {
    UrlFetchApp.fetchAll(requests).forEach(function (res, i) {
      if (res.getResponseCode() !== 200) { oceLog_('WARN', 'discovery', 'Brave HTTP ' + res.getResponseCode(), { query: queries[i] }); return; }
      var data = oceParseJson_(res.getContentText(), {});
      ((data.web && data.web.results) || []).forEach(function (r) {
        out.push({ url: r.url, title: r.title || '', description: r.description || '', query: queries[i] });
      });
    });
  } catch (err) {
    oceLog_('WARN', 'discovery', 'Brave search failed: ' + err.message);
  }
  return out;
}

function oceSearchBingRss_(queries) {
  var out = [];
  var requests = queries.map(function (q) {
    return { url: 'https://www.bing.com/search?format=rss&count=30&q=' + encodeURIComponent(q), method: 'get', muteHttpExceptions: true,
      headers: { 'User-Agent': OCE.USER_AGENT } };
  });
  var responses = [];
  try { responses = UrlFetchApp.fetchAll(requests); } catch (err) { oceLog_('WARN', 'discovery', 'Bing RSS failed: ' + err.message); return out; }
  responses.forEach(function (res, i) {
    if (res.getResponseCode() !== 200) return;
    var xml = res.getContentText();
    var re = /<item>([\s\S]*?)<\/item>/gi;
    var m;
    while ((m = re.exec(xml))) {
      var item = m[1];
      var get = function (tag) { var x = item.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>', 'i')); return x ? oceDecodeEntities_(x[1].replace(/<!\[CDATA\[|\]\]>/g, '')).trim() : ''; };
      out.push({ url: get('link'), title: get('title'), description: get('description'), query: queries[i] });
    }
  });
  return out;
}

function oceRankSearchResults_(results, objective) {
  var tokens = oceTokens_(objective);
  var country = oceDiscoveryCountry_(objective);
  var byUrl = {};
  results.forEach(function (r) {
    var url = oceCanonicalUrl_(r.url);
    if (!url || oceIsAssetUrl_(url) || OCE_DISCOVERY.DENY_HOSTS.test(oceHostOf_(url))) return;
    if (/(^|\/)(login|signin|sign-in|signup|cart|checkout)(\/|$)/i.test(url)) return;
    if (!byUrl[url]) byUrl[url] = { url: url, title: r.title, description: r.description, hits: 0 };
    byUrl[url].hits++;
  });
  return Object.keys(byUrl).map(function (k) {
    var r = byUrl[k];
    var host = oceHostOf_(r.url);
    var hay = (r.url + ' ' + r.title + ' ' + r.description).toLowerCase();
    var score = 40;
    var reasons = [];
    if (/\.(gov|go|ac|edu)(\.[a-z]{2})?$/.test(host)) { score += 18; reasons.push('public-sector domain'); }
    else if (/\.(org|or)(\.[a-z]{2})?$/.test(host)) { score += 10; reasons.push('organisation domain'); }
    if (country && new RegExp('\\.' + country.toLowerCase() + '$').test(host)) { score += 8; reasons.push('country domain'); }
    if (/directory|registry|register|members|listing|association|companies|firms|providers|database|find a|search/.test(hay)) { score += 12; reasons.push('directory signal'); }
    if (/contact|email|phone/.test(hay)) { score += 4; reasons.push('contact signal'); }
    var matched = tokens.filter(function (t) { return hay.indexOf(t) >= 0; }).length;
    if (matched) { score += Math.min(24, matched * 6); reasons.push(matched + ' term match'); }
    if (r.hits > 1) { score += Math.min(10, r.hits * 3); reasons.push('multiple queries'); }
    if (/news|blog|article|\/20\d\d\//.test(hay)) score -= 8;
    return { name: oceClean_(r.title || r.url, 160), url: r.url, score: Math.max(1, Math.min(99, score)), source_type: 'SEARCH_RESULT', reason: reasons.join('; ') };
  }).sort(function (a, b) { return b.score - a.score; }).slice(0, OCE_DISCOVERY.MAX_CANDIDATES);
}

function oceCatalogSeeds_(objective) {
  var tokens = oceTokens_(objective);
  var country = oceDiscoveryCountry_(objective);
  if (!country) return [];
  return OCE_DISCOVERY_CATALOG.filter(function (e) { return e.country === country; }).map(function (e) {
    var match = tokens.filter(function (t) { return e.keywords.some(function (k) { return k === t || (t.length > 3 && (k.indexOf(t) === 0 || t.indexOf(k) === 0)); }); }).length;
    if (!match) return null;
    return { name: e.name, url: e.url, score: Math.min(99, Math.round(e.authority * 0.6 + Math.min(match, 3) * 12)), source_type: e.type, reason: 'curated authoritative source' };
  }).filter(Boolean);
}
