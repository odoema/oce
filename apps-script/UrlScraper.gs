// OCE Public URL Collector V2
// Canonical scraper implementation used by CollectorGateway.gs.
// Public/authorized pages only. No login, CAPTCHA, paywall or access-control bypass.
// Marketing consent is always handled separately by OCE.

var OCE_SCRAPER = {
  VERSION: '2.0.1',
  MAX_BYTES: 750000,
  MAX_REDIRECTS: 3
};

function scrapeUrl_(input) {
  var url = normalizeUrl_(input);
  var response = null;

  for (var hop = 0; hop <= OCE_SCRAPER.MAX_REDIRECTS; hop++) {
    validatePublicUrl_(url);
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      followRedirects: false,
      muteHttpExceptions: true,
      headers: {'User-Agent': 'OCE-Public-Collector/' + OCE_SCRAPER.VERSION}
    });

    var status = response.getResponseCode();
    if ([301,302,303,307,308].indexOf(status) !== -1) {
      var headers = response.getHeaders();
      var location = headers['Location'] || headers['location'] || headers['LOCATION'];
      if (!location) throw new Error('Redirect without Location');
      url = resolveUrl_(String(location), url);
      continue;
    }
    break;
  }

  if (!response) throw new Error('No response received');

  var code = response.getResponseCode();
  if (code < 200 || code >= 400) throw new Error('Source returned HTTP ' + code);

  var html = response.getContentText();
  if (html.length > OCE_SCRAPER.MAX_BYTES) html = html.substring(0, OCE_SCRAPER.MAX_BYTES);
  return extractPage_(url, html);
}

function normalizeUrl_(input) {
  var url = String(input || '').trim();
  if (!url) throw new Error('URL is required');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  var parts = parseHttpUrl_(url);
  if (!parts) throw new Error('Invalid HTTP/HTTPS URL');
  return parts.protocol + '://' + parts.host + parts.path;
}

function parseHttpUrl_(url) {
  var match = String(url).match(/^\s*(https?):\/\/([^\/?#]+)([^?#]*)?(?:\?[^#]*)?(?:#.*)?\s*$/i);
  if (!match) return null;
  var protocol = match[1].toLowerCase();
  var authority = match[2].toLowerCase();
  var path = match[3] || '/';
  if (!authority) return null;
  return {protocol: protocol, host: authority, path: path.charAt(0) === '/' ? path : '/' + path};
}

function validatePublicUrl_(url) {
  var parsed = parseHttpUrl_(url);
  if (!parsed) throw new Error('Invalid HTTP/HTTPS URL');
  var host = parsed.host.replace(/:\d+$/, '');

  if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
    throw new Error('Local/internal host blocked');
  }
  if (/^169\.254\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) {
    throw new Error('Private/internal host blocked');
  }
  var private172 = host.match(/^172\.(\d+)\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) {
    throw new Error('Private/internal host blocked');
  }
}

function resolveUrl_(target, base) {
  target = String(target || '').trim();
  if (!target) throw new Error('Empty redirect target');

  // Preserve non-HTTP resource links as-is. These are useful evidence
  // for contact intelligence and must not be converted into webpage URLs.
  if (/^(mailto:|tel:)/i.test(target)) return target;
  if (/^javascript:/i.test(target)) return target;

  if (/^https?:\/\//i.test(target)) return target;

  var baseParts = parseHttpUrl_(base);
  if (!baseParts) throw new Error('Unable to resolve redirect');
  var origin = baseParts.protocol + '://' + baseParts.host;

  if (target.indexOf('//') === 0) return baseParts.protocol + ':' + target;
  if (target.charAt(0) === '/') return origin + target;

  var basePath = baseParts.path || '/';
  var slash = basePath.lastIndexOf('/');
  var directory = slash >= 0 ? basePath.substring(0, slash + 1) : '/';
  return origin + directory + target;
}

function extractPage_(url, html) {
  var title = decode_(match_(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || '');
  var description = decode_(match_(html, /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i) || '');
  var links = [];
  var linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/ig;
  var match;

  while ((match = linkRegex.exec(html)) && links.length < 300) {
    var label = stripHtml_(match[2]).replace(/\s+/g, ' ').trim();
    if (label) links.push({label: label, url: resolve_(match[1], url)});
  }

  return {
    source_url: url,
    collected_at: new Date().toISOString(),
    collector_version: OCE_SCRAPER.VERSION,
    title: title,
    description: description,
    links: links,
    jsonld: extractJsonLd_(html),
    tables: extractTables_(html),
    text: stripHtml_(html).replace(/\s+/g, ' ').trim().substring(0, 12000),
    marketing_consent_required: true
  };
}

function extractJsonLd_(html) {
  var objects = [];
  var regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/ig;
  var match;
  while ((match = regex.exec(html)) && objects.length < 20) {
    try { objects.push(JSON.parse(match[1].trim())); } catch (err) {}
  }
  return objects;
}

function extractTables_(html) {
  var rows = [];
  var rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/ig;
  var rowMatch;
  while ((rowMatch = rowRegex.exec(html)) && rows.length < 500) {
    var cells = [];
    var cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/ig;
    var cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      cells.push(stripHtml_(cellMatch[1]).replace(/\s+/g, ' ').trim());
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function stripHtml_(value) {
  return decode_(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/ig, ' ')
    .replace(/<style[\s\S]*?<\/style>/ig, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' '));
}

function decode_(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function match_(value, regex) {
  var match = String(value || '').match(regex);
  return match && match[1];
}

function resolve_(href, base) {
  try { return resolveUrl_(href, base); } catch (err) { return href; }
}
