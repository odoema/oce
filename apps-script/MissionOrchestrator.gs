/* OCE Mission Orchestrator V2
 * LEGO block: objective -> automatic public discovery -> persistent queue -> real progress.
 * Seed URLs are generated internally; operators do not need to provide them.
 *
 * This block does not scrape directly. QueueWorker owns collection.
 */

const OCE_MISSION = {
  VERSION: '2.0.0',
  RUNS_SHEET: 'SCOUT_RUNS',
  MAX_SEEDS: 6,
  AUTOMATION_MINUTES: 1
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
  ensureOceAutomation_();

  const seeds = planMissionSeeds_(objective);
  if (!seeds.length) throw Error('No suitable public discovery sources were found for this mission.');

  const runs = getOceSpreadsheet_().getSheetByName(OCE_MISSION.RUNS_SHEET);
  ensureMissionRunHeader_(runs);
  const runId = Utilities.getUuid();
  runs.appendRow([runId,new Date(),'',seeds.length,0,0,0,objective,'PLANNING',0]);

  let queued = 0;
  seeds.forEach(function(seed){
    try {
      registerAndQueueSource({
        url:seed.url,
        source_type:'DISCOVERY_SEED',
        topic:objective,
        label:seed.name,
        priority:seed.score,
        provenance:'DISCOVERY_BRAIN|mission_id='+runId,
        notes:'Mission '+runId
      });
      queued += 1;
    } catch (err) {
      Logger.log('Seed queue failure: '+seed.url+' — '+err.message);
    }
  });

  updateMissionRun_(runId,{status:queued ? 'QUEUED' : 'FAILED',queued_count:queued,discovered_count:queued,progress:queued ? 10 : 0});

  return getOceMissionStatus(runId);
}

function planMissionSeeds_(topic) {
  const normalized = String(topic).toLowerCase();
  return OCE_MISSION_CATALOG.map(function(entry){
    let score = entry.authority * 0.45;
    entry.keywords.forEach(function(k){ if(normalized.indexOf(k) >= 0) score += 28; });
    if (/uganda|ugandan|kampala/.test(normalized)) score += 8;
    return {
      name:entry.name,
      url:entry.url,
      score:Math.min(99,Math.round(score)),
      source_type:'DISCOVERY_SEED'
    };
  }).sort(function(a,b){return b.score-a.score;}).slice(0,OCE_MISSION.MAX_SEEDS);
}

function runOceMissionBatch(limit) {
  const result = runQueueWorker(limit || 5);
  refreshOceMissionRuns_();
  return result;
}

function getOceMissionStatus(missionId) {
  const runs = getOceSpreadsheet_().getSheetByName(OCE_MISSION.RUNS_SHEET);
  ensureMissionRunHeader_(runs);
  if (!runs || runs.getLastRow() < 2) throw Error('No missions found.');

  const rows = runs.getRange(2,1,runs.getLastRow()-1,10).getValues();
  const row = rows.find(function(r){return r[0] === missionId;});
  if (!row) throw Error('Mission not found: '+missionId);

  const queue = getMissionQueueStats_(missionId);
  const computed = computeMissionProgress_(row, queue);
  if (computed.progress !== Number(row[9] || 0) || computed.status !== row[8]) {
    updateMissionRun_(missionId,{
      progress:computed.progress,
      status:computed.status,
      discovered_count:queue.total,
      queued_count:queue.queued,
      failed_count:queue.failed + queue.blocked,
      completed_at:computed.terminal ? (row[2] || new Date()) : row[2]
    });
  }

  return {
    mission_id:missionId,
    topic:row[7],
    status:computed.status,
    phase:computed.phase,
    progress:computed.progress,
    queue:queue,
    queue_items:getMissionQueuePreview_(missionId,50),
    started_at:row[1],
    completed_at:computed.terminal ? (row[2] || new Date()) : ''
  };
}

function computeMissionProgress_(runRow, queue) {
  const total = queue.total || 0;
  const processed = queue.completed + queue.failed + queue.blocked;
  let progress = Number(runRow[9] || 0);
  let status = String(runRow[8] || 'PLANNING');
  let phase = 'PLANNING';
  let terminal = false;

  if (!total) {
    return {progress:progress || 10,status:status,phase:phase,terminal:false};
  }

  if (queue.queued > 0 || queue.scraping > 0) {
    phase = 'COLLECTING';
    status = 'COLLECTING';
    const live = 10 + Math.round((processed / total) * 85);
    progress = Math.max(progress,Math.min(95,live));
  } else {
    terminal = true;
    phase = 'COMPLETE';
    status = (queue.failed + queue.blocked) > 0 ? 'COMPLETED_WITH_ISSUES' : 'COMPLETED';
    progress = 100;
  }

  return {progress:progress,status:status,phase:phase,terminal:terminal};
}

function getMissionQueueStats_(missionId) {
  const queue = getOceSpreadsheet_().getSheetByName(OCE_SOURCE_REGISTRY.QUEUE_SHEET);
  const out={total:0,queued:0,scraping:0,completed:0,failed:0,blocked:0};
  if(!queue || queue.getLastRow()<2)return out;

  const rows=queue.getRange(2,1,queue.getLastRow()-1,11).getValues();
  rows.forEach(function(r){
    const source=String(r[10]||'');
    if(source.indexOf('mission_id='+missionId)===-1)return;
    out.total += 1;
    const s=String(r[4]||'').toLowerCase();
    if(Object.prototype.hasOwnProperty.call(out,s))out[s] += 1;
  });
  return out;
}

function getMissionQueuePreview_(missionId,limit) {
  const queue = getOceSpreadsheet_().getSheetByName(OCE_SOURCE_REGISTRY.QUEUE_SHEET);
  if(!queue || queue.getLastRow()<2)return [];

  const rows=queue.getRange(2,1,queue.getLastRow()-1,11).getValues();
  return rows.filter(function(r){
    return String(r[10]||'').indexOf('mission_id='+missionId)!==-1;
  }).sort(function(a,b){
    return Number(b[3]||0)-Number(a[3]||0);
  }).slice(0,Number(limit||50)).map(function(r){
    return {
      queue_id:r[0],
      source_id:r[1],
      url:r[2],
      priority:Number(r[3]||0),
      status:String(r[4]||''),
      queued_at:r[5],
      started_at:r[6],
      completed_at:r[7],
      attempt_count:Number(r[8]||0),
      error:String(r[9]||''),
      source:String(r[10]||'')
    };
  });
}

function updateMissionRun_(runId,patch) {
  const sheet=getOceSpreadsheet_().getSheetByName(OCE_MISSION.RUNS_SHEET);
  ensureMissionRunHeader_(sheet);
  if(!sheet || sheet.getLastRow()<2)return;

  const rows=sheet.getRange(2,1,sheet.getLastRow()-1,10).getValues();
  const index=rows.findIndex(function(r){return r[0]===runId;});
  if(index<0)return;

  const r=rows[index];
  if(patch.completed_at!==undefined)r[2]=patch.completed_at || '';
  if(patch.discovered_count!==undefined)r[4]=patch.discovered_count;
  if(patch.queued_count!==undefined)r[5]=patch.queued_count;
  if(patch.failed_count!==undefined)r[6]=patch.failed_count;
  if(patch.status!==undefined)r[8]=patch.status;
  if(patch.progress!==undefined)r[9]=Math.max(Number(r[9]||0),Number(patch.progress||0));
  sheet.getRange(index+2,1,1,10).setValues([r]);
}

function refreshOceMissionRuns_() {
  const sheet=getOceSpreadsheet_().getSheetByName(OCE_MISSION.RUNS_SHEET);
  ensureMissionRunHeader_(sheet);
  if(!sheet || sheet.getLastRow()<2)return [];

  const rows=sheet.getRange(2,1,sheet.getLastRow()-1,10).getValues();
  const results=[];
  rows.forEach(function(row){
    const missionId=String(row[0]||'');
    if(!missionId)return;
    const queue=getMissionQueueStats_(missionId);
    const computed=computeMissionProgress_(row,queue);
    updateMissionRun_(missionId,{
      status:computed.status,
      progress:computed.progress,
      discovered_count:queue.total,
      queued_count:queue.queued,
      failed_count:queue.failed+queue.blocked,
      completed_at:computed.terminal ? (row[2] || new Date()) : ''
    });
    results.push({mission_id:missionId,status:computed.status,progress:computed.progress,queue:queue});
  });
  return results;
}

function ensureMissionRunHeader_(sheet) {
  if(!sheet)return;
  const headers=['run_id','started_at','completed_at','seed_count','discovered_count','queued_count','failed_count','topic','status','progress'];
  if(sheet.getLastRow()===0){
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }
  const existing=sheet.getRange(1,1,1,Math.max(sheet.getLastColumn(),headers.length)).getValues()[0];
  if(existing[9] !== 'progress')sheet.getRange(1,10).setValue('progress');
}

function ensureOceAutomation_() {
  const triggers=ScriptApp.getProjectTriggers();
  const existing=triggers.find(function(trigger){return trigger.getHandlerFunction()==='runOceMissionBatch';});
  if(existing)return {enabled:true,interval_minutes:OCE_MISSION.AUTOMATION_MINUTES};
  ScriptApp.newTrigger('runOceMissionBatch').timeBased().everyMinutes(OCE_MISSION.AUTOMATION_MINUTES).create();
  return {enabled:true,interval_minutes:OCE_MISSION.AUTOMATION_MINUTES};
}

function enableOceAutomation() {
  triggersForOceAutomation_().forEach(function(trigger){ScriptApp.deleteTrigger(trigger);});
  ScriptApp.newTrigger('runOceMissionBatch').timeBased().everyMinutes(OCE_MISSION.AUTOMATION_MINUTES).create();
  return {enabled:true,interval_minutes:OCE_MISSION.AUTOMATION_MINUTES};
}

function disableOceAutomation() {
  triggersForOceAutomation_().forEach(function(trigger){ScriptApp.deleteTrigger(trigger);});
  return {enabled:false};
}

function triggersForOceAutomation_() {
  return ScriptApp.getProjectTriggers().filter(function(trigger){return trigger.getHandlerFunction()==='runOceMissionBatch';});
}

function testOceMission(){return startOceMission('Auditor firms in Uganda');}
