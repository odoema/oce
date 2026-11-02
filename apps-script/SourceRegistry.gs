/* OCE Source Registry V2
 * LEGO block: discovered URLs -> persistent registry -> controlled queue.
 * Standalone Apps Script safe: the spreadsheet is created and remembered by ID.
 */

const OCE_SOURCE_REGISTRY = {
  VERSION: '2.0.0',
  REGISTRY_SHEET: 'SOURCE_REGISTRY',
  QUEUE_SHEET: 'SOURCE_QUEUE',
  RUNS_SHEET: 'SCOUT_RUNS',
  SPREADSHEET_PROPERTY: 'OCE_SPREADSHEET_ID',
  SPREADSHEET_NAME: 'OCE — Source Intelligence Data',
  MAX_QUEUE: 10000
};

function setupSourceRegistry() {
  const ss = getOrCreateOceSpreadsheet_();
  const schemas = {};
  schemas[OCE_SOURCE_REGISTRY.REGISTRY_SHEET] = ['source_id','url','canonical_url','domain','source_type','topic','label','priority','discovered_at','last_scanned_at','last_status','http_status','scan_count','queue_status','provenance','notes'];
  schemas[OCE_SOURCE_REGISTRY.QUEUE_SHEET] = ['queue_id','source_id','url','priority','status','queued_at','started_at','completed_at','attempt_count','last_error','source'];
  schemas[OCE_SOURCE_REGISTRY.RUNS_SHEET] = ['run_id','started_at','completed_at','seed_count','discovered_count','queued_count','failed_count','topic','status'];
  Object.keys(schemas).forEach(function(name){
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    const headers = schemas[name];
    if (sheet.getLastRow() === 0) sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,headers.length).setFontWeight('bold');
  });
  return ss.getUrl();
}

function getOrCreateOceSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(OCE_SOURCE_REGISTRY.SPREADSHEET_PROPERTY);
  if (existingId) {
    try { return SpreadsheetApp.openById(existingId); } catch (_) {}
  }
  const ss = SpreadsheetApp.create(OCE_SOURCE_REGISTRY.SPREADSHEET_NAME);
  props.setProperty(OCE_SOURCE_REGISTRY.SPREADSHEET_PROPERTY, ss.getId());
  return ss;
}

function getOceSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(OCE_SOURCE_REGISTRY.SPREADSHEET_PROPERTY);
  if (!id) throw Error('OCE Source Registry is not initialized. Run setupSourceRegistry first.');
  return SpreadsheetApp.openById(id);
}

function registerDiscoveredSource(source) {
  if (!source || !source.url) throw Error('Source URL is required.');
  const canonical = sourceCanonicalUrl_(source.url);
  if (!canonical) throw Error('Invalid public HTTP/HTTPS source URL.');
  const sheet = getOceSpreadsheet_().getSheetByName(OCE_SOURCE_REGISTRY.REGISTRY_SHEET);
  if (!sheet) throw Error('Source Registry is not initialized.');
  const existing = findRegisteredSource_(sheet, canonical);
  const now = new Date();
  const record = [
    existing ? existing.source_id : Utilities.getUuid(), canonical, canonical, sourceDomain_(canonical),
    clean_(source.source_type), clean_(source.topic), clean_(source.label), Number(source.priority || 0),
    existing ? existing.discovered_at : (source.discovered_at || now), existing ? existing.last_scanned_at : '',
    existing ? existing.last_status : 'DISCOVERED', existing ? existing.http_status : '', existing ? existing.scan_count : 0,
    existing ? existing.queue_status : 'NOT_QUEUED', clean_(source.provenance || 'SOURCE_SCOUT'), clean_(source.notes)
  ];
  if (existing) { sheet.getRange(existing.row,1,1,record.length).setValues([record]); return {source_id:record[0],status:'UPDATED',row:existing.row}; }
  sheet.appendRow(record);
  return {source_id:record[0],status:'CREATED',row:sheet.getLastRow()};
}

function enqueueRegisteredSource(sourceId, priority) {
  const ss = getOceSpreadsheet_();
  const registry = ss.getSheetByName(OCE_SOURCE_REGISTRY.REGISTRY_SHEET);
  const queue = ss.getSheetByName(OCE_SOURCE_REGISTRY.QUEUE_SHEET);
  if (!registry || !queue) throw Error('Source Registry is not initialized.');
  const source = findSourceById_(registry, sourceId);
  if (!source) throw Error('Source not found: ' + sourceId);
  if (queue.getLastRow() - 1 >= OCE_SOURCE_REGISTRY.MAX_QUEUE) throw Error('Source queue capacity reached.');
  const existing = findQueuedSource_(queue, source.source_id);
  if (existing) return {queue_id:existing.queue_id,status:'ALREADY_QUEUED'};
  const queueId = Utilities.getUuid();
  queue.appendRow([queueId,source.source_id,source.canonical_url,Number(priority || source.priority || 0),'QUEUED',new Date(),'','',0,'',source.provenance || 'SOURCE_SCOUT']);
  updateRegistryQueueStatus_(registry,source.row,'QUEUED');
  return {queue_id:queueId,status:'QUEUED'};
}

function registerAndQueueSource(source) {
  const registered = registerDiscoveredSource(source);
  return enqueueRegisteredSource(registered.source_id, source.priority);
}

function getSourceQueue(limit) {
  const sheet = getOceSpreadsheet_().getSheetByName(OCE_SOURCE_REGISTRY.QUEUE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const max = Math.min(Number(limit || 100), OCE_SOURCE_REGISTRY.MAX_QUEUE);
  const rows = sheet.getRange(2,1,sheet.getLastRow()-1,11).getValues();
  return rows.filter(function(r){return String(r[4]).toUpperCase()==='QUEUED';})
    .sort(function(a,b){return Number(b[3]||0)-Number(a[3]||0);}).slice(0,max)
    .map(function(r){return {queue_id:r[0],source_id:r[1],url:r[2],priority:r[3],status:r[4],queued_at:r[5],attempt_count:r[8],source:r[10]};});
}

function markSourceQueueStatus(queueId,status,errorMessage) {
  const ss = getOceSpreadsheet_();
  const queue = ss.getSheetByName(OCE_SOURCE_REGISTRY.QUEUE_SHEET);
  if (!queue || queue.getLastRow() < 2) throw Error('Source queue is empty.');
  const rows = queue.getRange(2,1,queue.getLastRow()-1,11).getValues();
  const index = rows.findIndex(function(r){return r[0]===queueId;});
  if (index < 0) throw Error('Queue item not found: ' + queueId);
  const row = index + 2, values = rows[index], now = new Date();
  values[4] = String(status || '').toUpperCase();
  if (values[4] === 'FAILED') values[8] = Number(values[8] || 0) + 1;
  values[9] = errorMessage || '';
  if (values[4] === 'SCRAPING') values[6] = now;
  if (['COMPLETED','FAILED','BLOCKED'].indexOf(values[4]) >= 0) values[7] = now;
  queue.getRange(row,1,1,11).setValues([values]);
  const registry = ss.getSheetByName(OCE_SOURCE_REGISTRY.REGISTRY_SHEET);
  if (registry) {
    const source = findSourceById_(registry,values[1]);
    if (source) {
      updateRegistryQueueStatus_(registry,source.row,values[4]);
      registry.getRange(source.row,10).setValue(values[4] === 'COMPLETED' ? now : source.last_scanned_at);
      registry.getRange(source.row,11).setValue(values[4]);
      registry.getRange(source.row,12).setValue('');
      registry.getRange(source.row,13).setValue(Number(source.scan_count || 0) + (values[4] === 'COMPLETED' ? 1 : 0));
    }
  }
}

function findRegisteredSource_(sheet,canonicalUrl) {
  if (sheet.getLastRow()<2) return null;
  const rows=sheet.getRange(2,1,sheet.getLastRow()-1,16).getValues();
  for(let i=0;i<rows.length;i++) if(rows[i][2]===canonicalUrl) return {row:i+2,source_id:rows[i][0],discovered_at:rows[i][8],last_scanned_at:rows[i][9],last_status:rows[i][10],http_status:rows[i][11],scan_count:rows[i][12],queue_status:rows[i][13]};
  return null;
}
function findSourceById_(sheet,sourceId) {
  if(sheet.getLastRow()<2)return null; const rows=sheet.getRange(2,1,sheet.getLastRow()-1,16).getValues();
  for(let i=0;i<rows.length;i++) if(rows[i][0]===sourceId)return {row:i+2,source_id:rows[i][0],canonical_url:rows[i][2],priority:rows[i][7],topic:rows[i][5],last_scanned_at:rows[i][9],scan_count:rows[i][12],provenance:rows[i][14]};
  return null;
}
function findQueuedSource_(sheet,sourceId){if(sheet.getLastRow()<2)return null;const rows=sheet.getRange(2,1,sheet.getLastRow()-1,11).getValues();for(let i=0;i<rows.length;i++)if(rows[i][1]===sourceId&&['QUEUED','SCRAPING'].indexOf(String(rows[i][4]).toUpperCase())>=0)return{row:i+2,queue_id:rows[i][0]};return null;}
function updateRegistryQueueStatus_(sheet,row,status){sheet.getRange(row,14).setValue(status||'NOT_QUEUED');}
function sourceCanonicalUrl_(value){let url=String(value||'').trim();if(!/^https?:\/\//i.test(url))return '';url=url.replace(/#.*$/,'').replace(/\?.*$/,'');if(url.length>2048)return '';return url.replace(/\/$/,'')||url;}
function sourceDomain_(url){const match=String(url).match(/^https?:\/\/([^\/]+)/i);return match?match[1].toLowerCase():'';}
function clean_(value){return String(value==null?'':value).trim();}

function testSourceRegistry(){setupSourceRegistry();const source={url:'https://example.com/',source_type:'WEBSITE',topic:'TEST',label:'Example Domain',priority:100,provenance:'MANUAL_TEST'};const result=registerAndQueueSource(source);Logger.log(JSON.stringify(result,null,2));return result;}
function testGetSourceQueue(){const result=getSourceQueue(10);Logger.log(JSON.stringify(result,null,2));return result;}
function getOceSpreadsheetUrl(){return getOceSpreadsheet_().getUrl();}
