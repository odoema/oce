/* OCE Discovery Queue Bridge
 * Search intelligence produces candidates; the existing persistent queue remains authoritative.
 */

function discoverSearchCandidatesSafe_(objective) {
  const text = String(objective || '').trim();
  if (!text) throw Error('Discovery objective is required.');

  let configured = [];
  try {
    configured = discoverSearchCandidates(text) || [];
  } catch (err) {
    console.warn('Configured discovery provider failed: ' + String(err.message || err));
  }
  if (configured.length) return configured;

  // No API key is required for the fallback. This keeps OCE usable while a
  // paid/search-provider credential is not configured. The crawler still
  // validates and collects the resulting public pages normally.
  return discoverViaBingRssFallback_(text);
}

function discoverViaBingRssFallback_(objective) {
  const queries = discoveryQueryVariants_(objective);
  const byUrl = {};
  const hits = {};

  queries.forEach(function(query) {
    try {
      const endpoint = 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(query);
      const response = UrlFetchApp.fetch(endpoint, {
        method: 'get', muteHttpExceptions: true, followRedirects: true,
        validateHttpsCertificates: true
      });
      const code = response.getResponseCode();
      if (code < 200 || code >= 300) return;

      const document = XmlService.parse(response.getContentText());
      const root = document.getRootElement();
      const channel = root.getChild('channel');
      if (!channel) return;

      channel.getChildren('item').forEach(function(item) {
        const url = ouCanonicalUrl_(childTextSafe_(item, 'link'));
        if (!url || ouIsStaticAsset_(url) || OC_DENY_HOST.test(ouHostOf_(url))) return;
        const path = url.replace(/^https?:\/\/[^\/]+/i, '');
        if (/(^|\/)(login|log-in|signin|sign-in|signup|sign-up|checkout|cart)(\/|$)/i.test(path)) return;

        const key = url.toLowerCase();
        hits[key] = (hits[key] || 0) + 1;
        byUrl[key] = {
          url: url,
          title: childTextSafe_(item, 'title'),
          description: childTextSafe_(item, 'description'),
          is_source_local: false,
          is_source_both: false
        };
      });
    } catch (err) {
      console.warn('Bing RSS fallback failed for query: ' + query + ' — ' + String(err.message || err));
    }
  });

  return Object.keys(byUrl).map(function(key) {
    const item = byUrl[key];
    const scored = scoreSearchCandidate_(item, objective, hits[key]);
    return {
      name: String(item.title || item.url).slice(0, 160),
      url: item.url,
      score: scored.score,
      authority: scored.authority,
      source_type: 'SEARCH_RESULT',
      reason: 'search: BING_RSS_FALLBACK · ' + scored.reasons.join('; '),
      description: String(item.description || '').slice(0, 500),
      query_hits: hits[key]
    };
  }).sort(function(a, b) { return b.score - a.score; }).slice(0, OCE_DISCOVERY.MAX_CANDIDATES);
}

function childTextSafe_(element, name) {
  const child = element && element.getChild(name);
  return child ? child.getText() : '';
}

function queueDiscoveryCandidates(objective, maxCandidates) {
  const text = String(objective || '').trim();
  if (!text) throw Error('Discovery objective is required.');

  const candidates = discoverSearchCandidatesSafe_(text);
  const requested = Number(maxCandidates || 10);
  const limit = Math.max(1, Math.min(requested, candidates.length));
  const results = [];

  for (let i = 0; i < limit; i++) {
    const candidate = candidates[i];
    try {
      const queued = registerAndQueueSource({
        url: candidate.url,
        source_type: candidate.source_type || 'DISCOVERY_SEARCH',
        topic: text,
        label: candidate.name || candidate.url,
        priority: candidate.score,
        provenance: 'DISCOVERY_INTELLIGENCE',
        notes: String(candidate.reason || 'Search discovery candidate')
      });
      results.push({url:candidate.url,score:candidate.score,status:queued.status,queue_id:queued.queue_id || ''});
    } catch (err) {
      results.push({url:candidate.url,score:candidate.score,status:'FAILED',error:String(err.message || err)});
    }
  }

  return {
    ok: true,
    objective: text,
    discovered: candidates.length,
    attempted: limit,
    queued: results.filter(function(item){ return item.status === 'QUEUED'; }).length,
    results: results
  };
}
