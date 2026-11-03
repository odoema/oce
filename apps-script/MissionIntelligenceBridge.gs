/* OCE Mission Intelligence Bridge
 * Routes Mission Control through the new generic discovery layer without
 * modifying the existing recursive QueueWorker.
 */

function startOceMissionIntelligent(topic) {
  const objective = String(topic || '').trim();
  if (!objective) throw Error('Mission objective is required.');

  setupSourceRegistry();
  setupQueueWorker();
  ensureOceAutomation_();

  const searched = discoverSearchCandidatesSafe_(objective);
  const catalog = discoveryCatalogSeeds_(objective, OCE_MISSION.MAX_SEEDS);
  const merged = [];
  const seen = {};

  searched.concat(catalog).forEach(function(candidate) {
    const url = ouCanonicalUrl_(candidate.url);
    if (!url || seen[url]) return;
    seen[url] = true;
    merged.push({
      name: candidate.name || candidate.url,
      url: url,
      score: Number(candidate.score || 0),
      source_type: candidate.source_type || 'DISCOVERY_SEED',
      reason: candidate.reason || ''
    });
  });

  const seeds = merged.sort(function(a,b){ return b.score - a.score; }).slice(0, OCE_MISSION.MAX_SEEDS);
  if (!seeds.length) {
    throw Error('No suitable public discovery sources were found. Configure OCE_SEARCH_API_KEY for deeper search coverage, or try a more specific objective.');
  }

  const runs = getOceSpreadsheet_().getSheetByName(OCE_MISSION.RUNS_SHEET);
  ensureMissionRunHeader_(runs);
  const runId = Utilities.getUuid();
  runs.appendRow([runId,new Date(),'',seeds.length,0,0,0,objective,'PLANNING',0]);

  let queued = 0;
  seeds.forEach(function(seed){
    try {
      registerAndQueueSource({
        url: seed.url,
        source_type: seed.source_type,
        topic: objective,
        label: seed.name,
        priority: seed.score,
        provenance: 'DISCOVERY_INTELLIGENCE|mission_id=' + runId,
        notes: 'Mission ' + runId + (seed.reason ? ' · ' + seed.reason : '')
      });
      queued += 1;
    } catch (err) {
      Logger.log('Intelligent seed queue failure: ' + seed.url + ' — ' + String(err.message || err));
    }
  });

  updateMissionRun_(runId, {
    status: queued ? 'QUEUED' : 'FAILED',
    queued_count: queued,
    discovered_count: queued,
    progress: queued ? 10 : 0
  });

  return getOceMissionStatus(runId);
}

function testOceMissionIntelligent() {
  return startOceMissionIntelligent('Hospitals in Uganda');
}
