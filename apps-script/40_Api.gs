/**
 * 40_Api: the web app gateway used by the dashboard.
 *
 * Authentication
 *   - Public: health, unsubscribe (signed token).
 *   - Webhook: requires ?key=<OCE_WEBHOOK_KEY>.
 *   - Everything else requires the operator API key (Script Property OCE_API_KEY) as `key`.
 * Transport
 *   - GET  ?action=...&key=...&<params>              (reads)
 *   - POST text/plain body {"action":..., "key":..., ...}  (writes; text/plain avoids CORS preflight)
 * Every response is JSON: {ok:true, data} or {ok:false, error}.
 */

var OCE_API_READ = {
  'dashboard': function (p) { return oceDashboard_(); },
  'missions.list': function (p) { return oceListMissions_(p.limit); },
  'missions.get': function (p) { return oceGetMission_(oceRequire_(p, 'mission_id')); },
  'queue.page': function (p) { return oceQueuePage_(p); },
  'candidates.page': function (p) { return oceCandidatesPage_(p); },
  'contacts.page': function (p) { return oceContactsPage_(p); },
  'campaigns.list': function (p) { return oceListCampaigns_(); },
  'campaigns.preview': function (p) { return ocePreviewCampaign_(oceRequire_(p, 'campaign_id')); },
  'segments.list': function (p) { return oceListSegments_(); },
  'settings.get': function (p) { return ocePublicSettings_(); },
  'automation.status': function (p) { return oceAutomationStatus_(); },
  'discover.preview': function (p) { return oceDiscover_(oceRequire_(p, 'objective'), p.limit); },
  'scan.url': function (p) { return oceScanUrl_(oceRequire_(p, 'url')); },
  'events.recent': function (p) { return oceRecentEvents_(p.limit); },
  'export.candidates': function (p) { return oceExportCandidatesCsv_(p); }
};

var OCE_API_WRITE = {
  'missions.create': function (p) { return oceCreateMission_(oceRequire_(p, 'objective'), { max_pages: p.max_pages, max_depth: p.max_depth, same_site: p.same_site === undefined ? undefined : String(p.same_site) !== 'false', seeds: oceList_(p.seeds), skip_discovery: String(p.skip_discovery) === 'true' }); },
  'missions.pause': function (p) { return oceSetMissionStatus_(oceRequire_(p, 'mission_id'), 'PAUSED'); },
  'missions.resume': function (p) { return oceSetMissionStatus_(oceRequire_(p, 'mission_id'), 'RUNNING'); },
  'missions.cancel': function (p) { return oceSetMissionStatus_(oceRequire_(p, 'mission_id'), 'CANCELLED'); },
  'worker.run': function (p) { return oceRunWorker_({ max_seconds: oceClamp_(p.max_seconds, 10, 120, 60), mission_id: p.mission_id || '' }); },
  'candidates.review': function (p) { return oceReviewCandidates_(oceList_(p.ids), oceRequire_(p, 'decision'), { lawful_basis: p.lawful_basis, consent_status: p.consent_status, consent_source: p.consent_source, reviewer: p.reviewer, notes: p.notes, tags: p.tags }); },
  'documents.import': function (p) { return oceImportPdfPiece_(p); },
  'contacts.import': function (p) { return oceImportCsv_(oceRequire_(p, 'csv'), { source: p.source, tags: p.tags, lawful_basis: p.lawful_basis }); },
  'contacts.update': function (p) { return oceUpdateContacts_(oceList_(p.ids), p.patch || {}); },
  'contacts.suppress': function (p) { oceList_(p.emails).forEach(function (e) { oceSuppress_(e, p.reason || 'MANUAL', 'dashboard'); }); oceFlushAll_(); return { suppressed: oceList_(p.emails).length }; },
  'segments.save': function (p) { return oceSaveSegment_(p.segment || p); },
  'campaigns.save': function (p) { return oceSaveCampaign_(p.campaign || p); },
  'campaigns.queue': function (p) { return oceQueueCampaign_(oceRequire_(p, 'campaign_id')); },
  'campaigns.status': function (p) { return oceSetCampaignStatus_(oceRequire_(p, 'campaign_id'), oceRequire_(p, 'status')); },
  'campaigns.send_test': function (p) { return oceSendTest_(oceRequire_(p, 'campaign_id')); },
  'delivery.run': function (p) { return oceRunDelivery_({ campaign_id: p.campaign_id, force: String(p.force) === 'true' }); },
  'settings.set': function (p) { return oceApplySettings_(p.settings || {}); },
  'automation.enable': function (p) { return oceEnsureAutomation_(); },
  'automation.disable': function (p) { return oceDisableAutomation_(); }
};

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = String(p.action || '').trim();
  if (action === 'unsubscribe') return oceUnsubscribePage_(p.t);
  if (!action || action === 'health') return oceJsonOut_({ ok: true, data: { service: OCE.NAME, version: OCE.VERSION, time: new Date().toISOString() } });
  return oceDispatch_(action, p, false);
}

function doPost(e) {
  var p = (e && e.parameter) || {};
  var body = {};
  var raw = e && e.postData && e.postData.contents;
  if (raw) body = oceParseJson_(raw, null) || {};
  var action = String(p.action || body.action || '').trim();
  // RFC 8058 one-click unsubscribe: mailbox providers POST to the List-Unsubscribe URL.
  if (action === 'unsubscribe') return oceJsonOut_(oceHandleUnsubscribe_(p.t || body.t));
  if (action === 'webhook') {
    if (!oceSafeEqual_(p.key, oceSecret_('OCE_WEBHOOK_KEY'))) return oceJsonOut_({ ok: false, error: 'Unauthorized' });
    if (String(p.provider || 'resend').toLowerCase() === 'resend') return oceJsonOut_(oceHandleResendWebhook_(body));
    return oceJsonOut_({ ok: false, error: 'Unknown provider' });
  }
  var params = {};
  Object.keys(p).forEach(function (k) { params[k] = p[k]; });
  Object.keys(body).forEach(function (k) { params[k] = body[k]; });
  return oceDispatch_(action, params, true);
}

function oceDispatch_(action, params, isPost) {
  var started = Date.now();
  try {
    var expected = oceSecret_('OCE_API_KEY');
    if (!expected) return oceJsonOut_({ ok: false, error: 'OCE is not set up yet. Run oceSetup() from the Apps Script editor.' });
    if (!oceSafeEqual_(params.key, expected)) {
      Utilities.sleep(400); // slow down guessing
      return oceJsonOut_({ ok: false, error: 'Unauthorized: invalid or missing API key.' });
    }
    if (!oceRateLimit_(String(params.key).slice(0, 12), isPost ? 60 : 240)) return oceJsonOut_({ ok: false, error: 'Rate limit exceeded. Try again in a minute.' });
    var handler = OCE_API_READ[action] || (isPost ? OCE_API_WRITE[action] : null);
    if (!handler && OCE_API_WRITE[action]) return oceJsonOut_({ ok: false, error: 'Use POST for ' + action });
    if (!handler) return oceJsonOut_({ ok: false, error: 'Unknown action: ' + action });
    var data = handler(params);
    oceFlushAll_();
    return oceJsonOut_({ ok: true, data: data, ms: Date.now() - started });
  } catch (err) {
    try { oceLog_('WARN', 'api', action + ': ' + String(err && err.message || err)); oceFlushAll_(); } catch (e2) { /* ignore */ }
    return oceJsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}

function oceJsonOut_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function oceRequire_(p, name) {
  var v = p[name];
  if (v === undefined || v === null || String(v).trim() === '') throw new Error('Missing parameter: ' + name);
  return typeof v === 'string' ? v.trim() : v;
}

function oceList_(v) {
  if (Array.isArray(v)) return v.map(String).map(function (s) { return s.trim(); }).filter(Boolean);
  return String(v || '').split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function oceRateLimit_(bucket, perMinute) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'rl:' + bucket + ':' + Math.floor(Date.now() / 60000);
    var n = Number(cache.get(key) || 0) + 1;
    cache.put(key, String(n), 120);
    return n <= perMinute;
  } catch (err) { return true; }
}

function oceUnsubscribePage_(token) {
  var r = oceHandleUnsubscribe_(token);
  var title = r.ok ? 'You have been unsubscribed' : 'Link not valid';
  var body = r.ok
    ? '<p><strong>' + oceEscapeHtml_(r.email) + '</strong> will not receive further marketing e-mails from us.</p><p>If this was a mistake, reply to any of our messages and we will help.</p>'
    : '<p>' + oceEscapeHtml_(r.error) + '</p><p>Please reply to the e-mail you received and ask to be removed; we will do it manually.</p>';
  return HtmlService.createHtmlOutput('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title></head>' +
    '<body style="font-family:Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#111827;line-height:1.6">' +
    '<h1 style="font-size:22px">' + title + '</h1>' + body + '</body></html>').setTitle(title);
}

/* ------------------------------------------------------------------ dashboard helpers */

function oceDashboard_() {
  var q = oceQueueStats_('');
  var candidates = { total: 0, pending: 0, low_quality: 0, imported: 0, rejected: 0, with_email: 0 };
  oceTable_('CANDIDATES').all().forEach(function (c) {
    candidates.total++;
    if (c.email) candidates.with_email++;
    var s = String(c.review_status).toLowerCase();
    if (candidates[s] !== undefined) candidates[s]++;
  });
  var contacts = oceTable_('CONTACTS').all();
  var mode = oceSetting_('DELIVERY_MODE', 'DRY_RUN').toUpperCase();
  var sent = oceSentToday_();
  return {
    version: OCE.VERSION,
    spreadsheet_url: oceDb_().getUrl(),
    missions: { total: oceTable_('MISSIONS').count(), running: Object.keys(oceRunningMissionIds_()).length },
    queue: q,
    candidates: candidates,
    contacts: { total: contacts.length, eligible: contacts.filter(function (c) { return oceContactEligibility_(c).ok; }).length, suppressed: oceTable_('SUPPRESSION').count() },
    campaigns: { total: oceTable_('CAMPAIGNS').count(), active: oceTable_('CAMPAIGNS').count(function (c) { return String(c.status).toUpperCase() === 'ACTIVE'; }) },
    delivery: { mode: mode, provider: oceSetting_('DELIVERY_PROVIDER', 'RESEND'), send_enabled: oceSettingBool_('SEND_ENABLED', false), sent_today: sent.total,
      daily_limit: oceSettingNumber_('DAILY_SEND_LIMIT', 100), blocked_reason: oceSendingBlockedReason_(mode === 'DRY_RUN' ? 'DRY_RUN' : 'PRODUCTION'),
      production_approved: String(oceSecret_('OCE_PRODUCTION_APPROVED')).toUpperCase() === 'TRUE' },
    automation: oceAutomationStatus_(),
    search_configured: !!oceSecret_('OCE_SEARCH_API_KEY'),
    web_app_url: oceUnsubscribeBaseUrl_()
  };
}

function ocePublicSettings_() {
  var s = oceSettings_();
  var editable = oceEditableSettingKeys_();
  return {
    settings: OCE_DEFAULT_SETTINGS.map(function (r) { return { key: r[0], value: s[r[0]], description: r[2], editable: editable.indexOf(r[0]) >= 0 }; }),
    secrets: OCE_SECRET_KEYS.map(function (k) { return { key: k, configured: !!oceSecret_(k) }; })
  };
}

function oceApplySettings_(settings) {
  var editable = oceEditableSettingKeys_();
  var changed = [];
  Object.keys(settings).forEach(function (k) {
    if (editable.indexOf(k) < 0) throw new Error('Setting not editable from the dashboard: ' + k);
    var v = String(settings[k]).trim();
    if (k === 'DELIVERY_MODE' && ['DRY_RUN', 'TEST', 'PRODUCTION'].indexOf(v.toUpperCase()) < 0) throw new Error('DELIVERY_MODE must be DRY_RUN, TEST or PRODUCTION');
    if (/^(DEFAULT_FROM_EMAIL|DEFAULT_REPLY_TO)$/.test(k) && v && !oceIsValidEmail_(v)) throw new Error(k + ' must be a valid e-mail address');
    oceSetSetting_(k, /_MODE$|_PROVIDER$|^(SEND_ENABLED|CRAWL_ENABLED|CRAWL_SAME_SITE|RESPECT_ROBOTS|BLOCK_WEEKENDS|BLOCK_HOLIDAYS|ALLOW_LEGITIMATE_INTEREST)$/.test(k) ? v.toUpperCase() : v);
    changed.push(k);
  });
  oceLog_('INFO', 'settings', 'Settings changed: ' + changed.join(', '));
  oceFlushAll_();
  return ocePublicSettings_();
}

function oceRecentEvents_(limit) {
  var rows = oceTable_('EVENTS').all();
  return rows.slice(-oceClamp_(limit, 1, 200, 50)).reverse().map(function (r) { return { timestamp: r.timestamp, level: r.level, component: r.component, message: r.message }; });
}

function oceExportCandidatesCsv_(p) {
  var page = oceCandidatesPage_({ status: p.status || 'ALL', q: p.q, mission_id: p.mission_id, page_size: 200, page: 1 });
  var all = [];
  for (var i = 1; i <= page.total_pages; i++) all = all.concat(oceCandidatesPage_({ status: p.status || 'ALL', q: p.q, mission_id: p.mission_id, page_size: 200, page: i }).items);
  var cols = ['email', 'phone', 'person_name', 'role', 'organization', 'website', 'address', 'location', 'country', 'category', 'confidence', 'review_status', 'lawful_basis', 'consent_status'];
  var esc = function (v) { var s = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return { filename: 'oce-candidates.csv', csv: [cols.join(',')].concat(all.map(function (c) { return cols.map(function (k) { return esc(c[k]); }).join(','); })).join('\n'), rows: all.length };
}
