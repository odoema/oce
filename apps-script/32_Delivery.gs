/**
 * 32_Delivery: guarded sending, providers, unsubscribe and provider webhooks.
 *
 * Modes (setting DELIVERY_MODE):
 *   DRY_RUN     render + log, queue rows become SIMULATED, nothing leaves Google.
 *   TEST        only the manual "send test" action works; it e-mails OCE_TEST_RECIPIENT.
 *   PRODUCTION  real delivery. Requires SEND_ENABLED=TRUE and Script Property OCE_PRODUCTION_APPROVED=TRUE.
 *
 * Providers (setting DELIVERY_PROVIDER):
 *   RESEND    direct Resend batch API, key in Script Property RESEND_API_KEY.
 *   ENDPOINT  your own relay: POST JSON to OCE_DELIVERY_ENDPOINT with X-OCE-Token: OCE_DELIVERY_TOKEN.
 */

var OCE_DELIVERY = {
  RESEND_BATCH_URL: 'https://api.resend.com/emails/batch',
  RESEND_MAX_BATCH: 100,
  RETRY_MINUTES: [10, 60, 360],
  MAX_ATTEMPTS: 3
};

/** Returns null when sending is allowed right now, otherwise the reason. */
function oceSendingBlockedReason_(mode) {
  if (mode === 'PRODUCTION') {
    if (!oceSettingBool_('SEND_ENABLED', false)) return 'SEND_ENABLED is FALSE';
    if (String(oceSecret_('OCE_PRODUCTION_APPROVED')).toUpperCase() !== 'TRUE') return 'Production not approved (Script Property OCE_PRODUCTION_APPROVED)';
    var provider = oceSetting_('DELIVERY_PROVIDER', 'RESEND').toUpperCase();
    if (provider === 'RESEND' && !oceSecret_('RESEND_API_KEY')) return 'RESEND_API_KEY missing';
    if (provider === 'ENDPOINT' && (!oceSecret_('OCE_DELIVERY_ENDPOINT') || !oceSecret_('OCE_DELIVERY_TOKEN'))) return 'Delivery endpoint/token missing';
  }
  var tz = oceSetting_('TIMEZONE', OCE.TIMEZONE);
  var now = new Date();
  var hour = Number(Utilities.formatDate(now, tz, 'H'));
  if (hour < oceSettingNumber_('SEND_HOUR_START', 9) || hour >= oceSettingNumber_('SEND_HOUR_END', 17)) return 'Outside sending window';
  var dow = Number(Utilities.formatDate(now, tz, 'u'));
  if (oceSettingBool_('BLOCK_WEEKENDS', true) && dow >= 6) return 'Weekend';
  if (oceSettingBool_('BLOCK_HOLIDAYS', true)) {
    var today = oceIsoDate_(now, tz);
    var holiday = oceTable_('HOLIDAYS').find(function (h) {
      var d = h.date instanceof Date ? oceIsoDate_(h.date, tz) : String(h.date).slice(0, 10);
      return d === today && String(h.send_allowed).toUpperCase() === 'NO';
    });
    if (holiday) return 'Holiday: ' + holiday.holiday;
  }
  return null;
}

function oceSentToday_() {
  var tz = oceSetting_('TIMEZONE', OCE.TIMEZONE);
  var today = oceIsoDate_(new Date(), tz);
  var byCampaign = {};
  var total = 0;
  oceTable_('SEND_LOG').all().forEach(function (r) {
    if (String(r.event) !== 'SENT') return;
    var d = oceToDate_(r.timestamp);
    if (!d || oceIsoDate_(d, tz) !== today) return;
    total++;
    byCampaign[r.campaign_id] = (byCampaign[r.campaign_id] || 0) + 1;
  });
  return { total: total, byCampaign: byCampaign };
}

/**
 * Sends (or simulates) the next batch for ACTIVE campaigns. Called by oceTick and the API.
 */
function oceRunDelivery_(opts) {
  opts = opts || {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: true, skipped: 'Another delivery run is active' };
  try {
    oceResetTables_();
    var mode = oceSetting_('DELIVERY_MODE', 'DRY_RUN').toUpperCase();
    if (mode === 'TEST') return { ok: true, mode: mode, skipped: 'TEST mode only sends manual test messages' };
    var blocked = oceSendingBlockedReason_(mode);
    if (blocked && !(mode === 'DRY_RUN' && opts.force)) return { ok: true, mode: mode, skipped: blocked };
    var campaigns = oceTable_('CAMPAIGNS').filter(function (c) {
      if (String(c.status).toUpperCase() !== 'ACTIVE') return false;
      if (opts.campaign_id && c.campaign_id !== opts.campaign_id) return false;
      var now = new Date(), s = oceToDate_(c.start_at), e = oceToDate_(c.end_at);
      return (!s || s <= now) && (!e || e > now);
    });
    var sent = oceSentToday_();
    var globalLeft = Math.max(0, oceSettingNumber_('DAILY_SEND_LIMIT', 100) - sent.total);
    var batchSize = oceClamp_(oceSettingNumber_('SEND_BATCH_SIZE', 50), 1, OCE_DELIVERY.RESEND_MAX_BATCH, 50);
    var summary = { ok: true, mode: mode, campaigns: [], sent: 0, simulated: 0, failed: 0, skipped: 0 };
    campaigns.forEach(function (c) {
      var capLeft = Number(c.daily_cap) > 0 ? Math.max(0, Number(c.daily_cap) - (sent.byCampaign[c.campaign_id] || 0)) : Infinity;
      var allowance = mode === 'DRY_RUN' ? batchSize : Math.min(batchSize, globalLeft, capLeft);
      if (allowance <= 0) { summary.campaigns.push({ campaign_id: c.campaign_id, skipped: 'Daily limit reached' }); return; }
      var r = oceDeliverCampaignBatch_(c, mode, allowance);
      if (mode !== 'DRY_RUN') globalLeft -= r.sent;
      summary.sent += r.sent; summary.simulated += r.simulated; summary.failed += r.failed; summary.skipped += r.skipped;
      summary.campaigns.push(r);
    });
    oceFlushAll_();
    if (summary.sent || summary.failed || summary.simulated) oceLog_('INFO', 'delivery', mode + ' run', summary);
    oceFlushAll_();
    return summary;
  } finally {
    lock.releaseLock();
  }
}

function oceDeliverCampaignBatch_(campaign, mode, allowance) {
  var queue = oceTable_('SEND_QUEUE');
  var contacts = oceTable_('CONTACTS');
  var now = new Date();
  var result = { campaign_id: campaign.campaign_id, sent: 0, simulated: 0, failed: 0, skipped: 0 };
  var problems = mode === 'PRODUCTION' ? oceCampaignProblems_(campaign) : [];
  if (problems.length) {
    oceTable_('CAMPAIGNS').update(campaign, { status: 'PAUSED', notes: 'Auto-paused: ' + problems.join(' ') });
    result.error = problems.join(' ');
    return result;
  }
  var pending = queue.filter(function (r) {
    if (String(r.campaign_id) !== String(campaign.campaign_id) || String(r.status) !== 'PENDING') return false;
    var next = oceToDate_(r.next_attempt_at);
    return !next || next <= now;
  }).slice(0, allowance);

  var messages = [];
  pending.forEach(function (row) {
    var contact = contacts.get('contact_id', row.contact_id);
    var el = oceContactEligibility_(contact);
    if (!el.ok) {
      queue.update(row, { status: el.reason === 'SUPPRESSED' ? 'SUPPRESSED' : 'SKIPPED', last_error: el.reason });
      result.skipped++;
      return;
    }
    messages.push({ row: row, contact: contact, msg: oceRenderMessage_(campaign, contact) });
  });

  if (mode === 'DRY_RUN') {
    messages.forEach(function (m) {
      queue.update(m.row, { status: 'SIMULATED', sent_at: now, last_error: '' });
      oceTable_('SEND_LOG').append([{ timestamp: now, campaign_id: campaign.campaign_id, contact_id: m.contact.contact_id, email: m.msg.to, event: 'SIMULATED', detail: m.msg.subject }]);
      result.simulated++;
    });
  } else if (messages.length) {
    var outcomes = oceProviderSend_(messages.map(function (m) { return m.msg; }), campaign, messages.map(function (m) { return m.row.send_id; }));
    messages.forEach(function (m, i) {
      var o = outcomes[i] || { ok: false, retry: true, error: 'No provider result' };
      var attempts = Number(m.row.attempt_count || 0) + 1;
      if (o.ok) {
        queue.update(m.row, { status: 'SENT', sent_at: now, provider_message_id: o.id || '', attempt_count: attempts, last_error: '' });
        contacts.update(m.contact, { last_sent_at: now, send_count: Number(m.contact.send_count || 0) + 1 });
        oceTable_('SEND_LOG').append([{ timestamp: now, campaign_id: campaign.campaign_id, contact_id: m.contact.contact_id, email: m.msg.to, event: 'SENT', provider_message_id: o.id || '', detail: m.msg.subject }]);
        result.sent++;
      } else {
        var final = !o.retry || attempts >= OCE_DELIVERY.MAX_ATTEMPTS;
        queue.update(m.row, final
          ? { status: 'FAILED', attempt_count: attempts, last_error: oceClean_(o.error, 500) }
          : { status: 'PENDING', attempt_count: attempts, last_error: oceClean_(o.error, 500), next_attempt_at: new Date(now.getTime() + OCE_DELIVERY.RETRY_MINUTES[Math.min(attempts - 1, 2)] * 60000) });
        oceTable_('SEND_LOG').append([{ timestamp: now, campaign_id: campaign.campaign_id, contact_id: m.contact.contact_id, email: m.msg.to, event: final ? 'FAILED' : 'RETRY', detail: oceClean_(o.error, 500) }]);
        if (final) result.failed++;
      }
    });
  }

  var counts = { pending: 0, sent: 0, failed: 0, suppressed: 0, simulated: 0 };
  queue.all().forEach(function (r) {
    if (String(r.campaign_id) !== String(campaign.campaign_id)) return;
    var s = String(r.status).toLowerCase();
    if (counts[s] !== undefined) counts[s]++;
  });
  var patch = { last_run_at: now, sent_count: counts.sent + counts.simulated, failed_count: counts.failed, suppressed_count: counts.suppressed };
  if (!counts.pending) patch.status = 'COMPLETED';
  oceTable_('CAMPAIGNS').update(campaign, patch);
  return result;
}

/**
 * @param {Object[]} msgs rendered messages
 * @param {Object} campaign
 * @param {string[]} keys idempotency keys (send_id per message)
 * @return {Object[]} [{ok, id, error, retry}] aligned with msgs
 */
function oceProviderSend_(msgs, campaign, keys) {
  var provider = oceSetting_('DELIVERY_PROVIDER', 'RESEND').toUpperCase();
  return provider === 'ENDPOINT' ? oceSendViaEndpoint_(msgs, campaign, keys) : oceSendViaResend_(msgs, campaign, keys);
}

function oceSendViaResend_(msgs, campaign, keys) {
  var key = oceSecret_('RESEND_API_KEY');
  if (!key) return msgs.map(function () { return { ok: false, retry: false, error: 'RESEND_API_KEY missing' }; });
  var out = [];
  for (var start = 0; start < msgs.length; start += OCE_DELIVERY.RESEND_MAX_BATCH) {
    var chunk = msgs.slice(start, start + OCE_DELIVERY.RESEND_MAX_BATCH);
    var chunkKeys = keys.slice(start, start + OCE_DELIVERY.RESEND_MAX_BATCH);
    var payload = chunk.map(function (m) {
      var e = { from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, headers: m.headers,
        tags: [{ name: 'campaign', value: String(campaign.campaign_id || 'test').replace(/[^A-Za-z0-9_-]/g, '_') }] };
      if (m.reply_to) e.reply_to = m.reply_to;
      return e;
    });
    var res;
    try {
      res = UrlFetchApp.fetch(OCE_DELIVERY.RESEND_BATCH_URL, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + key, 'Idempotency-Key': 'oce-' + oceSha256Hex_(chunkKeys.join(',')).slice(0, 48) },
        payload: JSON.stringify(payload)
      });
    } catch (err) {
      chunk.forEach(function () { out.push({ ok: false, retry: true, error: 'Network error: ' + err.message }); });
      continue;
    }
    var code = res.getResponseCode();
    var body = oceParseJson_(res.getContentText(), {});
    if (code >= 200 && code < 300 && body && Array.isArray(body.data)) {
      chunk.forEach(function (m, i) { var d = body.data[i]; out.push(d && d.id ? { ok: true, id: d.id } : { ok: false, retry: true, error: 'Missing message id' }); });
    } else {
      var msg = 'Resend HTTP ' + code + ': ' + String((body && (body.message || body.name)) || res.getContentText()).slice(0, 300);
      var retry = code === 429 || code >= 500;
      chunk.forEach(function () { out.push({ ok: false, retry: retry, error: msg }); });
      if (code === 429) Utilities.sleep(1500);
    }
    if (start + OCE_DELIVERY.RESEND_MAX_BATCH < msgs.length) Utilities.sleep(600); // stay under 2 requests/second
  }
  return out;
}

function oceSendViaEndpoint_(msgs, campaign, keys) {
  var endpoint = oceSecret_('OCE_DELIVERY_ENDPOINT');
  var token = oceSecret_('OCE_DELIVERY_TOKEN');
  if (!endpoint || !token) return msgs.map(function () { return { ok: false, retry: false, error: 'Delivery endpoint/token missing' }; });
  var res;
  try {
    res = UrlFetchApp.fetch(endpoint, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'X-OCE-Token': token, 'X-OCE-Version': OCE.VERSION },
      payload: JSON.stringify({ version: OCE.VERSION, campaign_id: campaign.campaign_id, messages: msgs.map(function (m, i) {
        return { idempotency_key: keys[i], from: m.from, to: m.to, reply_to: m.reply_to, subject: m.subject, html: m.html, text: m.text, headers: m.headers };
      }) })
    });
  } catch (err) {
    return msgs.map(function () { return { ok: false, retry: true, error: 'Network error: ' + err.message }; });
  }
  var code = res.getResponseCode();
  var data = oceParseJson_(res.getContentText(), null);
  if (code < 200 || code >= 300 || !data || !Array.isArray(data.results)) {
    return msgs.map(function () { return { ok: false, retry: code === 429 || code >= 500, error: 'Endpoint HTTP ' + code }; });
  }
  var byKey = {};
  data.results.forEach(function (r) { byKey[r.idempotency_key] = r; });
  return keys.map(function (k) {
    var r = byKey[k];
    if (!r) return { ok: false, retry: true, error: 'No result for message' };
    var status = String(r.result || r.status || '').toUpperCase();
    return status === 'SENT' || status === 'ACCEPTED' ? { ok: true, id: r.provider_message_id || r.id || '' } : { ok: false, retry: status === 'RETRY', error: r.message || status };
  });
}

/** Sends up to 3 rendered samples to OCE_TEST_RECIPIENT. Works in TEST and PRODUCTION modes. Does not touch the queue. */
function oceSendTest_(campaignId) {
  var mode = oceSetting_('DELIVERY_MODE', 'DRY_RUN').toUpperCase();
  if (mode === 'DRY_RUN') throw new Error('Set DELIVERY_MODE to TEST to send test e-mails (DRY_RUN never sends).');
  var recipient = oceEmailNormalize_(oceSecret_('OCE_TEST_RECIPIENT'));
  if (!oceIsValidEmail_(recipient)) throw new Error('Set Script Property OCE_TEST_RECIPIENT to your own address.');
  var c = oceTable_('CAMPAIGNS').get('campaign_id', campaignId);
  if (!c) throw new Error('Campaign not found');
  var problems = oceCampaignProblems_(c).filter(function (p) { return !/Web app URL/.test(p); });
  if (problems.length) throw new Error(problems.join(' '));
  var samples = oceAudience_(c.segment_id).slice(0, 3);
  if (!samples.length) samples = [{ contact_id: 'TEST', email: recipient, first_name: 'Test', organization: 'Test Organisation' }];
  var msgs = samples.map(function (ct) {
    var m = oceRenderMessage_(c, ct);
    m.subject = '[TEST → ' + ct.email + '] ' + m.subject;
    m.to = recipient;
    return m;
  });
  var outcomes = oceProviderSend_(msgs, c, msgs.map(function (m, i) { return 'test-' + campaignId + '-' + Date.now() + '-' + i; }));
  var now = new Date();
  outcomes.forEach(function (o, i) {
    oceTable_('SEND_LOG').append([{ timestamp: now, campaign_id: campaignId, contact_id: samples[i].contact_id, email: recipient, event: o.ok ? 'TEST' : 'TEST_FAILED', provider_message_id: o.id || '', detail: o.ok ? msgs[i].subject : o.error }]);
  });
  oceFlushAll_();
  return { recipient: recipient, sent: outcomes.filter(function (o) { return o.ok; }).length, failed: outcomes.filter(function (o) { return !o.ok; }).map(function (o) { return o.error; }) };
}

/* ------------------------------------------------------------------ unsubscribe + webhooks */

function oceHandleUnsubscribe_(token) {
  var data = oceVerifyUnsubscribeToken_(token);
  if (!data || !oceIsValidEmail_(data.email)) return { ok: false, error: 'This unsubscribe link is invalid or has been altered.' };
  oceSuppress_(data.email, 'UNSUBSCRIBED', data.campaign_id ? 'campaign:' + data.campaign_id : 'link');
  oceTable_('SEND_LOG').append([{ timestamp: new Date(), campaign_id: data.campaign_id, email: data.email, event: 'UNSUBSCRIBED', detail: 'one-click link' }]);
  oceFlushAll_();
  return { ok: true, email: data.email };
}

/**
 * Resend webhook receiver. Configure the webhook URL in Resend as:
 *   <web app URL>?action=webhook&provider=resend&key=<OCE_WEBHOOK_KEY>
 */
function oceHandleResendWebhook_(event) {
  var type = String(event && event.type || '');
  var data = (event && event.data) || {};
  var to = [].concat(data.to || []).map(oceEmailNormalize_);
  var messageId = String(data.email_id || data.id || '');
  var map = { 'email.delivered': 'DELIVERED', 'email.bounced': 'BOUNCED', 'email.complained': 'COMPLAINED', 'email.opened': 'OPENED', 'email.clicked': 'CLICKED', 'email.delivery_delayed': 'DELAYED', 'email.failed': 'FAILED' };
  var ev = map[type];
  if (!ev) return { ok: true, ignored: type };
  var queueRow = messageId ? oceTable_('SEND_QUEUE').get('provider_message_id', messageId) : null;
  to.forEach(function (email) {
    oceTable_('SEND_LOG').append([{ timestamp: new Date(), campaign_id: queueRow ? queueRow.campaign_id : '', contact_id: queueRow ? queueRow.contact_id : '', email: email, event: ev, provider_message_id: messageId, detail: oceClean_(oceSafeJson_(data.bounce || data.click || ''), 500) }]);
    if (ev === 'BOUNCED') {
      var bounceType = String((data.bounce && (data.bounce.type || data.bounce.subType)) || '').toLowerCase();
      if (!/transient|soft|temporary/.test(bounceType)) oceSuppress_(email, 'HARD_BOUNCE', 'resend');
    }
    if (ev === 'COMPLAINED') oceSuppress_(email, 'COMPLAINT', 'resend');
  });
  if (queueRow && (ev === 'BOUNCED' || ev === 'FAILED')) oceTable_('SEND_QUEUE').update(queueRow, { last_error: ev });
  oceFlushAll_();
  return { ok: true, event: ev };
}
