// OCE Collector Gateway V3
// Browser-facing gateway for public collection and mission control.
// No collector token is ever sent to the browser.
// Public/authorized pages only. No login, CAPTCHA, paywall or access-control bypass.

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var action = String(params.action || '').trim().toLowerCase();

    if (action === 'start_mission') {
      var topic = String(params.topic || '').trim();
      if (!topic) return gatewayJson_({ok:false,error:'Mission topic is required.'});
      return gatewayJson_({ok:true,mission:startOceMission(topic)});
    }

    if (action === 'mission_status') {
      var missionId = String(params.mission_id || '').trim();
      if (!missionId) return gatewayJson_({ok:false,error:'Mission ID is required.'});
      return gatewayJson_({ok:true,mission:getOceMissionStatus(missionId)});
    }

    if (action === 'mission_queue_page') {
      var queueMissionId = String(params.mission_id || '').trim();
      if (!queueMissionId) return gatewayJson_({ok:false,error:'Mission ID is required.'});
      var queuePage = Math.max(1, Number(params.page || 1));
      var queuePageSize = Math.max(1, Math.min(100, Number(params.page_size || 25)));
      return gatewayJson_({ok:true,queue:getOceMissionQueuePage(queueMissionId,queuePage,queuePageSize)});
    }

    if (action === 'discover') {
      var objective = String(params.objective || params.topic || '').trim();
      if (!objective) return gatewayJson_({ok:false,error:'Discovery objective is required.'});
      return gatewayJson_({ok:true,discovery:discoverSearchCandidates(objective)});
    }

    if (action === 'profile_source') {
      var sourceUrl = String(params.url || '').trim();
      var sourceObjective = String(params.objective || params.topic || '').trim();
      if (!sourceUrl) return gatewayJson_({ok:false,error:'Source URL is required.'});
      return gatewayJson_({ok:true,profile:profileSourceIntelligence(sourceUrl,sourceObjective)});
    }

    if (action === 'queue_discovery') {
      var discoveryObjective = String(params.objective || params.topic || '').trim();
      if (!discoveryObjective) return gatewayJson_({ok:false,error:'Discovery objective is required.'});
      var candidateLimit = Math.max(1, Math.min(50, Number(params.limit || 10)));
      return gatewayJson_({ok:true,discovery:queueDiscoveryCandidates(discoveryObjective,candidateLimit)});
    }

    if (action === 'run_worker') {
      var limit = Number(params.limit || 5);
      limit = Math.max(1, Math.min(10, limit));
      var workerMissionId = String(params.mission_id || '').trim();
      return gatewayJson_({ok:true,worker:runOceMissionBatchForMission_(limit,workerMissionId)});
    }

    if (action === 'automation_status') {
      return gatewayJson_({ok:true,automation:oceAutomationStatus_()});
    }

    var url = String(params.url || '').trim();
    if (!url) return gatewayJson_({ok:false,error:'URL is required'});
    var result = scrapeUrl_(url);
    return gatewayJson_({ok:true,result:result});
  } catch (err) {
    return gatewayJson_({ok:false,error:String(err.message || err)});
  }
}

function oceAutomationStatus_() {
  var triggers = ScriptApp.getProjectTriggers();
  var matches = triggers.filter(function(trigger){return trigger.getHandlerFunction() === 'runOceMissionBatch';});
  return {enabled:matches.length > 0,trigger_count:matches.length,interval_minutes:1};
}

function gatewayJson_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
