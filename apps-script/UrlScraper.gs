// OCE Public URL Collector V2
// Public/authorized pages only. No login, CAPTCHA, paywall or access-control bypass.
// Marketing consent is always handled separately by OCE.

const OCE_SCRAPER = {
  VERSION: '2.0.0',
  MAX_BYTES: 750000,
  MAX_REDIRECTS: 3
};

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    requireScraperToken_(body.token);
    if (body.action !== 'scan') throw Error('Unsupported action');
    return json_({ ok: true, result: scrapeUrl_(String(body.url || '')) });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function scrapeUrl_(input) {
  let url = normalizeUrl_(input);
  let response = null;

  for (let hop = 0; hop <= OCE_SCRAPER.MAX_REDIRECTS; hop++) {
    validatePublicUrl_(url);

    response = UrlFetchApp.fetch(url, {
      method: 'get',
      followRedirects: false,
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'OCE-Public-Collector/2.0' }
    });

    const code = response.getResponseCode();

    if ([301, 302, 303, 307, 308].indexOf(code) >= 0) {
      const headers = response.getHeaders();
      const location = headers.Location || headers.location || headers.LOCATION;
      if (!location) throw Error('Redirect without Location');
      url = resolveUrl_(String(location), url);
      continue;
    }

    break;
  }

  if (!response) throw Error('No response');

  const status = response.getResponseCode();
  if (status < 200 || status >= 400) {
    throw Error('Source returned HTTP ' + status);
  }

  let html = response.getContentText();
  if (html.length > OCE_SCRAPER.MAX_BYTES) {
    html = html.substring(0, OCE_SCRAPER.MAX_BYTES);
  }

  return extractPage_(url, html);
}

function normalizeUrl_(value) {
  let url = String(value || '').trim();
  if (!url) throw Error('URL is required');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const parts = parseHttpUrl_(url);
  if (!parts) throw Error('Invalid HTTP/HTTPS URL');

  return parts.protocol + '://' + parts.host + parts.path;
}

function parseHttpUrl_(url) {
  const match = String(url).match(/^\s*(https?):\/\/([^\/?#]+)([^?#]*)?(?:\?[^#]*)?(?:#.*)?\s*$/i);
  if (!match) return null;

  const protocol = match[1].toLowerCase();
  let authority = match[2];
  const path = match[3] || '/';

  if (!authority) return null;

  authority = authority.toLowerCase();
  return { protocol: protocol, host: authority, path: path.charAt(0) === '/' ? path : '/' + path };
}

function validatePublicUrl_(url) {
  const parsed = parseHttpUrl_(url);
  if (!parsed) throw Error('Invalid HTTP/HTTPS URL');

  let host = parsed.host;
  host = host.replace(/:\d+$/, '');

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0'
  ) throw Error('Local/internal host blocked');

  if (/^169\.254\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) {
    throw Error('Private/internal host blocked');
  }

  const private172 = host.match(/^172\.(\d+)\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) {
    throw Error('Private/internal host blocked');
  }
}

function resolveUrl_(target, base) {
  target = String(target || '').trim();

  if (/^https?:\/\//i.test(target)) return target;

  const baseParts = parseHttpUrl_(base);
  if (!baseParts) throw Error('Unable to resolve redirect');

  const origin = baseParts.protocol + '://' + baseParts.host;

  if (target.indexOf('//') === 0) return baseParts.protocol + ':' + target;
  if (target.charAt(0) === '/') return origin + target;

  const basePath = baseParts.path || '/';
  const slash = basePath.lastIndexOf('/');
  const directory = slash >= 0 ? basePath.substring(0, slash + 1) : '/';
  return origin + directory + target;
}

function extractPage_(url, html) {
  const title = decode_(match_(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || '');
  const description = decode_(match_(html, /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i) || '');
  const links = [];
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/ig;
  let match;

  while ((match = linkRegex.exec(html)) && links.length < 300) {
    const label = stripHtml_(match[2]).replace(/\s+/g, ' ').trim();
    if (label) links.push({ label: label, url: resolve_(match[1], url) });
  }

  return {
    source_url: url,
    collected_at: new Date().toISOString(),
    collector_version: OCE_SCRAPER.VERSION,
    title: title,
    description: description,
    links: links,
    jsonld: extractJsonLd_(html),
    tables: extractTables_(html).slice(0, 500),
    text: stripHtml_(html).replace(/\s+/g, ' ').trim().slice(0, 12000),
    marketing_consent_required: true
  };
}

function extractJsonLd_(html) {
  const objects = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/ig;
  let match;

  while ((match = regex.exec(html)) && objects.length < 20) {
    try {
      objects.push(JSON.parse(match[1].trim()));
    } catch (err) {
      // Ignore malformed JSON-LD blocks and continue safely.
    }
  }

  return objects;
}

function extractTables_(html) {
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/ig;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html)) && rows.length < 500) {
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/ig;
    let cellMatch;

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
  const match = String(value || '').match(regex);
  return match && match[1];
}

function resolve_(href, base) {
  try {
    return resolveUrl_(href, base);
  } catch (err) {
    return href;
  }
}

function requireScraperToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('OCE_SCRAPER_TOKEN');
  if (!expected || !token || token !== expected) throw Error('Unauthorized');
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
