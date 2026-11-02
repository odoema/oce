/* OCE Intelligent Queue Bridge V1.0
 * LEGO block: objective -> intelligent discovery -> existing registry/queue.
 * The recursive crawler remains untouched and continues to execute queued URLs.
 * Queue insertion is explicit so discovery can be tested without changing crawl behavior.
 */

const OCE_INTELLIGENT_QUEUE_BRIDGE = {
  VERSION: '1.0.0',
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 20
};

/**
 * Discover, profile, rerank, then inject the best candidates into the
 * existing persistent queue through registerAndQueueSource().
 *
 * missionId is optional. When supplied it is carried in provenance so the
 * existing mission-targeted queue worker can select these records.
 */
function queueIntelligentDiscoveryCandidates(objective, limit, missionId) {
  const text = String(objective || '').trim();
  if (!text) throw Error('Discovery objective is required.');

  const requested = Number(limit || OCE_INTELLIGENT_QUEUE_BRIDGE.DEFAULT_LIMIT);
  const outputLimit = Math.max(1, Math.min(requested, OCE_INTELLIGENT_QUEUE_BRIDGE.MAX_LIMIT));
  const mission = String(missionId || '').trim();

  const discovery = discoverSearchCandidates(text);
  const reranked = rerankDiscoveryCandidates(text, discovery.candidates, outputLimit);
  const results = [];

  reranked.results.forEach(function(candidate) {
    if (!candidate.url || candidate.status === 'PROFILE_FAILED') {
      results.push({
        url: candidate.url || '',
        status: 'SKIPPED',
        reason: candidate.error || 'Candidate profiling failed.'
      });
      return;
    }

    const provenanceParts = [
      'DISCOVERY_INTELLIGENCE_V1',
      'SOURCE_INTELLIGENCE_V1',
      'RERANK_V1',
      'QUEUE_BRIDGE_V1'
    ];
    if (mission) provenanceParts.push('mission_id=' + mission);

    try {
      const queued = registerAndQueueSource({
        url: candidate.url,
        source_type: candidate.source_type || 'WEB_SOURCE',
        topic: text,
        label: candidate.title || candidate.url,
        priority: Number(candidate.final_score || 0),
        provenance: provenanceParts.join('|'),
        notes: buildIntelligentQueueNotes_(candidate)
      });

      results.push({
        url: candidate.url,
        title: candidate.title || '',
        final_score: Number(candidate.final_score || 0),
        status: queued.status,
        queue_id: queued.queue_id || '',
        source_type: candidate.source_type || '',
        authority_class: candidate.authority_class || '',
        reasons: candidate.reasons || []
      });
    } catch (err) {
      results.push({
        url: candidate.url,
        final_score: Number(candidate.final_score || 0),
        status: 'FAILED',
        error: String(err.message || err)
      });
    }
  });

  return {
    ok: true,
    version: OCE_INTELLIGENT_QUEUE_BRIDGE.VERSION,
    objective: text,
    mission_id: mission,
    discovered: discovery.candidate_count,
    profiled: reranked.profiled_count,
    attempted: reranked.results.length,
    queued: results.filter(function(item) { return item.status === 'QUEUED'; }).length,
    already_present: results.filter(function(item) { return item.status === 'ALREADY_PRESENT'; }).length,
    failed: results.filter(function(item) { return item.status === 'FAILED'; }).length,
    skipped: results.filter(function(item) { return item.status === 'SKIPPED'; }).length,
    results: results
  };
}

function buildIntelligentQueueNotes_(candidate) {
  const reasons = Array.isArray(candidate.reasons) ? candidate.reasons.join(',') : '';
  return [
    'intelligent_discovery',
    'search_score=' + Number(candidate.search_score || 0),
    'source_score=' + Number(candidate.source_score || 0),
    'final_score=' + Number(candidate.final_score || 0),
    'authority=' + String(candidate.authority_class || ''),
    'reasons=' + reasons
  ].join('; ');
}

function testIntelligentQueueBridge() {
  return queueIntelligentDiscoveryCandidates('Hospitals in Uganda', 3, 'TEST_INTELLIGENT_QUEUE');
}
