// OCE Collector Gateway V4.2
// Browser-facing gateway for public collection and mission control.
// No collector token is ever sent to the browser.
// Public/authorized pages only. No login, CAPTCHA, paywall or access-control bypass.

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var action = String(params.action || '').trim().toLowerCase();

    if (action === 'health') {
      return gatewayJson_({ok:true,service:'OCE Collector Gateway',version:'4.2.0',status:'ONLINE',capabilities:['single_url_scan','mission_start','mission_status','mission_expand','mission_queue_page','queue_worker','automation_status','health']});
    }

    if (action === 'start_mission') {
      var topic = String(params.topic || '').trim();
      if (!topic) return gatewayJson_({ok:false,error:'Mission topic is required.'});
      var activeLimit = Number(params.active_limit || 300);
      activeLimit = Math.max(1, Math.min(10000, Math.floor(activeLimit)));
      return gatewayJson_({ok:true,mission:startOceMission(topic,{active_limit:activeLimit})});
    }

    if (action === 'mission_status') {
      var missionId = String(params.mission_id || '').trim();
      if (!missionId) return gatewayJson_({ok:false,error:'Mission ID is required.'});
      return gatewayJson_({ok:true,mission:getOceMissionStatus(missionId)});
    }

    if (action === 'mission_queue_page') {
      var queueMissionId = String(params.mission_id || '').trim();
      if (!queueMissionId) return gatewayJson_({ok:false,error:'Mission ID is required.'});
      var queuePage = Number(params.page || 1);
      var queuePageSize = Number(params.page_size || 25);
      return gatewayJson_({ok:true,queue:getOceMissionQueuePage(queueMissionId,queuePage,queuePageSize)});
    }

    if (action === 'expand_mission') {
      var expandMissionId = String(params.mission_id || '').trim();
      if (!expandMissionId) return gatewayJson_({ok:false,error:'Mission ID is required.'});
      var additional = Number(params.additional || 300);
      additional = Math.max(1, Math.min(5000, Math.floor(additional)));
      return gatewayJson_({ok:true,result:expandOceMission(expandMissionId,additional)});
    }

    if (action === 'run_worker') {
      var limit = Number(params.limit || 5);
      limit = Math.max(1, Math.min(10, limit));
      return gatewayJson_({ok:true,worker:runOceMissionBatch(limit)});
    }

    if (action === 'automation_status') {
      return gatewayJson_({ok:true,automation:getAutomationStatus_()});
    }

    var url = String(params.url || '').trim();
    if (!url) return gatewayJson_({ok:false,error:'URL is required'});
    var result = scrapeUrl_(url);
    return gatewayJson_({ok:true,result:result});
  } catch (err) {
    return gatewayJson_({ok:false,error:String(err.message || err)});
  }
}

function startOceMissionGateway(topic) { return startOceMission(topic); }
function getOceMissionStatusGateway(missionId) { return getOceMissionStatus(missionId); }
function getOceMissionQueuePageGateway(missionId,page,pageSize) { return getOceMissionQueuePage(missionId,page,pageSize); }
function runOceMissionBatchGateway(limit) { return runOceMissionBatch(limit || 5); }
function expandOceMissionGateway(missionId, additional) { return expandOceMission(missionId, additional || 300); }

function getAutomationStatus_() {
  if (typeof oceAutomationStatus === 'function') {
    try { return oceAutomationStatus(); } catch (_) {}
  }
  var triggers = ScriptApp.getProjectTriggers();
  var matches = triggers.filter(function(trigger){return trigger.getHandlerFunction() === 'runOceMissionBatch';});
  return {enabled:matches.length > 0,trigger_count:matches.length,interval_minutes:1};
}

function oceAutomationStatus_() { return getAutomationStatus_(); }

function gatewayJson_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function testCollectorGatewayHealth() {
  return {ok:true,gateway:'READY',version:'4.2.0',automation:getAutomationStatus_()};
}

function testCollectorGatewayMissionIntegration() {
  return {
    ok:true,
    gateway_version:'4.2.0',
    start_mission_available:typeof startOceMission==='function',
    mission_status_available:typeof getOceMissionStatus==='function',
    mission_queue_page_available:typeof getOceMissionQueuePage==='function',
    mission_expand_available:typeof expandOceMission==='function',
    worker_available:typeof runOceMissionBatch==='function',
    scraper_available:typeof scrapeUrl_==='function',
    automation_status_available:typeof getAutomationStatus_==='function',
    ready:typeof startOceMission==='function' && typeof getOceMissionStatus==='function' && typeof getOceMissionQueuePage==='function' && typeof expandOceMission==='function' && typeof runOceMissionBatch==='function' && typeof scrapeUrl_==='function'
  };
}
