/* OCE Mission Worker Routing V1
 * LEGO block: Mission Control -> targeted queue worker.
 * No mission ID means the existing global worker path remains untouched.
 */

function runOceMissionBatchForMission_(limit, missionId) {
  const id = String(missionId || '').trim();
  if (!id) return runOceMissionBatch(limit || 5);
  const result = runQueueWorker(limit || 5, id);
  refreshOceMissionRuns_();
  return result;
}
