/* OCE Intelligent Reranking V1.0
 * LEGO block: search candidates -> source profile -> explainable rerank.
 * Does not alter the crawler. Queue injection remains an explicit later step.
 */

const OCE_RERANKING = {
  VERSION: '1.0.0',
  PROFILE_LIMIT: 20,
  OUTPUT_LIMIT: 50
};

function rerankDiscoveryCandidates(objective, candidates, limit) {
  const input = Array.isArray(candidates) ? candidates : [];
  const maxProfiles = Math.min(OCE_RERANKING.PROFILE_LIMIT, input.length);
  const profiled = [];

  for (let i = 0; i < maxProfiles; i++) {
    const candidate = input[i] || {};
    if (!candidate.url) continue;
    try {
      const profile = profileSourceIntelligence(candidate.url, objective || '');
      const searchScore = clampRerankScore_(Number(candidate.score || 0));
      const sourceScore = Number(profile.signals && profile.signals.combined_score || 0);
      const finalScore = Math.round((searchScore * 0.45) + (sourceScore * 0.55));
      profiled.push({
        url: candidate.url,
        title: candidate.title || profile.page.title || '',
        description: candidate.description || profile.page.description || '',
        search_score: searchScore,
        source_score: sourceScore,
        final_score: finalScore,
        source_type: profile.signals.source_type,
        authority_class: profile.signals.authority_class,
        quality_score: profile.signals.quality_score,
        relevance_score: profile.signals.relevance_score,
        reasons: profile.signals.reasons,
        canonical: profile.page.canonical || '',
        sitemap_url_count: profile.sitemap.discovered_url_count || 0,
        candidate_in_sitemap: !!profile.sitemap.candidate_in_sitemap,
        robots_accessible: !!profile.robots.accessible,
        noindex: !!profile.page.noindex,
        provenance: 'DISCOVERY_INTELLIGENCE_V1|SOURCE_INTELLIGENCE_V1|RERANK_V1'
      });
    } catch (err) {
      profiled.push({
        url: candidate.url,
        title: candidate.title || '',
        description: candidate.description || '',
        search_score: clampRerankScore_(Number(candidate.score || 0)),
        source_score: 0,
        final_score: 0,
        status: 'PROFILE_FAILED',
        error: String(err.message || err),
        provenance: 'DISCOVERY_INTELLIGENCE_V1|RERANK_V1'
      });
    }
  }

  profiled.sort(function(a, b) { return b.final_score - a.final_score; });
  const requested = Number(limit || OCE_RERANKING.OUTPUT_LIMIT);
  const outputLimit = Math.max(1, Math.min(requested, OCE_RERANKING.OUTPUT_LIMIT));

  return {
    ok: true,
    version: OCE_RERANKING.VERSION,
    objective: objective || '',
    input_count: input.length,
    profiled_count: profiled.length,
    results: profiled.slice(0, outputLimit)
  };
}

function intelligentDiscover(objective, limit) {
  const discovery = discoverSearchCandidates(objective);
  const reranked = rerankDiscoveryCandidates(objective, discovery.candidates, limit);
  return {
    ok: true,
    objective: objective,
    discovered: discovery.candidate_count,
    reranked: reranked.profiled_count,
    results: reranked.results,
    plan: discovery.plan
  };
}

function clampRerankScore_(value) {
  return Math.max(0, Math.min(100, value));
}

function testIntelligentReranking() {
  return intelligentDiscover('Hospitals in Uganda', 10);
}
