/**
 * 20_Discovery: objective -> ranked public starting points (seeds).
 *
 * Providers (all free and keyless unless noted):
 *   1. Open data: Wikipedia "List of ..." pages + Wikidata official websites (no key, no account)
 *   2. Curated catalogue of authoritative registers/directories (geography + topic matched)
 *   3. Bing RSS (no key; best effort, often empty from Google servers)
 *   4. Optional: Brave Web Search API, only if an owner adds OCE_SEARCH_API_KEY (never required)
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
  limit = oceClamp_(limit, 1, 40, 20);
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
  var open = oceOpenDataSeeds_(objective);
  if (open.length) via.push('open-data');
  var catalog = oceCatalogSeeds_(objective);
  if (catalog.length) via.push('catalog');
  var merged = [];
  var seen = {};
  scored.concat(open, catalog).forEach(function (c) {
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

/* ---------------------------------------------------------------- open data (free, keyless) */

var OCE_OPEN_DATA = {
  WIKIPEDIA_API: 'https://en.wikipedia.org/w/api.php',
  WIKIDATA_SPARQL: 'https://query.wikidata.org/sparql',
  MAX_SEEDS: 40,
  MAX_LIST_PAGES: 2,
  CACHE_SECONDS: 6 * 3600,
  COUNTRIES: {
    UG: ['Q1036', 'Uganda'], KE: ['Q114', 'Kenya'], TZ: ['Q924', 'Tanzania'], RW: ['Q1037', 'Rwanda'], BI: ['Q967', 'Burundi'],
    NG: ['Q1033', 'Nigeria'], GH: ['Q117', 'Ghana'], ZM: ['Q953', 'Zambia'], ET: ['Q115', 'Ethiopia'], ZA: ['Q258', 'South Africa'],
    GB: ['Q145', 'the United Kingdom'], US: ['Q30', 'the United States']
  },
  // Words that describe the request, not the topic.
  STOP: ['in', 'of', 'the', 'and', 'for', 'with', 'list', 'lists', 'contact', 'contacts', 'email', 'emails', 'phone', 'phones', 'near', 'top', 'best',
    'all', 'a', 'an', 'to', 'at', 'on', 'by', 'from', 'my', 'our', 'find', 'get', 'leads', 'details', 'address', 'addresses', 'based', 'located', 'around', 'city', 'country'],
  // Too broad to filter by on their own; used only when nothing else is left.
  GENERIC: ['company', 'companies', 'firm', 'firms', 'business', 'businesses', 'organisation', 'organisations', 'organization', 'organizations',
    'service', 'services', 'provider', 'providers', 'agency', 'agencies', 'ltd', 'limited', 'institution', 'institutions'],
  SYNONYMS: {
    ngo: ['non-governmental', 'ngo', 'nonprofit', 'non-profit', 'charit'], ngos: ['non-governmental', 'ngo', 'nonprofit', 'non-profit', 'charit'],
    audit: ['audit', 'accountan'], auditor: ['audit', 'accountan'], accounting: ['accountan', 'audit'], accountant: ['accountan', 'audit'],
    law: ['law firm', 'advocates', 'legal'], lawyer: ['law firm', 'advocates', 'legal'], advocate: ['advocates', 'law firm'],
    school: ['school', 'college', 'academy'], hospital: ['hospital', 'clinic', 'medical cent'], hotel: ['hotel', 'resort', 'lodge'],
    bank: ['bank'], insurance: ['insur'], university: ['universit'], telecom: ['telecom', 'mobile network', 'internet service'],
    manufacturer: ['manufactur', 'factory', 'industr'], manufacturing: ['manufactur', 'factory', 'industr']
  }
};
OCE_OPEN_DATA.EXTRA_PLACES = ['kampala', 'entebbe', 'jinja', 'gulu', 'mbarara', 'mbale', 'lira', 'arua', 'nairobi', 'mombasa', 'kisumu', 'dar', 'salaam',
  'kigali', 'lagos', 'abuja', 'accra', 'lusaka', 'addis', 'ababa', 'johannesburg', 'london', 'east', 'africa', 'african', 'uganda', 'ugandan', 'kenya', 'kenyan'];

/** Topic words of an objective with place names and request words removed. */
function oceOpenDataTopic_(objective) {
  var places = Object.keys(OCE_COUNTRY_WORDS).join(' ').split(' ').concat(OCE_OPEN_DATA.EXTRA_PLACES);
  var words = String(objective || '').toLowerCase().replace(/[^a-z\- ]+/g, ' ').split(/\s+/).filter(function (w) {
    return w.length > 1 && OCE_OPEN_DATA.STOP.indexOf(w) < 0 && places.indexOf(w) < 0;
  });
  var specific = words.filter(function (w) { return OCE_OPEN_DATA.GENERIC.indexOf(w) < 0; });
  var use = specific.length ? specific : words;
  var stems = [];
  use.forEach(function (w) {
    var singular = w.replace(/ies$/, 'y').replace(/sses$/, 'ss').replace(/([^s])s$/, '$1');
    (OCE_OPEN_DATA.SYNONYMS[w] || OCE_OPEN_DATA.SYNONYMS[singular] || [singular.length > 6 ? singular.slice(0, -1) : singular]).forEach(function (s) { stems.push(s); });
  });
  return { phrase: words.join(' ').trim(), stems: oceUnique_(stems).slice(0, 8) };
}

function oceSparqlRequest_(query) {
  return { url: OCE_OPEN_DATA.WIKIDATA_SPARQL, method: 'post', muteHttpExceptions: true,
    contentType: 'application/x-www-form-urlencoded', payload: 'format=json&query=' + encodeURIComponent(query),
    headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': OCE.USER_AGENT } };
}

function oceWikiRequest_(params) {
  var qs = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  return { url: OCE_OPEN_DATA.WIKIPEDIA_API + '?format=json&' + qs, method: 'get', muteHttpExceptions: true, headers: { 'User-Agent': OCE.USER_AGENT } };
}

function oceFetchRequest_(req) {
  var opts = {};
  Object.keys(req).forEach(function (k) { if (k !== 'url') opts[k] = req[k]; });
  return UrlFetchApp.fetch(req.url, opts);
}

function oceSparqlRows_(res) {
  if (!res || res.getResponseCode() !== 200) return [];
  var data = oceParseJson_(res.getContentText(), {});
  return ((data.results && data.results.bindings) || []).map(function (b) {
    var row = {};
    Object.keys(b).forEach(function (k) { row[k] = b[k].value; });
    return row;
  });
}

/**
 * Free discovery from Wikipedia + Wikidata: organisations with an official website that are
 * (a) listed on a matching "List of ... in <country>" page, or (b) described with the topic words.
 * Never throws; returns [] when the sources are slow or unavailable.
 */
function oceOpenDataSeeds_(objective) {
  var code = oceDiscoveryCountry_(objective);
  var country = OCE_OPEN_DATA.COUNTRIES[code] || null;
  var topic = oceOpenDataTopic_(objective);
  if (!topic.phrase || !topic.stems.length) return [];
  var cacheKey = 'oce:od:' + oceClean_(String(objective).toLowerCase(), 200);
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) return oceParseJson_(cached, []);

  var out = [];
  try {
    var countryQ = country ? country[0] : '';
    var listQuery = 'list of ' + topic.phrase + (country ? ' in ' + country[1] : '');
    var first = [oceWikiRequest_({ action: 'query', list: 'search', srlimit: 5, srsearch: listQuery })];
    if (countryQ) {
      // Description/type match within the country. Humans and populated places are excluded.
      var rx = topic.stems.map(function (s) { return s.replace(/[^a-z\- ]/g, ''); }).filter(Boolean).join('|');
      first.push(oceSparqlRequest_('SELECT DISTINCT ?item ?itemLabel ?web WHERE { ?item wdt:P17 wd:' + countryQ + '; wdt:P856 ?web. ' +
        '?item rdfs:label ?l. FILTER(LANG(?l)="en") OPTIONAL{?item schema:description ?d. FILTER(LANG(?d)="en")} ' +
        'OPTIONAL{?item wdt:P31 ?t. ?t rdfs:label ?tl. FILTER(LANG(?tl)="en")} ' +
        'FILTER(REGEX(LCASE(CONCAT(STR(?l)," ",COALESCE(STR(?d),"")," ",COALESCE(STR(?tl),""))), "' + rx + '")) ' +
        'FILTER NOT EXISTS{?item wdt:P31 wd:Q5} FILTER NOT EXISTS{?item wdt:P1082 []} ' +
        'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 80'));
    }
    var res = UrlFetchApp.fetchAll(first);

    // (a) Wikipedia list pages -> linked articles -> Wikidata official websites.
    var search = res[0].getResponseCode() === 200 ? oceParseJson_(res[0].getContentText(), {}) : {};
    var lists = ((search.query && search.query.search) || []).map(function (s) { return s.title; })
      .filter(function (t) { return /^List of /i.test(t); }).slice(0, OCE_OPEN_DATA.MAX_LIST_PAGES);
    if (lists.length) {
      var linked = oceFetchRequest_(oceWikiRequest_({ action: 'query', generator: 'links', gplnamespace: 0, gpllimit: 'max', prop: 'pageprops',
        ppprop: 'wikibase_item', redirects: 1, titles: lists.join('|') }));
      var pages = linked.getResponseCode() === 200 ? ((oceParseJson_(linked.getContentText(), {}).query || {}).pages || {}) : {};
      var qids = Object.keys(pages).map(function (k) { return pages[k].pageprops && pages[k].pageprops.wikibase_item; })
        .filter(function (q) { return /^Q\d+$/.test(q || ''); }).slice(0, 400);
      if (qids.length) {
        var rows = oceSparqlRows_(oceFetchRequest_(oceSparqlRequest_('SELECT ?item ?itemLabel ?web ?country WHERE { VALUES ?item { ' +
          qids.map(function (q) { return 'wd:' + q; }).join(' ') + ' } ?item wdt:P856 ?web. OPTIONAL{?item wdt:P17 ?country} ' +
          'FILTER NOT EXISTS{?item wdt:P31 wd:Q5} FILTER NOT EXISTS{?item wdt:P1082 []} ' +
          'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }')));
        rows.forEach(function (r) {
          if (countryQ && r.country && r.country.split('/').pop() !== countryQ) return;
          out.push({ name: r.itemLabel, url: r.web, base: 70, reason: 'listed on Wikipedia: ' + lists[0] });
        });
      }
    }
    // (b) Topic match on Wikidata.
    if (res[1]) oceSparqlRows_(res[1]).forEach(function (r) { out.push({ name: r.itemLabel, url: r.web, base: 64, reason: 'Wikidata: ' + topic.stems.join('/') + ' with official website' }); });
  } catch (err) {
    oceLog_('WARN', 'discovery', 'Open data discovery failed: ' + String(err && err.message || err));
  }

  var seen = {};
  var seeds = out.map(function (c) {
    var url = oceCanonicalUrl_(c.url);
    if (!url || seen[url] || OCE_DISCOVERY.DENY_HOSTS.test(oceHostOf_(url))) return null;
    seen[url] = true;
    var score = c.base;
    if (code && new RegExp('\\.' + code.toLowerCase() + '$').test(oceHostOf_(url))) score += 8;
    var hay = (c.name + ' ' + url).toLowerCase();
    if (topic.stems.some(function (s) { return hay.indexOf(s) >= 0; })) score += 6;
    return { name: oceClean_(c.name || url, 160), url: url, score: Math.min(95, score), source_type: 'OPEN_DATA', reason: c.reason };
  }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, OCE_OPEN_DATA.MAX_SEEDS);
  try { if (seeds.length) cache.put(cacheKey, JSON.stringify(seeds), OCE_OPEN_DATA.CACHE_SECONDS); } catch (e) { /* cache is best effort */ }
  return seeds;
}
