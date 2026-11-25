/**
 * 31_Campaigns: segments, campaign definitions, audience queue and message rendering.
 * Campaign status: DRAFT -> ACTIVE -> COMPLETED ; PAUSED at any time.
 */

var OCE_SEGMENT_FIELDS = ['email', 'first_name', 'last_name', 'phone', 'organization', 'role', 'country', 'location', 'category', 'source', 'tags', 'lawful_basis', 'consent_status'];
var OCE_SEGMENT_OPS = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'is_empty', 'not_empty'];

/** Rows sharing a segment_id are combined with AND. */
function oceSegmentRules_(segmentId) {
  if (!segmentId) return [];
  var rules = oceTable_('SEGMENTS').filter(function (r) {
    return String(r.segment_id) === String(segmentId) && String(r.active || 'TRUE').toUpperCase() !== 'FALSE';
  }).map(function (r) {
    var op = String(r.operator || 'equals').toLowerCase().replace(/^=$/, 'equals');
    return { field: String(r.field || '').trim(), operator: op, value: String(r.value === null ? '' : r.value) };
  });
  if (!rules.length) throw new Error('Segment ' + segmentId + ' has no active rules.');
  return rules;
}

function oceMatchesSegment_(contact, rules) {
  return rules.every(function (rule) {
    var actual = String(contact[rule.field] === undefined || contact[rule.field] === null ? '' : contact[rule.field]).toLowerCase().trim();
    var v = String(rule.value).toLowerCase().trim();
    switch (rule.operator) {
      case 'equals': return actual === v;
      case 'not_equals': return actual !== v;
      case 'contains': return actual.indexOf(v) >= 0;
      case 'not_contains': return actual.indexOf(v) < 0;
      case 'starts_with': return actual.indexOf(v) === 0;
      case 'ends_with': return v.length <= actual.length && actual.slice(-v.length) === v;
      case 'in': return v.split(/\s*[,;|]\s*/).indexOf(actual) >= 0;
      case 'is_empty': return !actual;
      case 'not_empty': return !!actual;
      default: return false;
    }
  });
}

function oceSaveSegment_(segment) {
  var id = oceStr_(segment.segment_id) || ('SEG-' + oceUuid_().slice(0, 8).toUpperCase());
  var rules = segment.rules || [];
  if (!rules.length) throw new Error('A segment needs at least one rule.');
  rules.forEach(function (r) {
    if (OCE_SEGMENT_FIELDS.indexOf(r.field) < 0) throw new Error('Unsupported segment field: ' + r.field);
    if (OCE_SEGMENT_OPS.indexOf(String(r.operator).toLowerCase()) < 0) throw new Error('Unsupported operator: ' + r.operator);
  });
  var table = oceTable_('SEGMENTS');
  table.all().forEach(function (r) { if (String(r.segment_id) === id) table.update(r, { active: 'FALSE', notes: 'superseded ' + new Date().toISOString() }); });
  table.append(rules.map(function (r) {
    return { segment_id: id, segment_name: oceClean_(segment.segment_name || id, 120), field: r.field, operator: String(r.operator).toLowerCase(), value: r.value || '', active: 'TRUE' };
  }));
  oceFlushAll_();
  return { segment_id: id, rules: rules.length, audience: oceAudience_(id).length };
}

function oceListSegments_() {
  var by = {};
  oceTable_('SEGMENTS').all().forEach(function (r) {
    if (String(r.active || 'TRUE').toUpperCase() === 'FALSE') return;
    var id = String(r.segment_id);
    if (!by[id]) by[id] = { segment_id: id, segment_name: r.segment_name, rules: [] };
    by[id].rules.push({ field: r.field, operator: r.operator, value: r.value });
  });
  return Object.keys(by).map(function (k) { return by[k]; });
}

/** Eligible contacts for a segment (empty segment = all eligible contacts). */
function oceAudience_(segmentId) {
  var rules = segmentId ? oceSegmentRules_(segmentId) : [];
  return oceTable_('CONTACTS').filter(function (c) {
    return oceContactEligibility_(c).ok && (!rules.length || oceMatchesSegment_(c, rules));
  });
}

function oceSaveCampaign_(input) {
  var table = oceTable_('CAMPAIGNS');
  var now = new Date();
  var existing = input.campaign_id ? table.get('campaign_id', input.campaign_id) : null;
  if (existing && /^(ACTIVE)$/i.test(String(existing.status)) && (input.subject !== undefined || input.body_html !== undefined)) {
    throw new Error('Pause the campaign before editing its content.');
  }
  var fields = {};
  ['name', 'segment_id', 'subject', 'preheader', 'body_html', 'body_text', 'from_name', 'from_email', 'reply_to', 'start_at', 'end_at', 'daily_cap', 'notes'].forEach(function (k) {
    if (input[k] !== undefined) fields[k] = k === 'body_html' || k === 'body_text' ? String(input[k]) : oceClean_(input[k], 500);
  });
  if (fields.from_email && !oceIsValidEmail_(fields.from_email)) throw new Error('from_email is not a valid address.');
  if (fields.reply_to && !oceIsValidEmail_(fields.reply_to)) throw new Error('reply_to is not a valid address.');
  if (fields.segment_id) oceSegmentRules_(fields.segment_id);
  if (existing) {
    fields.updated_at = now;
    table.update(existing, fields);
    oceFlushAll_();
    return oceCampaignView_(existing);
  }
  if (!fields.name) throw new Error('Campaign name is required.');
  var row = table.append([Object.assign({ campaign_id: 'CMP-' + oceUuid_().slice(0, 8).toUpperCase(), status: 'DRAFT', created_at: now, updated_at: now,
    queued_count: 0, sent_count: 0, failed_count: 0, suppressed_count: 0 }, fields)])[0];
  oceFlushAll_();
  return oceCampaignView_(row);
}

/** Validates content and settings; returns a list of blocking problems. */
function oceCampaignProblems_(c) {
  var problems = [];
  if (!oceStr_(c.subject)) problems.push('Subject is empty.');
  if (!oceStr_(c.body_html) && !oceStr_(c.body_text)) problems.push('Message body is empty.');
  var from = oceStr_(c.from_email) || oceSetting_('DEFAULT_FROM_EMAIL');
  if (!oceIsValidEmail_(from)) problems.push('No verified sender address (campaign from_email or DEFAULT_FROM_EMAIL).');
  if (!oceSetting_('SENDER_POSTAL_ADDRESS')) problems.push('SENDER_POSTAL_ADDRESS is required for marketing e-mail footers.');
  if (!oceUnsubscribeBaseUrl_()) problems.push('Web app URL unknown: deploy the web app or set PUBLIC_WEB_APP_URL so unsubscribe links work.');
  var s = oceToDate_(c.start_at), e = oceToDate_(c.end_at);
  if ((c.start_at && !s) || (c.end_at && !e)) problems.push('The start or stop date is not a valid date.');
  if (s && e && e <= s) problems.push('The stop date must be after the start date.');
  if (e && e <= new Date()) problems.push('The stop date is already in the past.');
  return problems;
}

/** Adds eligible audience members to SEND_QUEUE (idempotent per campaign + contact). */
function oceQueueCampaign_(campaignId) {
  var campaigns = oceTable_('CAMPAIGNS');
  var c = campaigns.get('campaign_id', campaignId);
  if (!c) throw new Error('Campaign not found');
  var queue = oceTable_('SEND_QUEUE');
  var already = {};
  queue.all().forEach(function (r) { if (String(r.campaign_id) === campaignId) already[String(r.contact_id)] = true; });
  var now = new Date();
  var add = oceAudience_(c.segment_id).filter(function (ct) { return !already[String(ct.contact_id)]; }).map(function (ct) {
    return { send_id: oceUuid_(), campaign_id: campaignId, contact_id: ct.contact_id, email: oceEmailNormalize_(ct.email), status: 'PENDING', queued_at: now, attempt_count: 0 };
  });
  if (add.length) queue.append(add);
  campaigns.update(c, { queued_count: Number(c.queued_count || 0) + add.length, updated_at: now });
  oceFlushAll_();
  return { campaign_id: campaignId, added: add.length, already_queued: Object.keys(already).length };
}

function oceSetCampaignStatus_(campaignId, status) {
  status = String(status || '').toUpperCase();
  if (['ACTIVE', 'PAUSED', 'DRAFT', 'COMPLETED'].indexOf(status) < 0) throw new Error('Unsupported campaign status');
  var campaigns = oceTable_('CAMPAIGNS');
  var c = campaigns.get('campaign_id', campaignId);
  if (!c) throw new Error('Campaign not found');
  if (status === 'ACTIVE') {
    var problems = oceCampaignProblems_(c);
    if (problems.length) throw new Error('Cannot activate: ' + problems.join(' '));
    var pending = oceTable_('SEND_QUEUE').count(function (r) { return String(r.campaign_id) === campaignId && String(r.status) === 'PENDING'; });
    if (!pending) oceQueueCampaign_(campaignId);
  }
  campaigns.update(c, { status: status, updated_at: new Date() });
  oceFlushAll_();
  if (status === 'ACTIVE') oceEnsureAutomation_();
  return oceCampaignView_(c);
}

function oceHasActiveCampaign_() {
  oceExpireCampaigns_();
  return !!oceTable_('CAMPAIGNS').find(function (c) { return String(c.status).toUpperCase() === 'ACTIVE'; });
}

/** Active campaigns whose stop date has passed become COMPLETED, so automation can go idle. */
function oceExpireCampaigns_() {
  var campaigns = oceTable_('CAMPAIGNS');
  var now = new Date();
  var n = 0;
  campaigns.all().forEach(function (c) {
    var e = oceToDate_(c.end_at);
    if (String(c.status).toUpperCase() === 'ACTIVE' && e && e <= now) {
      campaigns.update(c, { status: 'COMPLETED', updated_at: now, notes: oceClean_((c.notes ? c.notes + ' | ' : '') + 'Completed: stop date reached', 500) });
      n++;
    }
  });
  if (n) { oceFlushAll_(); oceLog_('INFO', 'campaigns', n + ' campaign(s) completed: stop date reached'); }
  return n;
}

/** When a campaign is (or will be) sending, in plain words, from its start/stop dates. */
function oceCampaignSchedule_(c) {
  var now = new Date(), s = oceToDate_(c.start_at), e = oceToDate_(c.end_at);
  if (s && s > now) return { state: 'SCHEDULED', starts: s.toISOString(), ends: e ? e.toISOString() : '' };
  if (e && e <= now) return { state: 'ENDED', starts: s ? s.toISOString() : '', ends: e.toISOString() };
  return { state: 'OPEN', starts: s ? s.toISOString() : '', ends: e ? e.toISOString() : '' };
}

function oceCampaignView_(c) {
  var stats = { pending: 0, sent: 0, failed: 0, suppressed: 0, simulated: 0 };
  oceTable_('SEND_QUEUE').all().forEach(function (r) {
    if (String(r.campaign_id) !== String(c.campaign_id)) return;
    var s = String(r.status).toLowerCase();
    if (stats[s] !== undefined) stats[s]++;
  });
  return { campaign_id: c.campaign_id, name: c.name, status: c.status, segment_id: c.segment_id, subject: c.subject, preheader: c.preheader,
    body_html: c.body_html, body_text: c.body_text, from_name: c.from_name, from_email: c.from_email, reply_to: c.reply_to,
    start_at: oceToDate_(c.start_at) ? oceToDate_(c.start_at).toISOString() : '', end_at: oceToDate_(c.end_at) ? oceToDate_(c.end_at).toISOString() : '', schedule: oceCampaignSchedule_(c), daily_cap: c.daily_cap, created_at: c.created_at, updated_at: c.updated_at,
    last_run_at: c.last_run_at, queue: stats, problems: oceCampaignProblems_(c) };
}

function oceListCampaigns_() {
  return oceTable_('CAMPAIGNS').all().slice().reverse().map(oceCampaignView_);
}

/* ------------------------------------------------------------------ rendering */

function oceUnsubscribeBaseUrl_() {
  var configured = oceSetting_('PUBLIC_WEB_APP_URL');
  if (configured) return configured;
  try {
    var url = ScriptApp.getService().getUrl() || '';
    // A /dev URL only works for project editors; recipients would get a broken unsubscribe link.
    return /\/exec$/.test(url) ? url : '';
  } catch (err) { return ''; }
}

function oceUnsubscribeToken_(email, campaignId) {
  var payload = oceEmailNormalize_(email) + '|' + String(campaignId || '');
  return oceB64UrlEncode_(payload) + '.' + oceHmacHex_(payload, oceSecret_('OCE_SIGNING_SECRET')).slice(0, 32);
}

function oceVerifyUnsubscribeToken_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  var payload;
  try { payload = oceB64UrlDecode_(parts[0]); } catch (err) { return null; }
  var expected = oceHmacHex_(payload, oceSecret_('OCE_SIGNING_SECRET')).slice(0, 32);
  if (!oceSafeEqual_(expected, parts[1])) return null;
  var bits = payload.split('|');
  return { email: bits[0], campaign_id: bits[1] || '' };
}

function oceUnsubscribeUrl_(email, campaignId) {
  var base = oceUnsubscribeBaseUrl_();
  return base ? base + (base.indexOf('?') >= 0 ? '&' : '?') + 'action=unsubscribe&t=' + encodeURIComponent(oceUnsubscribeToken_(email, campaignId)) : '';
}

/** Renders {{field}} and {{field|fallback}} placeholders. HTML-escapes values in HTML mode. */
function oceRenderTemplate_(template, vars, html) {
  return String(template || '').replace(/\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*))?\}\}/gi, function (_, key, fallback) {
    var v = vars[key.toLowerCase()];
    v = v === undefined || v === null || String(v).trim() === '' ? (fallback || '') : String(v);
    return html && key.toLowerCase() !== 'unsubscribe_url' ? oceEscapeHtml_(v) : v;
  });
}

function oceRenderMessage_(campaign, contact) {
  var unsub = oceUnsubscribeUrl_(contact.email, campaign.campaign_id);
  var vars = {
    first_name: contact.first_name, last_name: contact.last_name, full_name: oceClean_((contact.first_name || '') + ' ' + (contact.last_name || '')),
    organization: contact.organization, email: contact.email, role: contact.role, location: contact.location, country: contact.country,
    unsubscribe_url: unsub, sender_address: oceSetting_('SENDER_POSTAL_ADDRESS'), sender_name: campaign.from_name || oceSetting_('DEFAULT_FROM_NAME')
  };
  var subject = oceRenderTemplate_(campaign.subject, vars, false).replace(/[\r\n]+/g, ' ').slice(0, 250);
  var bodyHtml = oceRenderTemplate_(campaign.body_html || oceEscapeHtml_(campaign.body_text || '').replace(/\n/g, '<br>'), vars, true);
  var bodyText = campaign.body_text ? oceRenderTemplate_(campaign.body_text, vars, false) : oceHtmlToText_(bodyHtml);
  var addr = oceEscapeHtml_(vars.sender_address);
  if (!/\{\{\s*unsubscribe_url/i.test(String(campaign.body_html || '') + String(campaign.body_text || ''))) {
    bodyHtml += '<hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 12px"><p style="font-size:12px;color:#6b7280;line-height:1.5">' +
      'This message was sent to ' + oceEscapeHtml_(contact.email) + (vars.sender_name ? ' by ' + oceEscapeHtml_(vars.sender_name) : '') + '. ' +
      '<a href="' + oceEscapeHtml_(unsub) + '" style="color:#6b7280">Unsubscribe</a>' + (addr ? '<br>' + addr : '') + '</p>';
    bodyText += '\n\n--\nUnsubscribe: ' + unsub + (vars.sender_address ? '\n' + vars.sender_address : '');
  }
  if (campaign.preheader) {
    bodyHtml = '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + oceEscapeHtml_(oceRenderTemplate_(campaign.preheader, vars, false)) + '</div>' + bodyHtml;
  }
  var fromEmail = oceStr_(campaign.from_email) || oceSetting_('DEFAULT_FROM_EMAIL');
  var fromName = oceStr_(campaign.from_name) || oceSetting_('DEFAULT_FROM_NAME');
  return {
    from: fromName ? fromName.replace(/[<>"]/g, '') + ' <' + fromEmail + '>' : fromEmail,
    to: oceEmailNormalize_(contact.email),
    reply_to: oceStr_(campaign.reply_to) || oceSetting_('DEFAULT_REPLY_TO') || '',
    subject: subject,
    html: '<!doctype html><html><body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.55">' + bodyHtml + '</body></html>',
    text: bodyText,
    headers: unsub ? { 'List-Unsubscribe': '<' + unsub + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {},
    unsubscribe_url: unsub
  };
}

function ocePreviewCampaign_(campaignId) {
  var c = oceTable_('CAMPAIGNS').get('campaign_id', campaignId);
  if (!c) throw new Error('Campaign not found');
  var audience = oceAudience_(c.segment_id);
  var sample = audience[0] || { email: 'preview@example.org', first_name: 'Sample', last_name: 'Contact', organization: 'Example Organisation' };
  var msg = oceRenderMessage_(c, sample);
  return { audience: audience.length, sample_email: sample.email, subject: msg.subject, html: msg.html, text: msg.text, from: msg.from, problems: oceCampaignProblems_(c) };
}
