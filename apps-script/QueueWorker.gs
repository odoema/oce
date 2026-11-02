/* OCE Queue Worker V1
 * LEGO block: persistent SOURCE_QUEUE -> controlled collection -> results.
 * It orchestrates the existing UrlScraper V2.0.0 function scrapeUrl_().
 */

const OCE_QUEUE_WORKER = {
  VERSION: '1.0.0',
  QUEUE_SHEET: 'SOURCE_QUEUE',
  REGISTRY_SHEET: 'SOURCE_REGISTRY',
  RESULTS_SHEET: 'SOURCE_RESULTS',
  MAX_BATCH: 10,
  LOCK_WAIT_MS: 30000
};

function setupQueueWorker() {
  const ss = getOceSpreadsheet_();
  const sheet = ss.getSheetByName(OCE_QUEUE_WORKER.RESULTS_SHEET) || ss.insertSheet(OCE_QUEUE_WORKER.RESULTS_SHEET);
  const headers = ['result_id','queue_id','source_id','url','status','http_status','title','description','collected_at','collector_version','link_count','table_count','text_length','error'];
  if (sheet.getLastRow() === 0) sheet.getRange(1,1,1,headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,headers.length).setFontWeight('bold');
  return sheet.getName();
}

function runQueueWorker(limit) {
  const lock = LockService.getScriptLock();
  lock.waitLock(OCE_QUEUE_WORKER.LOCK_WAIT_MS);
  try {
    setupQueueWorker();
    const max = Math.max(1, Math.min(OCE_QUEUE_WORKER.MAX_BATCH, Number(limit || 5)));
    const queueItems = getSourceQueue(max);
    const summary = {version:OCE_QUEUE_WORKER.VERSION,requested:max,processed:0,completed:0,failed:0,blocked:0,items:[]};
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
    return {queue_id:item.queue_id,source_id:item.source_id,url:item.url,status:'COMPLETED',title:result.title || '',result_id:saved.result_id,discovered:discovered,started_at:started.toISOString()};
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
  const sheet = getOceSpreadsheet_().getSheetByName(OCE_QUEUE_WORKER.RESULTS_SHEET);
  const resultId = Utilities.getUuid();
  sheet.appendRow([
    resultId,item.queue_id,item.source_id,item.url,status,'',
    result ? String(result.title || '') : '',
    result ? String(result.description || '') : '',
    result ? (result.collected_at || new Date()) : new Date(),
    result ? String(result.collector_version || '') : '',
    result && Array.isArray(result.links) ? result.links.length : 0,
    result && Array.isArray(result.tables) ? result.tables.length : 0,
    result ? String(result.text || '').length : 0,
    errorMessage || ''
  ]);
  return {result_id:resultId};
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
