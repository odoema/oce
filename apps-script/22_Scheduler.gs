/**
 * 22_Scheduler: one time-driven trigger (oceTick) every 5 minutes.
 *
 * Each tick: collection (if missions are running) then delivery (if a campaign is ACTIVE and sending is allowed).
 * When there is nothing to do, the trigger removes itself, so idle projects cost zero quota.
 * Consumer Google accounts get 90 trigger-minutes/day; 5-minute ticks of <=4 minutes stay well inside that
 * only while there is real work, which is why self-disabling matters.
 */

var OCE_SCHEDULER = {
  HANDLER: 'oceTick',
  MINUTES: 5,
  LEGACY_HANDLERS: ['runOceMissionBatch', 'schedulerTick_', 'processPendingDelivery']
};

/** Trigger entry point. Must stay a public (non-underscore) function. */
function oceTick() {
  var summary = { at: new Date().toISOString() };
  try {
    if (oceSettingBool_('CRAWL_ENABLED', true) && oceHasPendingWork_()) {
      summary.crawl = oceRunWorker_({ max_seconds: Math.min(oceSettingNumber_('CRAWL_TICK_SECONDS', 240), 200) });
    }
  } catch (err) {
    summary.crawl_error = String(err.message || err);
  }
  try {
    oceResetTables_();
    if (oceHasActiveCampaign_()) summary.delivery = oceRunDelivery_({});
  } catch (err) {
    summary.delivery_error = String(err.message || err);
    oceLog_('ERROR', 'scheduler', 'Delivery tick failed: ' + summary.delivery_error);
  }
  try {
    oceResetTables_();
    if (!oceHasPendingWork_() && !oceHasActiveCampaign_()) {
      oceDisableAutomation_();
      summary.automation = 'disabled (idle)';
      oceLog_('INFO', 'scheduler', 'No pending work. Automation paused until the next mission or campaign.');
    }
    oceFlushAll_();
  } catch (err) { /* never fail the trigger on housekeeping */ }
  return summary;
}

function oceEnsureAutomation_() {
  var mine = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === OCE_SCHEDULER.HANDLER; });
  if (mine.length === 1) return oceAutomationStatus_();
  mine.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(OCE_SCHEDULER.HANDLER).timeBased().everyMinutes(OCE_SCHEDULER.MINUTES).create();
  return oceAutomationStatus_();
}

function oceDisableAutomation_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === OCE_SCHEDULER.HANDLER) ScriptApp.deleteTrigger(t);
  });
  return oceAutomationStatus_();
}

/** Removes v1 triggers (every-minute runOceMissionBatch etc.) that waste quota and race each other. */
function oceRemoveLegacyTriggers_() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (OCE_SCHEDULER.LEGACY_HANDLERS.indexOf(t.getHandlerFunction()) >= 0) { ScriptApp.deleteTrigger(t); removed++; }
  });
  return removed;
}

function oceAutomationStatus_() {
  var triggers = ScriptApp.getProjectTriggers();
  var mine = triggers.filter(function (t) { return t.getHandlerFunction() === OCE_SCHEDULER.HANDLER; });
  var legacy = triggers.filter(function (t) { return OCE_SCHEDULER.LEGACY_HANDLERS.indexOf(t.getHandlerFunction()) >= 0; });
  return { enabled: mine.length > 0, trigger_count: mine.length, interval_minutes: OCE_SCHEDULER.MINUTES, legacy_triggers: legacy.length };
}
