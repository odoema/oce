/**
 * 02_Util: URL canonicalisation, domains, crypto, dates and small helpers.
 */

var OCE_TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|yclid|igshid|ref|ref_src|spm|sessionid|phpsessid|sid|jsessionid)$/i;
var OCE_SECOND_LEVEL_LABELS = ['co', 'com', 'org', 'net', 'ac', 'go', 'gov', 'or', 'ne', 'edu', 'sc', 'mil', 'info', 'biz', 'me', 'ltd', 'plc', 'nom'];
var OCE_SOCIAL_HOSTS = /(^|\.)(facebook\.com|fb\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|tiktok\.com|youtube\.com|youtu\.be|wa\.me|whatsapp\.com|t\.me|pinterest\.com|threads\.net)$/i;
var OCE_ASSET_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|bmp|tiff?|zip|rar|7z|gz|tar|docx?|xlsx?|pptx?|csv|mp3|mp4|m4a|wav|avi|mov|wmv|mkv|webm|css|js|json|xml|rss|woff2?|ttf|eot|otf|exe|dmg|apk|iso)$/i;

function oceUuid_() { return Utilities.getUuid(); }

function oceNow_() { return new Date(); }

function oceRandomToken_(bytes) {
  var s = '';
  while (s.length < bytes * 2) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, bytes * 2);
}

function oceClamp_(n, min, max, fallback) {
  n = Number(n);
  if (!isFinite(n)) n = fallback;
  return Math.max(min, Math.min(max, n));
}

function oceStr_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

function oceClean_(v, max) {
  var s = oceStr_(v).replace(/\s+/g, ' ');
  return max ? s.slice(0, max) : s;
}

function oceUnique_(arr) {
  var seen = {};
  return (arr || []).filter(function (v) {
    var k = String(v).toLowerCase();
    if (!k || seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

function oceSafeJson_(value, fallback) {
  try { return JSON.stringify(value); } catch (err) { return fallback === undefined ? '' : fallback; }
}

function oceParseJson_(text, fallback) {
  try { return JSON.parse(text); } catch (err) { return fallback; }
}

function oceIsoDate_(d, tz) {
  return Utilities.formatDate(d || new Date(), tz || oceSetting_('TIMEZONE', OCE.TIMEZONE), 'yyyy-MM-dd');
}

function oceToDate_(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------------ URLs */

/** Parses an absolute http(s) URL without relying on the URL class (not available in Apps Script). */
function oceParseUrl_(input) {
  var m = String(input || '').trim().match(/^(https?):\/\/([^\/?#@\s]+@)?([^\/?#:\s]+)(:\d+)?([^?#\s]*)(\?[^#\s]*)?(#\S*)?$/i);
  if (!m) return null;
  return {
    protocol: m[1].toLowerCase(),
    host: m[3].toLowerCase().replace(/\.$/, ''),
    port: m[4] ? m[4].slice(1) : '',
    path: m[5] || '/',
    query: m[6] ? m[6].slice(1) : '',
    hash: m[7] || ''
  };
}

/** Resolves href against base (RFC 3986 subset sufficient for crawling). */
function oceResolveUrl_(href, base) {
  href = String(href || '').trim().replace(/&amp;/g, '&');
  if (!href) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return /^https?:/i.test(href) ? href : '';
  var b = oceParseUrl_(base);
  if (!b) return '';
  var origin = b.protocol + '://' + b.host + (b.port ? ':' + b.port : '');
  if (href.indexOf('//') === 0) return b.protocol + ':' + href;
  if (href.charAt(0) === '#') return origin + b.path + (b.query ? '?' + b.query : '');
  if (href.charAt(0) === '?') return origin + b.path + href;
  var path;
  if (href.charAt(0) === '/') path = href;
  else {
    var dir = b.path.substring(0, b.path.lastIndexOf('/') + 1) || '/';
    path = dir + href;
  }
  var qIndex = path.search(/[?#]/);
  var pathOnly = qIndex >= 0 ? path.slice(0, qIndex) : path;
  var rest = qIndex >= 0 ? path.slice(qIndex) : '';
  var segments = [];
  pathOnly.split('/').forEach(function (seg, i, all) {
    if (seg === '..') { if (segments.length > 1) segments.pop(); }
    else if (seg !== '.' || i === all.length - 1) segments.push(seg === '.' ? '' : seg);
  });
  var normalized = segments.join('/');
  if (normalized.charAt(0) !== '/') normalized = '/' + normalized;
  return origin + normalized + rest;
}

/**
 * Canonical form used for de-duplication: lower-case host, no default port, no fragment,
 * no tracking parameters, sorted query, no trailing slash (except root), no index.* file.
 * Query strings are KEPT because directory pagination (?page=2) carries real content.
 */
function oceCanonicalUrl_(input) {
  var p = oceParseUrl_(input);
  if (!p) return '';
  var port = (p.protocol === 'http' && p.port === '80') || (p.protocol === 'https' && p.port === '443') ? '' : p.port;
  var path = p.path.replace(/\/{2,}/g, '/').replace(/\/(index|default)\.(html?|php|aspx?)$/i, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  var params = p.query ? p.query.split('&').filter(function (kv) {
    if (!kv) return false;
    return !OCE_TRACKING_PARAMS.test(decodeURIComponentSafe_(kv.split('=')[0]));
  }).sort() : [];
  var url = p.protocol + '://' + p.host + (port ? ':' + port : '') + (path || '/') + (params.length ? '?' + params.join('&') : '');
  return url.length > 2000 ? '' : url;
}

function decodeURIComponentSafe_(s) {
  try { return decodeURIComponent(s); } catch (err) { return s; }
}

function oceHostOf_(url) {
  var p = oceParseUrl_(url);
  return p ? p.host.replace(/^www\./, '') : '';
}

/** Approximate registrable domain (e.g. shop.example.co.ug -> example.co.ug). */
function oceSiteOf_(url) {
  var host = oceHostOf_(url);
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  var labels = host.split('.');
  if (labels.length <= 2) return host;
  var second = labels[labels.length - 2];
  var take = (OCE_SECOND_LEVEL_LABELS.indexOf(second) >= 0 && labels[labels.length - 1].length === 2) ? 3 : 2;
  return labels.slice(-take).join('.');
}

function oceIsAssetUrl_(url) {
  var p = oceParseUrl_(url);
  return !!p && OCE_ASSET_EXT.test(p.path);
}

function oceIsSocialUrl_(url) {
  return OCE_SOCIAL_HOSTS.test(oceHostOf_(url));
}

/** Blocks obviously non-public hosts. UrlFetch runs on Google infrastructure, so this is defence in depth. */
function oceAssertPublicUrl_(url) {
  var p = oceParseUrl_(url);
  if (!p) throw new Error('Invalid HTTP/HTTPS URL');
  var h = p.host;
  if (h === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(h) || h === '0.0.0.0' || h.indexOf(':') >= 0) throw new Error('Local/internal host blocked');
  var ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ip) {
    var a = Number(ip[1]), b = Number(ip[2]);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || a >= 224) {
      throw new Error('Private/internal host blocked');
    }
  }
  return true;
}

/* ------------------------------------------------------------------ crypto */

function oceHmacHex_(message, secret) {
  var bytes = Utilities.computeHmacSha256Signature(String(message), String(secret));
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function oceSha256Hex_(message) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(message), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function oceB64UrlEncode_(text) {
  return Utilities.base64EncodeWebSafe(String(text), Utilities.Charset.UTF_8).replace(/=+$/, '');
}

function oceB64UrlDecode_(text) {
  var s = String(text || '');
  while (s.length % 4) s += '=';
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString('UTF-8');
}

/** Constant-time string comparison. */
function oceSafeEqual_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ text */

function oceDecodeEntities_(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, function (_, n) { var c = Number(n); return c > 0 && c < 1114112 ? String.fromCharCode(c) : ''; })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { var c = parseInt(n, 16); return c > 0 && c < 1114112 ? String.fromCharCode(c) : ''; })
    .replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function oceEscapeHtml_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function oceTokens_(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter(function (t) { return t.length > 2 && ['the', 'and', 'for', 'with', 'from', 'all', 'list', 'find'].indexOf(t) < 0; })
    .map(function (t) { return t.replace(/ies$/, 'y').replace(/([^s])s$/, '$1'); })
    .slice(0, 20);
}

function ocePhoneNormalize_(value, defaultCountry) {
  var raw = String(value || '').trim().replace(/\(\s*0\s*\)/g, ''); // "+256 (0) 414..." trunk prefix
  var s = raw.replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.indexOf('00') === 0) s = '+' + s.slice(2);
  var cc = String(defaultCountry || oceSetting_('DEFAULT_COUNTRY_CODE', '256')).replace(/\D/g, '');
  if (s.charAt(0) !== '+') {
    if (cc && s.indexOf(cc) === 0 && s.length >= cc.length + 8) s = '+' + s;
    else if (s.charAt(0) === '0' && s.length >= 9 && s.length <= 11 && cc) s = '+' + cc + s.slice(1);
    else if (cc === '256' && /^7\d{8}$/.test(s)) s = '+256' + s;
  }
  var digits = s.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return '';
  if (/^(\d)\1+$/.test(digits)) return '';
  return s.charAt(0) === '+' ? '+' + digits : digits;
}

function oceEmailNormalize_(value) {
  var e = String(value || '').trim().toLowerCase().replace(/^mailto:/, '').replace(/[?#].*$/, '');
  try { e = decodeURIComponent(e); } catch (err) { /* keep raw */ }
  return e.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

function oceIsValidEmail_(e) {
  return /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/i.test(String(e || '')) && String(e).length <= 254;
}
