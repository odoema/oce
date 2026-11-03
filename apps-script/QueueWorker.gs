/* OCE Queue Worker V1
 * LEGO block: persistent SOURCE_QUEUE -> collection -> usable extracted data.
 * The crawler core remains intact; this adds durable contact/entity persistence.
 */

const OCE_QUEUE_WORKER = {
  VERSION: '1.1.0',
  QUEUE_SHEET: 'SOURCE_QUEUE',
  REGISTRY_SHEET: 'SOURCE_REGISTRY',
  RESULTS_SHEET: 'SOURCE_RESULTS',
  DATA_SHEET: 'OCE_DATA',
  MAX_BATCH: 10,
  LOCK_WAIT_MS: 30000
};

const OCE_RESULT_HEADERS = [
  'result_id','queue_id','source_id','url','status','http_status','title','description',
  'collected_at','collector_version','link_count','table_count','text_length','error',
  'page_text','jsonld_json','tables_json','emails','phones','organization','address'
];

const OCE_DATA_HEADERS = [
  'data_id','result_id','queue_id','source_id','source_url','status','collected_at',
  'organization','email','phone','address','website','title','description','source_type',
  'provenance','confidence','raw_text','jsonld_json','tables_json'
];

function setupQueueWorker() {
  const ss = getOceSpreadsheet_();
  const resultSheet = ss.getSheetByName(OCE_QUEUE_WORKER.RESULTS_SHEET) || ss.insertSheet(OCE_QUEUE_WORKER.RESULTS_SHEET);
  ensureHeaders_(resultSheet, OCE_RESULT_HEADERS);

  const dataSheet = ss.getSheetByName(OCE_QUEUE_WORKER.DATA_SHEET) || ss.insertSheet(OCE_QUEUE_WORKER.DATA_SHEET);
  ensureHeaders_(dataSheet, OCE_DATA_HEADERS);
  dataSheet.setFrozenRows(1);
  return resultSheet.getName();
}

function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String);
    const missing = headers.filter(function(h) { return existing.indexOf(h) < 0; });
    if (missing.length) {
      const start = Math.max(sheet.getLastColumn(), 0) + 1;
      sheet.getRange(1, start, 1, missing.length).setValues([missing]);
    }
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,headers.length).setFontWeight('bold');
}

function runQueueWorker(limit, missionId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(OCE_QUEUE_WORKER.LOCK_WAIT_MS);
  try {
    setupQueueWorker();
    const max = Math.max(1, Math.min(OCE_QUEUE_WORKER.MAX_BATCH, Number(limit || 5)));
    const targetMission = String(missionId || '').trim();
    const queueItems = getSourceQueue(max, targetMission);
    const summary = {version:OCE_QUEUE_WORKER.VERSION,requested:max,mission_id:targetMission,processed:0,completed:0,failed:0,blocked:0,items:[]};
    queueItems.forEach(function(item) {
      const outcome = processQueueItem_(item);
      summary.processed += 1;
      if (outcome.status === 'COMPLETED') summary.completed += 1;
      else if (outcome.status === 'BLOCKED') summary.blocked += 1;
      else summary.failed += 1;
      summary.items.push(outcome);
    });
    return summary;
  } finally {
    lock.releaseLock();
  }
}

function processQueueItem_(item) {
  markSourceQueueStatus(item.queue_id, 'SCRAPING', '');
  const started = new Date();
  try {
    const result = scrapeUrl_(item.url);
    const saved = saveQueueResult_(item, result, 'COMPLETED', '');
    const discovered = queueDiscoveredLinks_(item, result);
    markSourceQueueStatus(item.queue_id, 'COMPLETED', '');
    return {queue_id:item.queue_id,source_id:item.source_id,url:item.url,status:'COMPLETED',title:result.title || '',result_id:saved.result_id,discovered:discovered,started_at:started.toISOString(),emails:saved.email_count,phones:saved.phone_count};
  } catch (err) {
    const message = String(err.message || err);
    const blocked = /blocked|authentication|captcha|paywall|access-control|HTTP 401|HTTP 403/i.test(message);
    const status = blocked ? 'BLOCKED' : 'FAILED';
    saveQueueResult_(item, null, status, message);
    markSourceQueueStatus(item.queue_id, status, message);
    return {queue_id:item.queue_id,source_id:item.source_id,url:item.url,status:status,error:message,started_at:started.toISOString()};
  }
}

function saveQueueResult_(item, result, status, errorMessage) {
  setupQueueWorker();
  const ss = getOceSpreadsheet_();
  const sheet = ss.getSheetByName(OCE_QUEUE_WORKER.RESULTS_SHEET);
  const resultId = Utilities.getUuid();
  const extracted = result ? extractOceData_(result) : {emails:[],phones:[],organization:'',address:'',website:'',confidence:0};
  const sourceRecord = findSourceById_(ss.getSheetByName(OCE_QUEUE_WORKER.REGISTRY_SHEET), item.source_id) || {};

  sheet.appendRow([
    resultId,item.queue_id,item.source_id,item.url,status,'',
    result ? String(result.title || '') : '',
    result ? String(result.description || '') : '',
    result ? (result.collected_at || new Date()) : new Date(),
    result ? String(result.collector_version || '') : '',
    result && Array.isArray(result.links) ? result.links.length : 0,
    result && Array.isArray(result.tables) ? result.tables.length : 0,
    result ? String(result.text || '').length : 0,
    errorMessage || '',
    result ? String(result.text || '') : '',
    result ? safeJson_(result.jsonld || []) : '',
    result ? safeJson_(result.tables || []) : '',
    extracted.emails.join('; '),
    extracted.phones.join('; '),
    extracted.organization,
    extracted.address
  ]);

  if (result) {
    saveOceData_(item, result, resultId, extracted, sourceRecord);
  }
  return {result_id:resultId,email_count:extracted.emails.length,phone_count:extracted.phones.length};
}

function saveOceData_(item, result, resultId, extracted, sourceRecord) {
  const sheet = getOceSpreadsheet_().getSheetByName(OCE_QUEUE_WORKER.DATA_SHEET);
  const dataId = Utilities.getUuid();
  sheet.appendRow([
    dataId,resultId,item.queue_id,item.source_id,item.url,'COMPLETED',
    result.collected_at || new Date(),
    extracted.organization,extracted.emails.join('; '),extracted.phones.join('; '),
    extracted.address,extracted.website,String(result.title || ''),String(result.description || ''),
    String(sourceRecord.source_type || ''),String(item.source || 'QUEUE_WORKER'),
    extracted.confidence,String(result.text || ''),safeJson_(result.jsonld || []),safeJson_(result.tables || [])
  ]);
}

function extractOceData_(result) {
  const text = String(result.text || '');
  const jsonld = Array.isArray(result.jsonld) ? result.jsonld : [];
  const haystack = text + '\n' + safeJson_(jsonld);
  const emails = unique_(haystack.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [])
    .map(function(v){ return v.toLowerCase(); })
    .filter(function(v){ return !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(v); });
  const phones = unique_(haystack.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [])
    .map(normalizePhone_)
    .filter(function(v){ return v.length >= 9 && v.length <= 20; });

  let organization = '';
  let address = '';
  let website = String(result.source_url || '');
  jsonld.some(function(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (!organization && obj.name) organization = String(obj.name).trim();
    if (!address && obj.address) {
      if (typeof obj.address === 'string') address = obj.address;
      else if (obj.address.streetAddress || obj.address.addressLocality || obj.address.addressRegion) {
        address = [obj.address.streetAddress,obj.addressLocality,obj.addressRegion,obj.address.addressCountry].filter(Boolean).join(', ');
      }
    }
    if (obj.url) website = String(obj.url);
    return !!(organization && address);
  });
  if (!organization) organization = String(result.title || '').replace(/\s*[|–-]\s*.*$/, '').trim();

  const confidence = Math.min(100, 30 + (emails.length ? 30 : 0) + (phones.length ? 25 : 0) + (organization ? 10 : 0) + (address ? 5 : 0));
  return {emails:emails,phones:phones,organization:organization,address:address,website:website,confidence:confidence};
}

function normalizePhone_(value) {
  return String(value || '').replace(/\s+/g,' ').trim().replace(/[.,;:]+$/,'');
}

function unique_(arr) {
  const seen = {};
  return arr.filter(function(v){ const k=String(v).toLowerCase(); if(seen[k]) return false; seen[k]=true; return true; });
}

function safeJson_(value) {
  try { return JSON.stringify(value); } catch (_) { return ''; }
}

function queueWorkerStatus() {
  const ss = getOceSpreadsheet_();
  const queue = ss.getSheetByName(OCE_QUEUE_WORKER.QUEUE_SHEET);
  if (!queue || queue.getLastRow() < 2) return {queued:0,scraping:0,completed:0,failed:0,blocked:0,total:0};
  const rows = queue.getRange(2,1,queue.getLastRow()-1,11).getValues();
  const out = {queued:0,scraping:0,completed:0,failed:0,blocked:0,total:rows.length};
  rows.forEach(function(r){ const s=String(r[4]||'').toLowerCase(); if (Object.prototype.hasOwnProperty.call(out,s)) out[s] += 1; });
  return out;
}

function queueDiscoveredLinks_(item, result) {
  const links = Array.isArray(result && result.links) ? result.links : [];
  const registry = getOceSpreadsheet_().getSheetByName(OCE_QUEUE_WORKER.REGISTRY_SHEET);
  const sourceRecord = findSourceById_(registry, item.source_id);
  const topic = sourceRecord && sourceRecord.topic ? sourceRecord.topic : '';
  const provenance = String(item.source || 'QUEUE_WORKER');
  let added = 0;
  const seen = {};
  links.forEach(function(link) {
    if (added >= 25) return;
    const url = sourceCanonicalUrl_(String(link && link.url || ''));
    if (!url || seen[url]) return;
    seen[url] = true;
    if (/\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|rar|7z|mp4|mp3|avi|mov|css|js|woff|woff2|ttf)(\?|$)/i.test(url)) return;
    const label = String(link && link.label || '').trim();
    const hay = (url + ' ' + label + ' ' + topic).toLowerCase();
    let priority = 40;
    if (/contact|about|directory|member|members|company|companies|business|businesses|firm|firms|supplier|vendor|partner|organization|organisation|registry|listing|services|team|staff/.test(hay)) priority += 30;
    String(topic).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0,8).forEach(function(term){ if(term.length>2 && hay.indexOf(term)>=0) priority += 4; });
    try {
      registerAndQueueSource({url:url,source_type:'DISCOVERED_PAGE',topic:topic,label:label,priority:Math.min(99,priority),provenance:provenance,notes:'Discovered by Queue Worker from '+item.url});
      added += 1;
    } catch (_) {}
  });
  return added;
}

function testQueueWorker() {
  return runQueueWorker(1);
}
