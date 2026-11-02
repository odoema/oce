/* OCE Source Intelligence V1.0
 * LEGO block: candidate URL -> robots -> sitemap -> page metadata -> quality signals.
 * Non-destructive: this module does not enqueue, dequeue, or alter crawler state.
 * The recursive queue/crawler remains the execution engine.
 */

const OCE_SOURCE_INTELLIGENCE = {
  VERSION: '1.0.0',
  USER_AGENT: 'OCE-Source-Intelligence/1.0',
  MAX_SITEMAPS: 12,
  MAX_SITEMAP_URLS: 100,
  MAX_PAGE_BYTES: 250000,
  MAX_ROBOTS_BYTES: 100000,
  TIMEOUT_MS: 15000,
  COMMON_SITEMAPS: [
    '/sitemap.xml',
    '/sitemap_index.xml',
    '/sitemap-index.xml'
  ]
};

/**
 * Profile one candidate URL without queueing it.
 */
function profileSourceIntelligence(url, objective) {
  const candidate = canonicalSourceIntelligenceUrl_(url);
  if (!candidate) throw Error('A valid HTTP/HTTPS source URL is required.');

  const started = Date.now();
  const plan = objective ? buildSourceObjectiveSignals_(objective) : null;
  const host = getSourceHost_(candidate);
  const origin = getSourceOrigin_(candidate);

  const robots = inspectRobotsTxt_(origin);
  const sitemapUrls = discoverSitemapLocations_(origin, robots);
  const sitemap = inspectSitemaps_(sitemapUrls, candidate);
  const page = inspectSourcePage_(candidate);

  const signals = scoreSourceIntelligence_(candidate, page, robots, sitemap, plan);

  return {
    ok: true,
    version: OCE_SOURCE_INTELLIGENCE.VERSION,
    url: candidate,
    host: host,
    objective: objective || '',
    robots: robots,
    sitemap: sitemap,
    page: page,
    signals: signals,
    elapsed_ms: Date.now() - started,
    generated_at: new Date().toISOString()
  };
}

/** Lightweight smoke test for Apps Script execution. */
function testSourceIntelligence() {
  return profileSourceIntelligence('https://www.google.com/', 'search engine');
}

function inspectRobotsTxt_(origin) {
  const url = origin + '/robots.txt';
  const result = fetchTextSafe_(url, OCE_SOURCE_INTELLIGENCE.MAX_ROBOTS_BYTES);
  if (!result.ok) {
    return {
      checked: true,
      url: url,
      accessible: false,
      status: result.status,
      error: result.error || ''
    };
  }

  const parsed = parseRobots_(result.text);
  return {
    checked: true,
    url: url,
    accessible: true,
    status: result.status,
    user_agent: parsed.user_agent,
    sitemap_urls: parsed.sitemap_urls,
    disallow: parsed.disallow,
    allow: parsed.allow,
    crawl_delay: parsed.crawl_delay,
    blocked_for_generic_bot: robotsBlocksPath_(parsed, '/'),
    bytes: result.bytes
  };
}

function discoverSitemapLocations_(origin, robots) {
  const locations = [];
  (robots && robots.sitemap_urls || []).forEach(function(url) {
    addUniqueUrl_(locations, canonicalSourceIntelligenceUrl_(url));
  });

  OCE_SOURCE_INTELLIGENCE.COMMON_SITEMAPS.forEach(function(path) {
    addUniqueUrl_(locations, origin + path);
  });

  return locations.slice(0, OCE_SOURCE_INTELLIGENCE.MAX_SITEMAPS);
}

function inspectSitemaps_(locations, candidateUrl) {
  const found = [];
  const discoveredUrls = [];
  const seenUrls = {};

  locations.forEach(function(location) {
    if (found.length >= OCE_SOURCE_INTELLIGENCE.MAX_SITEMAPS) return;

    const result = fetchTextSafe_(location, 500000);
    if (!result.ok) {
      found.push({
        url: location,
        accessible: false,
        status: result.status,
        error: result.error || ''
      });
      return;
    }

    const parsed = parseSitemapXml_(result.text);
    parsed.urls.forEach(function(item) {
      const url = canonicalSourceIntelligenceUrl_(item.loc);
      if (!url || seenUrls[url]) return;
      seenUrls[url] = true;
      if (discoveredUrls.length < OCE_SOURCE_INTELLIGENCE.MAX_SITEMAP_URLS) {
        discoveredUrls.push({url: url, lastmod: item.lastmod || ''});
      }
    });

    found.push({
      url: location,
      accessible: true,
      status: result.status,
      type: parsed.type,
      url_count: parsed.urls.length,
      sample_urls: parsed.urls.slice(0, 10),
      bytes: result.bytes
    });
  });

  const candidateInSitemap = discoveredUrls.some(function(item) {
    return canonicalSourceIntelligenceUrl_(item.url) === canonicalSourceIntelligenceUrl_(candidateUrl);
  });

  return {
    checked: true,
    locations: found,
    discovered_url_count: discoveredUrls.length,
    sample_urls: discoveredUrls,
    candidate_in_sitemap: candidateInSitemap
  };
}

function inspectSourcePage_(url) {
  const result = fetchTextSafe_(url, OCE_SOURCE_INTELLIGENCE.MAX_PAGE_BYTES);
  if (!result.ok) {
    return {
      accessible: false,
      status: result.status,
      error: result.error || '',
      final_url: result.final_url || url
    };
  }

  const html = result.text || '';
  const finalUrl = canonicalSourceIntelligenceUrl_(result.final_url || url) || url;

  return {
    accessible: true,
    status: result.status,
    final_url: finalUrl,
    content_type: result.content_type || '',
    bytes: result.bytes,
    title: extractHtmlTag_(html, 'title'),
    description: extractMetaContent_(html, 'description'),
    robots: extractMetaContent_(html, 'robots'),
    googlebot: extractMetaContent_(html, 'googlebot'),
    canonical: extractCanonical_(html, finalUrl),
    og_type: extractMetaProperty_(html, 'og:type'),
    og_title: extractMetaProperty_(html, 'og:title'),
    json_ld_count: countMatches_(html, /<script[^>]+type=["']application\/ld\+json["'][^>]*>/gi),
    structured_data_types: extractJsonLdTypes_(html),
    noindex: hasNoindex_(html),
    nofollow: hasNofollow_(html),
    hreflang_count: countMatches_(html, /<link[^>]+hreflang=/gi)
  };
}

function scoreSourceIntelligence_(url, page, robots, sitemap, objectivePlan) {
  let quality = 50;
  const host = getSourceHost_(url).toLowerCase();
  const text = [
    host,
    page.title || '',
    page.description || '',
    page.og_type || '',
    (page.structured_data_types || []).join(' ')
  ].join(' ').toLowerCase();

  const reasons = [];

  if (/\.go\.ug$/.test(host)) { quality += 18; reasons.push('government-domain'); }
  else if (/\.edu\.ug$/.test(host)) { quality += 15; reasons.push('education-domain'); }
  else if (/\.org(?:\.[a-z]{2})?$/.test(host)) { quality += 8; reasons.push('organization-domain'); }

  if (page.accessible && page.status >= 200 && page.status < 300) {
    quality += 8; reasons.push('page-accessible');
  }
  if (page.canonical) { quality += 4; reasons.push('canonical-present'); }
  if (page.description) { quality += 3; reasons.push('description-present'); }
  if (page.json_ld_count > 0) { quality += 5; reasons.push('structured-data'); }
  if (sitemap.candidate_in_sitemap) { quality += 6; reasons.push('candidate-in-sitemap'); }
  if (sitemap.discovered_url_count > 0) { quality += 3; reasons.push('sitemap-discovered'); }
  if (robots.accessible) { quality += 2; reasons.push('robots-readable'); }

  if (page.noindex) { quality -= 25; reasons.push('noindex'); }
  if (robots.blocked_for_generic_bot) { quality -= 20; reasons.push('robots-disallow-root'); }
  if (page.status >= 400) { quality -= 25; reasons.push('http-error'); }
  if (/login|signup|checkout|cart|account/.test(text)) { quality -= 8; reasons.push('transactional-or-account-page'); }

  let relevance = 50;
  if (objectivePlan) {
    const objectiveText = String(objectivePlan.text || '').toLowerCase();
    const entity = String(objectivePlan.entity || '').toLowerCase();
    const location = String(objectivePlan.location || '').toLowerCase();
    if (entity && text.indexOf(entity) >= 0) { relevance += 20; reasons.push('entity-match'); }
    if (location && text.indexOf(location) >= 0) { relevance += 15; reasons.push('location-match'); }
    if (objectiveText && text.indexOf(objectiveText) >= 0) relevance += 5;
  }

  quality = clampScore_(quality);
  relevance = clampScore_(relevance);

  return {
    quality_score: quality,
    relevance_score: relevance,
    combined_score: Math.round((quality * 0.6) + (relevance * 0.4)),
    authority_class: authorityClass_(host, quality),
    source_type: sourceTypeFromHostAndPage_(host, page),
    reasons: reasons
  };
}

function buildSourceObjectiveSignals_(objective) {
  const text = String(objective || '').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const locations = ['uganda', 'kampala', 'gulu', 'arua', 'nebbi', 'jinja', 'mbarara', 'west nile', 'northern uganda'];
  let location = '';
  for (let i = 0; i < locations.length; i++) {
    if (lower.indexOf(locations[i]) >= 0) { location = locations[i]; break; }
  }
  let entity = text;
  if (location) entity = entity.replace(new RegExp('\\b' + escapeSourceRegExp_(location) + '\\b', 'ig'), '');
  entity = entity.replace(/\b(in|within|around|near|for)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return {text: text, entity: entity, location: location};
}

function parseRobots_(text) {
  const lines = String(text || '').split(/\r?\n/);
  const sitemapUrls = [];
  const disallow = [];
  const allow = [];
  let userAgent = '*';
  let crawlDelay = null;
  let activeApplies = false;

  lines.forEach(function(raw) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return;
    const parts = line.split(':');
    const key = String(parts.shift() || '').trim().toLowerCase();
    const value = parts.join(':').trim();
    if (key === 'user-agent') {
      userAgent = value || '*';
      activeApplies = userAgent === '*';
      return;
    }
    if (key === 'sitemap' && /^https?:\/\//i.test(value)) {
      sitemapUrls.push(value);
      return;
    }
    if (!activeApplies) return;
    if (key === 'disallow' && value) disallow.push(value);
    if (key === 'allow' && value) allow.push(value);
    if (key === 'crawl-delay' && value) crawlDelay = value;
  });

  return {
    user_agent: userAgent,
    sitemap_urls: sitemapUrls,
    disallow: disallow,
    allow: allow,
    crawl_delay: crawlDelay
  };
}

function robotsBlocksPath_(robots, path) {
  if (!robots) return false;
  const target = path || '/';
  let blocked = false;
  (robots.disallow || []).forEach(function(rule) {
    if (!rule) return;
    if (target.indexOf(rule) === 0) blocked = true;
  });
  (robots.allow || []).forEach(function(rule) {
    if (rule && target.indexOf(rule) === 0) blocked = false;
  });
  return blocked;
}

function parseSitemapXml_(xml) {
  const urls = [];
  let type = 'UNKNOWN';
  try {
    const doc = XmlService.parse(String(xml || ''));
    const root = doc.getRootElement();
    const rootName = root.getName().toLowerCase();
    if (rootName === 'sitemapindex') {
      type = 'SITEMAP_INDEX';
      root.getChildren('sitemap').forEach(function(node) {
        const loc = childXmlText_(node, 'loc');
        const lastmod = childXmlText_(node, 'lastmod');
        if (loc) urls.push({loc: loc, lastmod: lastmod});
      });
    } else if (rootName === 'urlset') {
      type = 'URLSET';
      root.getChildren('url').forEach(function(node) {
        const loc = childXmlText_(node, 'loc');
        const lastmod = childXmlText_(node, 'lastmod');
        if (loc) urls.push({loc: loc, lastmod: lastmod});
      });
    }
  } catch (err) {
    return {type: 'INVALID_XML', urls: []};
  }
  return {type: type, urls: urls};
}

function fetchTextSafe_(url, maxBytes) {
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true,
      headers: {'User-Agent': OCE_SOURCE_INTELLIGENCE.USER_AGENT}
    });
    const status = response.getResponseCode();
    const headers = response.getAllHeaders ? response.getAllHeaders() : {};
    let text = response.getContentText();
    if (maxBytes && text.length > maxBytes) text = text.substring(0, maxBytes);
    return {
      ok: status >= 200 && status < 300,
      status: status,
      text: text,
      bytes: text.length,
      final_url: getHeaderValue_(headers, 'Location') || url,
      content_type: getHeaderValue_(headers, 'Content-Type') || ''
    };
  } catch (err) {
    return {ok: false, status: 0, text: '', bytes: 0, error: String(err.message || err), final_url: url};
  }
}

function extractHtmlTag_(html, tag) {
  const match = String(html || '').match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return match ? decodeHtml_(stripTags_(match[1])).trim().substring(0, 500) : '';
}

function extractMetaContent_(html, name) {
  const pattern = new RegExp('<meta\\b[^>]+(?:name|property)=["\\']' + escapeSourceRegExp_(name) + '["\\'][^>]*content=["\\']([^"\\']*)["\\'][^>]*>', 'i');
  const reverse = new RegExp('<meta\\b[^>]+content=["\\']([^"\\']*)["\\'][^>]+(?:name|property)=["\\']' + escapeSourceRegExp_(name) + '["\\'][^>]*>', 'i');
  const match = String(html || '').match(pattern) || String(html || '').match(reverse);
  return match ? decodeHtml_(match[1]).trim().substring(0, 1000) : '';
}

function extractMetaProperty_(html, property) {
  return extractMetaContent_(html, property);
}

function extractCanonical_(html, baseUrl) {
  const pattern = /<link\\b[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i;
  const reverse = /<link\\b[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i;
  const match = String(html || '').match(pattern) || String(html || '').match(reverse);
  if (!match) return '';
  return resolveSourceUrl_(match[1], baseUrl);
}

function extractJsonLdTypes_(html) {
  const types = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(String(html || ''))) !== null && types.length < 20) {
    try {
      const value = JSON.parse(match[1].trim());
      collectJsonLdTypes_(value, types);
    } catch (err) {}
  }
  return types.filter(function(value, index, array) { return array.indexOf(value) === index; });
}

function collectJsonLdTypes_(value, types) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach(function(item) { collectJsonLdTypes_(item, types); });
    return;
  }
  if (typeof value !== 'object') return;
  if (value['@type']) {
    if (Array.isArray(value['@type'])) value['@type'].forEach(function(t) { if (types.length < 20) types.push(String(t)); });
    else if (types.length < 20) types.push(String(value['@type']));
  }
  if (value['@graph']) collectJsonLdTypes_(value['@graph'], types);
}

function hasNoindex_(html) {
  const robots = extractMetaContent_(html, 'robots').toLowerCase();
  const googlebot = extractMetaContent_(html, 'googlebot').toLowerCase();
  return /(^|[,\s])noindex([,\s]|$)/.test(robots) || /(^|[,\s])noindex([,\s]|$)/.test(googlebot);
}

function hasNofollow_(html) {
  const robots = extractMetaContent_(html, 'robots').toLowerCase();
  const googlebot = extractMetaContent_(html, 'googlebot').toLowerCase();
  return /(^|[,\s])nofollow([,\s]|$)/.test(robots) || /(^|[,\s])nofollow([,\s]|$)/.test(googlebot);
}

function sourceTypeFromHostAndPage_(host, page) {
  if (/\.go\.ug$/.test(host)) return 'GOVERNMENT_SOURCE';
  if (/\.edu\.ug$/.test(host)) return 'EDUCATION_SOURCE';
  if (/\.org(?:\.[a-z]{2})?$/.test(host)) return 'ORGANIZATION_SOURCE';
  if ((page.structured_data_types || []).some(function(t) { return /Organization|LocalBusiness|Corporation|GovernmentOrganization/i.test(t); })) return 'ORGANIZATION_OR_BUSINESS';
  return 'WEB_SOURCE';
}

function authorityClass_(host, quality) {
  if (/\.go\.ug$/.test(host) || /\.gov\./.test(host)) return 'HIGH_GOVERNMENT';
  if (/\.edu\.ug$/.test(host)) return 'HIGH_EDUCATION';
  if (quality >= 80) return 'HIGH';
  if (quality >= 60) return 'MEDIUM';
  return 'LOW';
}

function resolveSourceUrl_(value, baseUrl) {
  const raw = String(value || '').trim();
  if (/^https?:\/\//i.test(raw)) return canonicalSourceIntelligenceUrl_(raw);
  if (/^\/\//.test(raw)) return canonicalSourceIntelligenceUrl_('https:' + raw);
  try {
    const base = String(baseUrl || '').match(/^(https?:\/\/[^\/]+)/i);
    if (!base) return '';
    return canonicalSourceIntelligenceUrl_(base[1] + (raw.charAt(0) === '/' ? raw : '/' + raw));
  } catch (err) { return ''; }
}

function canonicalSourceIntelligenceUrl_(value) {
  let url = String(value || '').trim();
  if (!/^https?:\/\//i.test(url)) return '';
  url = url.replace(/#.*$/, '');
  return url.length <= 2048 ? url : '';
}

function getSourceHost_(url) {
  const match = String(url || '').match(/^https?:\/\/([^\/]+)/i);
  return match ? match[1].toLowerCase() : '';
}

function getSourceOrigin_(url) {
  const match = String(url || '').match(/^(https?:\/\/[^\/]+)/i);
  return match ? match[1] : '';
}

function getHeaderValue_(headers, name) {
  if (!headers) return '';
  const wanted = String(name).toLowerCase();
  for (const key in headers) {
    if (String(key).toLowerCase() === wanted) {
      const value = headers[key];
      return Array.isArray(value) ? String(value[0] || '') : String(value || '');
    }
  }
  return '';
}

function childXmlText_(element, name) {
  const child = element.getChild(name);
  return child ? child.getText() : '';
}

function addUniqueUrl_(array, value) {
  if (value && array.indexOf(value) < 0) array.push(value);
}

function countMatches_(text, regex) {
  const matches = String(text || '').match(regex);
  return matches ? matches.length : 0;
}

function clampScore_(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function stripTags_(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ');
}

function decodeHtml_(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeSourceRegExp_(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
