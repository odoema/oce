/**
 * 41_Setup: installation, upgrade from v1, health check and the spreadsheet menu.
 *
 * First run (Apps Script editor): select oceSetup and press Run. It is idempotent.
 */

function oceSetup() {
  var ss = oceEnsureSchema_();
  oceEnsureSecrets_();
  var migrated = oceMigrateV1_();
  var removed = oceRemoveLegacyTriggers_();
  oceSeedHolidays_();
  oceFlushAll_();
  var report = {
    version: OCE.VERSION,
    spreadsheet_url: ss.getUrl(),
    api_key: oceSecret_('OCE_API_KEY'),
    webhook_key: oceSecret_('OCE_WEBHOOK_KEY'),
    web_app_url: oceUnsubscribeBaseUrl_() || '(deploy as web app to get the URL)',
    legacy_triggers_removed: removed,
    migration: migrated,
    next_steps: [
      'Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone). Copy the /exec URL.',
      'Open the dashboard, paste the web app URL and the API key above into Settings.',
      'Optional: add OCE_SEARCH_API_KEY (Brave Search) in Project Settings > Script Properties for better discovery.',
      'Before any real sending: set SENDER_POSTAL_ADDRESS, DEFAULT_FROM_EMAIL, RESEND_API_KEY, OCE_TEST_RECIPIENT and send a test.'
    ]
  };
  oceLog_('INFO', 'setup', 'Setup completed', { version: OCE.VERSION, migration: migrated, legacy_triggers_removed: removed });
  oceFlushAll_();
  console.log(JSON.stringify(report, null, 2));
  return report;
}

/** Prints the operator API key (Executions log). */
function oceShowApiKey() {
  var key = oceSecret_('OCE_API_KEY');
  console.log(key ? 'OCE API key: ' + key : 'No key yet: run oceSetup first.');
  return key;
}

/** Rotates the operator API key. Existing dashboards must be updated afterwards. */
function oceRotateApiKey() {
  PropertiesService.getScriptProperties().setProperty('OCE_API_KEY', oceRandomToken_(32));
  return oceShowApiKey();
}

/** Run once from the editor after you have tested with OCE_TEST_RECIPIENT. */
function oceApproveProduction() {
  PropertiesService.getScriptProperties().setProperty('OCE_PRODUCTION_APPROVED', 'TRUE');
  oceLog_('WARN', 'setup', 'Production delivery approved by operator');
  oceFlushAll_();
  return 'Production approved. Set DELIVERY_MODE=PRODUCTION and SEND_ENABLED=TRUE in SETTINGS to send.';
}

function oceRevokeProduction() {
  PropertiesService.getScriptProperties().deleteProperty('OCE_PRODUCTION_APPROVED');
  oceSetSetting_('SEND_ENABLED', 'FALSE');
  return 'Production revoked and sending disabled.';
}

/** Quick self-test of the live configuration (no e-mail is sent). */
function oceHealthCheck() {
  oceEnsureSchema_();
  var checks = [];
  var add = function (name, ok, detail) { checks.push({ check: name, ok: !!ok, detail: detail || '' }); };
  add('Spreadsheet', !!oceDb_(), oceDb_().getUrl());
  add('API key', !!oceSecret_('OCE_API_KEY'));
  add('Signing secret', !!oceSecret_('OCE_SIGNING_SECRET'));
  add('Web app URL', !!oceUnsubscribeBaseUrl_(), oceUnsubscribeBaseUrl_());
  add('Search provider key', !!oceSecret_('OCE_SEARCH_API_KEY'), 'optional; Bing RSS + catalogue used otherwise');
  add('Automation', true, JSON.stringify(oceAutomationStatus_()));
  add('Legacy triggers removed', oceAutomationStatus_().legacy_triggers === 0);
  var mode = oceSetting_('DELIVERY_MODE', 'DRY_RUN');
  add('Delivery mode', true, mode);
  add('Sender address', oceIsValidEmail_(oceSetting_('DEFAULT_FROM_EMAIL')), oceSetting_('DEFAULT_FROM_EMAIL'));
  add('Postal address', !!oceSetting_('SENDER_POSTAL_ADDRESS'));
  add('Resend key', !!oceSecret_('RESEND_API_KEY'));
  add('Test recipient', oceIsValidEmail_(oceSecret_('OCE_TEST_RECIPIENT')));
  try {
    var page = oceExtractPage_('<html><head><title>Acme Ltd | Contact</title></head><body><a href="mailto:info@acme.co.ug">Mail</a> Tel: 0772 123 456</body></html>', 'https://acme.co.ug/contact');
    add('Extractor', page.emails[0] === 'info@acme.co.ug' && page.phones[0] === '+256772123456');
  } catch (err) { add('Extractor', false, err.message); }
  console.log(JSON.stringify(checks, null, 2));
  return checks;
}

function oceSeedHolidays_() {
  var t = oceTable_('HOLIDAYS');
  if (t.count()) return;
  var year = Number(Utilities.formatDate(new Date(), OCE.TIMEZONE, 'yyyy'));
  var fixed = [['01-01', "New Year's Day"], ['01-26', 'NRM Liberation Day'], ['02-16', 'Archbishop Janani Luwum Day'], ['03-08', "International Women's Day"],
    ['05-01', 'Labour Day'], ['06-03', "Martyrs' Day"], ['06-09', 'National Heroes Day'], ['10-09', 'Independence Day'], ['12-25', 'Christmas Day'], ['12-26', 'Boxing Day']];
  var rows = [];
  [year, year + 1].forEach(function (y) {
    fixed.forEach(function (f) { rows.push({ date: y + '-' + f[0], country: 'UG', holiday: f[1], send_allowed: 'NO' }); });
  });
  t.append(rows);
}

/* ------------------------------------------------------------------ spreadsheet menu (bound projects only) */

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('OCE')
      .addItem('Set up / repair', 'oceSetup')
      .addItem('Health check', 'oceHealthCheck')
      .addSeparator()
      .addItem('Run collection now (1 min)', 'oceMenuRunWorker')
      .addItem('Run delivery now', 'oceMenuRunDelivery')
      .addSeparator()
      .addItem('Enable automation', 'oceMenuEnableAutomation')
      .addItem('Disable automation', 'oceMenuDisableAutomation')
      .addToUi();
  } catch (err) { /* standalone project: no UI */ }
}

function oceMenuRunWorker() { return oceRunWorker_({ max_seconds: 60 }); }
function oceMenuRunDelivery() { return oceRunDelivery_({}); }
function oceMenuEnableAutomation() { return oceEnsureAutomation_(); }
function oceMenuDisableAutomation() { return oceDisableAutomation_(); }
