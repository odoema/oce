/* OCE Mission Orchestrator V1
 * LEGO block: objective -> automatic public discovery -> persistent queue -> progress.
 * Seed URLs are generated internally; operators do not need to provide them.
 */

const OCE_MISSION = {
  VERSION: '1.0.0',
  RUNS_SHEET: 'SCOUT_RUNS',
  MAX_SEEDS: 6
};

const OCE_MISSION_CATALOG = [
  {name:'ICPAU licensed firms portal',url:'https://icpauportal.com/external_portal/firms',keywords:['auditor','audit','accountant','accounting','cpa','assurance'],authority:99},
  {name:'ICPAU accountancy practice',url:'https://www.icpau.co.ug/accountancy-practice',keywords:['auditor','audit','accountant','accounting','cpa','assurance'],authority:98},
  {name:'Insurance Regulatory Authority approved auditors',url:'https://ira.go.ug/wp-content/uploads/2026/01/List-of-Approved-Auditors-2026_124902.pdf',keywords:['auditor','audit','insurance'],authority:97},
  {name:'Uganda Registration Services Bureau',url:'https://ursb.go.ug/search-ursb-registries/',keywords:['business','company','companies','firm','firms','supplier','vendor'],authority:98},
  {name:'Yellow Uganda business directory',url:'https://www.yellow.ug/',keywords:['business','company','companies','firm','firms','directory','supplier','vendor'],authority:78},
  {name:'Startup Uganda directory',url:'https://portal.startup.ug/directory',keywords:['startup','business','company','companies'],authority:82},
  {name:'MyUgandaOnline directory',url:'https://myugandaonline.com/directory.php',keywords:['business','company','supplier','vendor','directory'],authority:70},
  {name:'CompanyData Uganda directory',url:'https://companydata.com/directory/business-directory-uganda/',keywords:['business','company','firm','directory'],authority:68}
];

function startOceMission(topic) {
  const objective = String(topic || '').trim();
  if (!objective) throw Error('Mission objective is required.');
  setupSourceRegistry();
  setupQueueWorker();
  const seeds = planMissionSeeds_(objective);
  const runs = getOceSpreadsheet_().getSheetByName(OCE_MISSION.RUNS_SHEET);
  const runId = Utilities.getUuid();
  runs.appendRow([runId,new Date(),'',seeds.length,0,0,0,objective,'PLANNING']);
  let queued = 0;
  seeds.forEach(function(seed){
    try {
      registerAndQueueSource({url:seed.url,source_type:'DISCOVERY_SEED',topic:objective,label:seed.name,priority:seed.score,provenance:'DISCOVERY_BRAIN|mission_id='+runId,notes:'Mission '+runId});
      queued += 1;
    } catch (err) { Logger.log('Seed queue failure: '+seed.url+' — '+err.message); }
  });
  updateMissionRun_(runId,{status:'QUEUED',queued_count:queued,discovered_count:queued});
  return {mission_id:runId,topic:objective,status:'QUEUED',progress:10,seeds:seeds,queued:queued};
}

function planMissionSeeds_(topic) {
  const normalized = String(topic).toLowerCase();
  return OCE_MISSION_CATALOG.map(function(entry){
    let score = entry.authority * 0.45;
    entry.keywords.forEach(function(k){ if(normalized.indexOf(k) >= 0) score += 28; });
    if (/uganda|ugandan|kampala/.test(normalized)) score += 8;
    return {name:entry.name,url:entry.url,score:Math.min(99,Math.round(score)),source_type:'DISCOVERY_SEED'};
  }).sort(function(a,b){return b.score-a.score;}).slice(0,OCE_MISSION.MAX_SEEDS);
}

function runOceMissionBatch(limit) {
  return runQueueWorker(limit || 5);
}

function getOceMissionStatus(missionId) {
  const runs = getOceSpreadsheet_().getSheetByName(OCE_MISSION.RUNS_SHEET);
  if (!runs || runs.getLastRow() < 2) throw Error('No missions found.');
  const rows = runs.getRange(2,1,runs.getLastRow()-1,9).getValues();
  const row = rows.find(function(r){return r[0] === missionId;});
  if (!row) throw Error('Mission not found: '+missionId);
  const queue = getMissionQueueStats_(missionId);
  const total = queue.total || 0;
  const done = queue.completed + queue.failed + queue.blocked;
  const progress = total ? Math.min(99,Math.round((done/total)*90)+10) : 10;
  return {mission_id:missionId,topic:row[7],status:row[8],progress:progress,queue:queue,started_at:row[1],completed_at:row[2] || ''};
}

function getMissionQueueStats_(missionId) {
  const queue = getOceSpreadsheet_().getSheetByName(OCE_SOURCE_REGISTRY.QUEUE_SHEET);
  const out={total:0,queued:0,scraping:0,completed:0,failed:0,blocked:0};
  if(!queue || queue.getLastRow()<2)return out;
  const rows=queue.getRange(2,1,queue.getLastRow()-1,11).getValues();
  rows.forEach(function(r){const source=String(r[10]||'');if(source.indexOf('mission_id='+missionId)===-1)return;out.total+=1;const s=String(r[4]||'').toLowerCase();if(Object.prototype.hasOwnProperty.call(out,s))out[s]+=1;});
  return out;
}

function updateMissionRun_(runId,patch) {
  const sheet=getOceSpreadsheet_().getSheetByName(OCE_MISSION.RUNS_SHEET);
  const rows=sheet.getRange(2,1,sheet.getLastRow()-1,9).getValues();
  const index=rows.findIndex(function(r){return r[0]===runId;});
  if(index<0)return;
  const r=rows[index];
  if(patch.completed_at!==undefined)r[2]=patch.completed_at;
  if(patch.discovered_count!==undefined)r[4]=patch.discovered_count;
  if(patch.queued_count!==undefined)r[5]=patch.queued_count;
  if(patch.failed_count!==undefined)r[6]=patch.failed_count;
  if(patch.status!==undefined)r[8]=patch.status;
  sheet.getRange(index+2,1,1,9).setValues([r]);
}

function enableOceAutomation() {
  ScriptApp.getProjectTriggers().forEach(function(trigger){if(trigger.getHandlerFunction()==='runOceMissionBatch')ScriptApp.deleteTrigger(trigger);});
  ScriptApp.newTrigger('runOceMissionBatch').timeBased().everyMinutes(5).create();
  return {enabled:true,interval_minutes:5};
}

function disableOceAutomation() {
  ScriptApp.getProjectTriggers().forEach(function(trigger){if(trigger.getHandlerFunction()==='runOceMissionBatch')ScriptApp.deleteTrigger(trigger);});
  return {enabled:false};
}

function testOceMission(){return startOceMission('Auditor firms in Uganda');}
