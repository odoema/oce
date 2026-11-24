/**
 * 14_Sitemaps: seeds a mission with the URLs a site publishes in its sitemap.
 *
 * Directory and member sites often list every firm page in sitemap.xml, which reaches
 * pages that link-following at depth 2 would miss. Runs once per site per mission, when
 * that site's seed page is collected.
 *  - sitemap locations: robots.txt "Sitemap:" lines first, then /sitemap.xml, /sitemap_index.xml, /sitemap-index.xml
 *  - follows one level of <sitemapindex>; .xml.gz is decompressed
 *  - caps: 12 sitemap files and 100 URLs per site; at most 40 URLs queued (best scored first)
 *  - each sitemap fetch obeys robots.txt and the host's pacing interval (1 s or Crawl-delay)
 */

var OCE_SITEMAPS = {
  COMMON_PATHS: ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml'],
  MAX_FILES: 12,
  MAX_URLS: 100,
  MAX_QUEUE: 40,
  MAX_BYTES: 3000000
};

/** @return {number} URLs queued */
function oceSeedFromSitemaps_(mission, row, page, sameSite) {
  var p = oceParseUrl_(page.url || row.url);
  if (!p) return 0;
  var origin = p.protocol + '://' + p.host + (p.port ? ':' + p.port : '');
  var site = oceSiteOf_(origin);
  var key = 'sitemap:' + mission.mission_id + ':' + site;
  var cache = CacheService.getScriptCache();
  var memo = oceRuntimeCache_();
  memo.sitemapDone = memo.sitemapDone || {};
  if (memo.sitemapDone[key] || cache.get(key)) return 0;
  memo.sitemapDone[key] = true;
  try { cache.put(key, '1', 21600); } catch (err) { /* best effort */ }

  var found = oceReadSitemaps_(origin);
  if (!found.urls.length) return 0;
  // Score sitemap URLs exactly like on-page links (no anchor text available).
  var pseudo = { url: page.url || row.url, links: found.urls.map(function (u) { return { kind: 'web', url: u, label: '' }; }) };
  var scored = oceScoreLinks_(pseudo, { objective: mission.objective, same_site: sameSite !== false }).slice(0, OCE_SITEMAPS.MAX_QUEUE);
  var res = oceEnqueue_(mission, scored.map(function (l) {
    return { url: l.url, label: 'sitemap', priority: Math.max(1, l.priority - 5), depth: 1, parent_url: found.files[0] || origin, source_type: 'SITEMAP_URL' };
  }));
  oceLog_('INFO', 'sitemaps', 'Seeded ' + res.queued + ' URLs from sitemap', { site: site, files: found.files.length, urls: found.urls.length });
  return res.queued;
}

/**
 * Reads up to MAX_FILES sitemap files for an origin.
 * @return {{files:string[], urls:string[]}}
 */
function oceReadSitemaps_(origin) {
  var robots = { sitemaps: [] };
  try { robots = oceRobotsRules_(origin); } catch (err) { /* treat as none */ }
  var pending = oceUnique_((robots.sitemaps || []).concat(OCE_SITEMAPS.COMMON_PATHS.map(function (path) { return origin + path; })));
  var seenFiles = {};
  var files = [];
  var urls = [];
  var seenUrls = {};
  var fetched = 0;
  var foundAny = false;
  var interval = oceHostIntervalMs_(origin + '/');
  while (pending.length && fetched < OCE_SITEMAPS.MAX_FILES && urls.length < OCE_SITEMAPS.MAX_URLS) {
    var loc = pending.shift();
    if (seenFiles[loc]) continue;
    seenFiles[loc] = true;
    // The common paths are fallbacks only: stop guessing once a real sitemap was found.
    if (foundAny && OCE_SITEMAPS.COMMON_PATHS.some(function (path) { return loc === origin + path; }) && (robots.sitemaps || []).indexOf(loc) < 0) continue;
    if (fetched) Utilities.sleep(interval);
    fetched++;
    var xml = oceFetchSitemapXml_(loc);
    if (!xml) continue;
    var parsed = oceParseSitemapXml_(xml);
    if (parsed.type === 'unknown') continue;
    foundAny = true;
    files.push(loc);
    if (parsed.type === 'index') {
      // One level of nesting; child sitemaps go to the front so they are read before fallbacks.
      pending = parsed.locs.slice(0, OCE_SITEMAPS.MAX_FILES).concat(pending);
      continue;
    }
    parsed.locs.forEach(function (u) {
      if (urls.length >= OCE_SITEMAPS.MAX_URLS) return;
      var c = oceCanonicalUrl_(u);
      if (!c || seenUrls[c] || oceIsAssetUrl_(c)) return;
      seenUrls[c] = true;
      urls.push(c);
    });
  }
  return { files: files, urls: urls };
}

/** Fetches one sitemap (robots-checked). Returns XML text or ''. */
function oceFetchSitemapXml_(url) {
  try {
    oceAssertPublicUrl_(url);
    if (oceSettingBool_('RESPECT_ROBOTS', true) && !oceRobotsAllowed_(url)) return '';
    var res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': OCE.USER_AGENT, 'Accept': 'application/xml,text/xml;q=0.9,*/*;q=0.1' } });
    if (res.getResponseCode() !== 200) return '';
    var blob = res.getBlob();
    if (blob.getBytes().length > OCE_SITEMAPS.MAX_BYTES) return '';
    if (/\.gz$/i.test(url) || /gzip/i.test(String(oceLowerHeaders_(res.getHeaders())['content-type'] || ''))) {
      try { blob.setContentType('application/x-gzip'); return Utilities.ungzip(blob).getDataAsString('UTF-8'); } catch (err) { return ''; }
    }
    return res.getContentText();
  } catch (err) {
    return '';
  }
}

/** @return {{type:'urlset'|'index'|'unknown', locs:string[]}} */
function oceParseSitemapXml_(xml) {
  var text = String(xml || '').slice(0, OCE_SITEMAPS.MAX_BYTES);
  var type = /<sitemapindex[\s>]/i.test(text) ? 'index' : /<urlset[\s>]/i.test(text) ? 'urlset' : 'unknown';
  var locs = [];
  if (type !== 'unknown') {
    var re = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi;
    var m;
    while ((m = re.exec(text)) && locs.length < 5000) {
      var u = oceDecodeEntities_(m[1]);
      if (/^https?:\/\//i.test(u)) locs.push(u);
    }
  }
  return { type: type, locs: locs };
}
