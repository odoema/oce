/**
 * 10_Fetcher: polite, parallel public-page collection.
 *
 *  - robots.txt honoured (cached 12h per host), including Crawl-delay
 *  - redirects followed manually (max 4) so every hop is re-validated and the final URL is known
 *  - HTML only; other content types are skipped without downloading twice
 *  - bounded size; charset detected from headers or <meta>
 *  - parallel batches via UrlFetchApp.fetchAll
 *
 * Public/authorised pages only: OCE never bypasses login, CAPTCHA, paywalls or access controls.
 */

var OCE_FETCH = {
  MAX_BYTES: 1500000,
  MAX_REDIRECTS: 4,
  ROBOTS_TTL_SECONDS: 43200,
  HTML_TYPES: /text\/html|application\/xhtml\+xml/i
};

/**
 * Fetches many URLs in parallel.
 * @param {string[]} urls
 * @return {Object[]} one outcome per input, same order:
 *   {url, final_url, ok, status:'OK'|'SKIPPED'|'BLOCKED'|'FAILED'|'RETRY', http_status, content_type, html, bytes, fetch_ms, error}
 */
function oceFetchMany_(urls) {
  var started = Date.now();
  var outcomes = urls.map(function (u) { return { url: u, final_url: u, ok: false, status: 'FAILED', http_status: '', error: '' }; });
  var active = [];
  outcomes.forEach(function (o, i) {
    try {
      oceAssertPublicUrl_(o.url);
      if (oceSettingBool_('RESPECT_ROBOTS', true) && !oceRobotsAllowed_(o.url)) {
        o.status = 'BLOCKED'; o.error = 'Disallowed by robots.txt';
        return;
      }
      active.push(i);
    } catch (err) {
      o.status = 'BLOCKED'; o.error = String(err.message || err);
    }
  });

  for (var hop = 0; hop <= OCE_FETCH.MAX_REDIRECTS && active.length; hop++) {
    var requests = active.map(function (i) {
      return {
        url: outcomes[i].final_url,
        method: 'get',
        followRedirects: false,
        muteHttpExceptions: true,
        validateHttpsCertificates: true,
        headers: {
          'User-Agent': OCE.USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'Accept-Language': 'en;q=0.9,*;q=0.5'
        }
      };
    });
    var responses;
    try {
      responses = UrlFetchApp.fetchAll(requests);
    } catch (err) {
      // fetchAll fails as a whole on DNS/TLS errors; fall back to one-by-one so a single bad host cannot sink the batch.
      responses = requests.map(function (r) {
        try { return UrlFetchApp.fetch(r.url, r); } catch (e) { return { __error: String(e.message || e) }; }
      });
    }
    var next = [];
    active.forEach(function (i, k) {
      var o = outcomes[i];
      var res = responses[k];
      if (!res || res.__error) {
        o.status = /timeout|timed out|DNS|unavailable|address unavailable/i.test(res && res.__error || '') ? 'RETRY' : 'FAILED';
        o.error = (res && res.__error) || 'No response';
        return;
      }
      var code = res.getResponseCode();
      o.http_status = code;
      var headers = oceLowerHeaders_(res.getHeaders());
      if ([301, 302, 303, 307, 308].indexOf(code) >= 0 && headers.location) {
        var target = oceResolveUrl_(String(headers.location), o.final_url);
        try {
          oceAssertPublicUrl_(target);
          if (oceSettingBool_('RESPECT_ROBOTS', true) && !oceRobotsAllowed_(target)) throw new Error('Redirect target disallowed by robots.txt');
          o.final_url = target;
          next.push(i);
        } catch (err) {
          o.status = 'BLOCKED'; o.error = String(err.message || err);
        }
        return;
      }
      oceClassifyResponse_(o, res, code, headers);
    });
    active = next;
  }
  active.forEach(function (i) { outcomes[i].status = 'FAILED'; outcomes[i].error = 'Too many redirects'; });
  var elapsed = Date.now() - started;
  outcomes.forEach(function (o) { o.fetch_ms = elapsed; });
  return outcomes;
}

function oceClassifyResponse_(o, res, code, headers) {
  o.content_type = String(headers['content-type'] || '');
  if (code === 401 || code === 403 || code === 407 || code === 451) {
    o.status = 'BLOCKED'; o.error = 'Access restricted (HTTP ' + code + ')'; return;
  }
  if (code === 404 || code === 410) { o.status = 'FAILED'; o.error = 'Not found (HTTP ' + code + ')'; return; }
  if (code === 429 || code >= 500) { o.status = 'RETRY'; o.error = 'Temporary failure (HTTP ' + code + ')'; return; }
  if (code < 200 || code >= 300) { o.status = 'FAILED'; o.error = 'HTTP ' + code; return; }
  if (o.content_type && !OCE_FETCH.HTML_TYPES.test(o.content_type)) {
    o.status = 'SKIPPED'; o.error = 'Not an HTML page (' + o.content_type.split(';')[0] + ')'; return;
  }
  var blob = res.getBlob();
  var bytes = blob.getBytes();
  o.bytes = bytes.length;
  var charset = (o.content_type.match(/charset=([\w-]+)/i) || [])[1];
  var html;
  try {
    var probe = Utilities.newBlob(bytes.slice(0, 4096)).getDataAsString('ISO-8859-1');
    var meta = probe.match(/<meta[^>]+charset=["']?([\w-]+)/i);
    charset = charset || (meta && meta[1]) || 'UTF-8';
    html = Utilities.newBlob(bytes.length > OCE_FETCH.MAX_BYTES ? bytes.slice(0, OCE_FETCH.MAX_BYTES) : bytes).getDataAsString(charset);
  } catch (err) {
    html = res.getContentText();
  }
  if (!o.content_type && !/<html|<body|<!doctype html/i.test(html.slice(0, 2000))) {
    o.status = 'SKIPPED'; o.error = 'Response does not look like HTML'; return;
  }
  if (/<form[^>]+(login|signin|sign-in)/i.test(html) && /type=["']password/i.test(html) && html.length < 20000) {
    o.status = 'BLOCKED'; o.error = 'Login wall detected'; return;
  }
  // Interstitial bot challenges only. A reCAPTCHA on a contact form is normal and must not block the page.
  if (/cf-challenge|challenge-platform|cf_chl_opt|<title>\s*(just a moment|attention required|access denied|verify you are human)/i.test(html) && html.length < 40000) {
    o.status = 'BLOCKED'; o.error = 'CAPTCHA/bot challenge detected'; return;
  }
  o.html = html;
  o.ok = true;
  o.status = 'OK';
}

function oceLowerHeaders_(h) {
  var out = {};
  Object.keys(h || {}).forEach(function (k) {
    var v = h[k];
    out[k.toLowerCase()] = Array.isArray(v) ? v[v.length - 1] : v;
  });
  return out;
}

/** Single-page convenience wrapper. Throws on failure. */
function oceFetchPage_(url) {
  var o = oceFetchMany_([url])[0];
  if (!o.ok) throw new Error(o.error || ('Fetch failed: ' + o.status));
  return o;
}

/* ------------------------------------------------------------------ robots.txt */

function oceRobotsAllowed_(url) {
  var p = oceParseUrl_(url);
  if (!p) return false;
  var rules = oceRobotsRules_(p.protocol + '://' + p.host + (p.port ? ':' + p.port : ''));
  var path = p.path + (p.query ? '?' + p.query : '');
  return oceRobotsMatch_(rules, path);
}

function oceRobotsCrawlDelay_(url) {
  var p = oceParseUrl_(url);
  if (!p) return 0;
  return Number(oceRobotsRules_(p.protocol + '://' + p.host + (p.port ? ':' + p.port : '')).delay || 0);
}

function oceRobotsRules_(origin) {
  var memo = oceRuntimeCache_();
  memo.robots = memo.robots || {};
  if (memo.robots[origin]) return memo.robots[origin];
  var cache = CacheService.getScriptCache();
  var key = 'robots:' + oceSha256Hex_(origin).slice(0, 40);
  var cached = cache.get(key);
  if (cached) return (memo.robots[origin] = oceParseJson_(cached, { rules: [], delay: 0 }));
  var parsed = { rules: [], delay: 0 };
  try {
    var res = UrlFetchApp.fetch(origin + '/robots.txt', {
      muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': OCE.USER_AGENT }
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) parsed = oceParseRobots_(res.getContentText().slice(0, 200000));
    else if (code === 401 || code === 403) parsed = { rules: [{ allow: false, path: '/' }], delay: 0 };
    // 404/5xx: treat as no restrictions (standard crawler behaviour).
  } catch (err) {
    parsed = { rules: [], delay: 0 };
  }
  try { cache.put(key, JSON.stringify(parsed), OCE_FETCH.ROBOTS_TTL_SECONDS); } catch (err) { /* too large to cache */ }
  return (memo.robots[origin] = parsed);
}

/** Parses robots.txt and returns the rule group that applies to OCE (specific UA beats '*'). */
function oceParseRobots_(text) {
  var groups = [];
  var current = null;
  var lastWasAgent = false;
  String(text || '').split(/\r?\n/).forEach(function (line) {
    line = line.replace(/#.*$/, '').trim();
    var m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) return;
    var field = m[1].toLowerCase();
    var value = m[2].trim();
    if (field === 'user-agent') {
      if (!lastWasAgent || !current) { current = { agents: [], rules: [], delay: 0 }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      return;
    }
    lastWasAgent = false;
    if (!current) return;
    if (field === 'allow' || field === 'disallow') {
      if (field === 'disallow' && !value) return; // empty Disallow = allow all
      current.rules.push({ allow: field === 'allow', path: value });
    } else if (field === 'crawl-delay') {
      current.delay = Math.min(30, Number(value) || 0);
    }
  });
  var mine = groups.filter(function (g) { return g.agents.some(function (a) { return a.indexOf('oce') === 0; }); });
  var star = groups.filter(function (g) { return g.agents.indexOf('*') >= 0; });
  var chosen = mine.length ? mine : star;
  var out = { rules: [], delay: 0 };
  chosen.forEach(function (g) { out.rules = out.rules.concat(g.rules); out.delay = Math.max(out.delay, g.delay); });
  return out;
}

/** Longest-match wins; Allow wins ties. Supports * and $ wildcards. */
function oceRobotsMatch_(robots, path) {
  var best = null;
  (robots.rules || []).forEach(function (rule) {
    var pattern = rule.path;
    var anchored = /\$$/.test(pattern);
    var body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    var regex = new RegExp('^' + body + (anchored ? '$' : ''));
    if (regex.test(path)) {
      if (!best || pattern.length > best.path.length || (pattern.length === best.path.length && rule.allow)) best = rule;
    }
  });
  return !best || best.allow;
}
