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

    if (action === 'run_worker') {
      var limit = Number(params.limit || 5);
      limit = Math.max(1, Math.min(10, limit));
      return gatewayJson_({ok:true,worker:runOceMissionBatch(limit)});
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
