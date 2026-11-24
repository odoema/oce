/**
 * 30_Contacts: candidate de-duplication, the human review gate, contacts and imports.
 *
 * Consent model (unchanged principle from v1, now enforced end-to-end):
 *  - Collected candidates are evidence only: review_status=PENDING, consent_status=NOT_ESTABLISHED.
 *  - An operator approves a candidate and records the lawful basis (CONSENT / LEGITIMATE_INTEREST / NONE).
 *  - A contact is campaign-eligible only if ACTIVE, not suppressed, and either consent_status=YES or
 *    (lawful_basis=LEGITIMATE_INTEREST and ALLOW_LEGITIMATE_INTEREST=TRUE).
 */

var OCE_LAWFUL_BASES = ['CONSENT', 'LEGITIMATE_INTEREST', 'CONTRACT', 'NONE'];

function oceCandidateKey_(c) {
  if (c.email) return 'e:' + oceEmailNormalize_(c.email);
  if (c.phone) return 'p:' + c.phone;
  if (c.organization) return 'o:' + oceClean_(c.organization).toLowerCase() + '|' + oceSiteOf_(c.website || c.source_url || '');
  return '';
}

/**
 * Inserts or merges candidates. Returns {created, merged, touched}.
 */
function oceUpsertCandidates_(list) {
  var table = oceTable_('CANDIDATES');
  var suppressed = oceSuppressionSet_();
  var minConfidence = oceSettingNumber_('MIN_CANDIDATE_CONFIDENCE', 40);
  var now = new Date();
  var out = { created: 0, merged: 0, touched: 0 };
  (list || []).forEach(function (c) {
    var key = oceCandidateKey_(c);
    if (!key) return;
    var existing = table.get('dedupe_key', key);
    var conf = Math.round(Number(c.confidence) || 0);
    if (!existing) {
      var status = c.email && suppressed[oceEmailNormalize_(c.email)] ? 'SUPPRESSED' : (conf < minConfidence ? 'LOW_QUALITY' : 'PENDING');
      table.append([{
        candidate_id: oceUuid_(), dedupe_key: key, email: c.email || '', phone: c.phone || '', person_name: oceClean_(c.person_name, 120),
        role: oceClean_(c.role, 120), organization: oceClean_(c.organization, 200), website: c.website || '', address: oceClean_(c.address, 300),
        country: c.country || '', location: c.location || '', category: c.category || '', confidence: conf, sources_count: 1,
        source_urls: c.source_url || '', mission_ids: c.mission_id || '', first_seen_at: now, last_seen_at: now, review_status: status,
        lawful_basis: '', consent_status: 'NOT_ESTABLISHED', evidence: oceClean_(c.evidence, 600)
      }]);
      out.created++; out.touched++;
      return;
    }
    var patch = { last_seen_at: now };
    ['phone', 'person_name', 'role', 'organization', 'website', 'address', 'country', 'location'].forEach(function (f) {
      if (!oceStr_(existing[f]) && oceStr_(c[f])) patch[f] = c[f];
    });
    if ((!existing.category || existing.category === 'OTHER') && c.category && c.category !== 'OTHER') patch.category = c.category;
    var urls = oceStr_(existing.source_urls).split(/\s+/).filter(Boolean);
    if (c.source_url && urls.indexOf(c.source_url) < 0) {
      urls.push(c.source_url);
      patch.sources_count = Number(existing.sources_count || urls.length - 1) + 1;
      patch.source_urls = urls.slice(-10).join(' ');
      conf = Math.min(100, conf + 5); // corroborated by another page
    }
    var missions = oceStr_(existing.mission_ids).split(/\s+/).filter(Boolean);
    if (c.mission_id && missions.indexOf(c.mission_id) < 0) { missions.push(c.mission_id); patch.mission_ids = missions.slice(-20).join(' '); }
    if (conf > Number(existing.confidence || 0)) patch.confidence = conf;
    if (String(existing.review_status) === 'LOW_QUALITY' && Math.max(conf, Number(existing.confidence || 0)) >= minConfidence) patch.review_status = 'PENDING';
    table.update(existing, patch);
    out.merged++; out.touched++;
  });
  return out;
}

function oceSuppressionSet_() {
  var memo = oceRuntimeCache_();
  if (memo.suppression) return memo.suppression;
  var set = {};
  oceTable_('SUPPRESSION').all().forEach(function (r) { var e = oceEmailNormalize_(r.email); if (e) set[e] = r.reason || 'SUPPRESSED'; });
  memo.suppression = set;
  return set;
}

function oceSuppress_(email, reason, source) {
  email = oceEmailNormalize_(email);
  if (!oceIsValidEmail_(email)) return false;
  var set = oceSuppressionSet_();
  if (!set[email]) {
    oceTable_('SUPPRESSION').append([{ email: email, reason: reason || 'MANUAL', source: source || 'OCE', created_at: new Date() }]);
    set[email] = reason || 'MANUAL';
  }
  var statusFor = { UNSUBSCRIBED: 'UNSUBSCRIBED', HARD_BOUNCE: 'BOUNCED', COMPLAINT: 'COMPLAINED' };
  var contact = oceTable_('CONTACTS').get('email', email);
  if (contact) oceTable_('CONTACTS').update(contact, { status: statusFor[reason] || 'SUPPRESSED', updated_at: new Date() });
  var cand = oceTable_('CANDIDATES').get('dedupe_key', 'e:' + email);
  if (cand && /PENDING|LOW_QUALITY/.test(String(cand.review_status))) oceTable_('CANDIDATES').update(cand, { review_status: 'SUPPRESSED' });
  oceTable_('SEND_QUEUE').all().forEach(function (r) {
    if (oceEmailNormalize_(r.email) === email && String(r.status).toUpperCase() === 'PENDING') oceTable_('SEND_QUEUE').update(r, { status: 'SUPPRESSED', last_error: reason || 'SUPPRESSED' });
  });
  return true;
}

/**
 * @param {string[]} ids candidate_ids
 * @param {string} decision APPROVE | REJECT | SUPPRESS | RESET
 * @param {Object=} opts {lawful_basis, consent_status, consent_source, reviewer, notes, tags}
 */
function oceReviewCandidates_(ids, decision, opts) {
  opts = opts || {};
  decision = String(decision || '').toUpperCase();
  if (['APPROVE', 'REJECT', 'SUPPRESS', 'RESET'].indexOf(decision) < 0) throw new Error('Unknown decision: ' + decision);
  var basis = String(opts.lawful_basis || 'NONE').toUpperCase();
  if (OCE_LAWFUL_BASES.indexOf(basis) < 0) throw new Error('lawful_basis must be one of ' + OCE_LAWFUL_BASES.join(', '));
  var consent = String(opts.consent_status || (basis === 'CONSENT' ? 'YES' : 'UNKNOWN')).toUpperCase();
  if (['YES', 'NO', 'UNKNOWN'].indexOf(consent) < 0) throw new Error('consent_status must be YES, NO or UNKNOWN');
  if (basis === 'CONSENT' && consent === 'YES' && !oceStr_(opts.consent_source)) throw new Error('consent_source is required when recording consent (where/how it was given).');
  var table = oceTable_('CANDIDATES');
  var now = new Date();
  var result = { updated: 0, contacts_created: 0, contacts_updated: 0, without_email: 0, not_found: 0 };
  (ids || []).forEach(function (id) {
    var c = table.get('candidate_id', id);
    if (!c) { result.not_found++; return; }
    var patch = { reviewed_at: now, reviewed_by: oceClean_(opts.reviewer || 'operator', 120) };
    if (opts.notes) patch.notes = oceClean_(opts.notes, 500);
    if (decision === 'REJECT') patch.review_status = 'REJECTED';
    else if (decision === 'RESET') { patch.review_status = 'PENDING'; patch.reviewed_at = ''; }
    else if (decision === 'SUPPRESS') { patch.review_status = 'SUPPRESSED'; if (c.email) oceSuppress_(c.email, 'MANUAL', 'review'); }
    else {
      patch.lawful_basis = basis; patch.consent_status = consent;
      if (!c.email) { patch.review_status = 'APPROVED_NO_EMAIL'; result.without_email++; }
      else {
        var r = oceUpsertContactFromCandidate_(c, basis, consent, opts);
        patch.review_status = 'IMPORTED';
        patch.contact_id = r.contact.contact_id;
        if (r.created) result.contacts_created++; else result.contacts_updated++;
      }
    }
    table.update(c, patch);
    result.updated++;
  });
  oceFlushAll_();
  return result;
}

function oceUpsertContactFromCandidate_(c, basis, consent, opts) {
  var contacts = oceTable_('CONTACTS');
  var email = oceEmailNormalize_(c.email);
  var names = oceSplitName_(c.person_name);
  var suppressed = oceSuppressionSet_()[email];
  var now = new Date();
  var existing = contacts.get('email', email);
  var fields = {
    first_name: names.first, last_name: names.last, phone: c.phone, organization: c.organization, role: c.role, country: c.country,
    location: c.location, category: c.category, source: 'OCE_COLLECTION', source_url: oceStr_(c.source_urls).split(/\s+/)[0] || '', candidate_id: c.candidate_id
  };
  if (existing) {
    var patch = { updated_at: now, lawful_basis: basis, consent_status: consent };
    Object.keys(fields).forEach(function (k) { if (!oceStr_(existing[k]) && oceStr_(fields[k])) patch[k] = fields[k]; });
    if (consent === 'YES') { patch.consent_date = now; patch.consent_source = oceClean_(opts.consent_source, 200); }
    if (opts.tags) patch.tags = oceUnique_(oceStr_(existing.tags).split(/[,;]\s*/).concat(String(opts.tags).split(/[,;]\s*/))).join(', ');
    contacts.update(existing, patch);
    return { contact: existing, created: false };
  }
  var row = Object.assign({
    contact_id: oceUuid_(), email: email, lawful_basis: basis, consent_status: consent, consent_date: consent === 'YES' ? now : '',
    consent_source: consent === 'YES' ? oceClean_(opts.consent_source, 200) : '', status: suppressed ? 'SUPPRESSED' : 'ACTIVE',
    created_at: now, updated_at: now, send_count: 0, tags: oceClean_(opts.tags || '', 200)
  }, fields);
  return { contact: contacts.append([row])[0], created: true };
}

function oceSplitName_(name) {
  var parts = oceClean_(name).replace(/^(mr|mrs|ms|miss|dr|prof|eng|hon|cpa|rev)\.?\s+/i, '').split(' ').filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  return { first: parts[0], last: parts.length > 1 ? parts.slice(1).join(' ') : '' };
}

/** True when the contact may receive marketing. Returns {ok, reason}. */
function oceContactEligibility_(contact) {
  if (!contact) return { ok: false, reason: 'NO_CONTACT' };
  var email = oceEmailNormalize_(contact.email);
  if (!oceIsValidEmail_(email)) return { ok: false, reason: 'INVALID_EMAIL' };
  if (oceSuppressionSet_()[email]) return { ok: false, reason: 'SUPPRESSED' };
  if (String(contact.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') return { ok: false, reason: 'STATUS_' + String(contact.status).toUpperCase() };
  var consent = String(contact.consent_status || '').toUpperCase();
  var basis = String(contact.lawful_basis || '').toUpperCase();
  if (consent === 'NO') return { ok: false, reason: 'CONSENT_REFUSED' };
  if (consent === 'YES') return { ok: true, reason: 'CONSENT' };
  if (basis === 'LEGITIMATE_INTEREST' && oceSettingBool_('ALLOW_LEGITIMATE_INTEREST', false)) return { ok: true, reason: 'LEGITIMATE_INTEREST' };
  return { ok: false, reason: 'NO_LAWFUL_BASIS' };
}

/**
 * Imports contacts from CSV text (header row required). Columns are matched flexibly
 * (email/e-mail, first name/given name, company/organisation, consent, consent source...).
 * Rows without explicit consent are imported with consent_status=UNKNOWN and are NOT campaign-eligible.
 */
function oceImportCsv_(csvText, opts) {
  opts = opts || {};
  var rows = Utilities.parseCsv(String(csvText || ''));
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one data row.');
  var headers = rows[0].map(function (h) { return String(h).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); });
  var pick = function (o, names) { for (var i = 0; i < names.length; i++) if (oceStr_(o[names[i]])) return oceStr_(o[names[i]]); return ''; };
  var contacts = oceTable_('CONTACTS');
  var suppressed = oceSuppressionSet_();
  var now = new Date();
  var result = { rows: rows.length - 1, created: 0, updated: 0, skipped: 0, errors: [] };
  rows.slice(1).forEach(function (r, i) {
    var o = {};
    headers.forEach(function (h, j) { o[h] = r[j]; });
    var email = oceEmailNormalize_(pick(o, ['email', 'e_mail', 'email_address', 'mail']));
    if (!oceIsValidEmail_(email)) { result.skipped++; if (result.errors.length < 20) result.errors.push('Row ' + (i + 2) + ': invalid email'); return; }
    var consentRaw = pick(o, ['consent_status', 'consent', 'opt_in', 'optin', 'subscribed']).toUpperCase();
    var consent = /^(YES|Y|TRUE|1|OPTED_IN|SUBSCRIBED)$/.test(consentRaw) ? 'YES' : /^(NO|N|FALSE|0|OPTED_OUT|UNSUBSCRIBED)$/.test(consentRaw) ? 'NO' : 'UNKNOWN';
    var basis = String(pick(o, ['lawful_basis', 'legal_basis']) || opts.lawful_basis || (consent === 'YES' ? 'CONSENT' : 'NONE')).toUpperCase();
    if (OCE_LAWFUL_BASES.indexOf(basis) < 0) basis = 'NONE';
    var fields = {
      first_name: pick(o, ['first_name', 'firstname', 'given_name', 'first']), last_name: pick(o, ['last_name', 'lastname', 'surname', 'family_name', 'last']),
      phone: ocePhoneNormalize_(pick(o, ['phone', 'mobile', 'telephone', 'tel', 'phone_number'])), organization: pick(o, ['organization', 'organisation', 'company', 'employer', 'business']),
      role: pick(o, ['role', 'job_title', 'title', 'position', 'profession']), country: pick(o, ['country']), location: pick(o, ['location', 'city', 'town', 'district']),
      category: pick(o, ['category', 'industry', 'sector']), tags: pick(o, ['tags', 'tag', 'segment']) || opts.tags || '', notes: pick(o, ['notes', 'note'])
    };
    if (!fields.first_name && pick(o, ['name', 'full_name', 'contact_name'])) { var n = oceSplitName_(pick(o, ['name', 'full_name', 'contact_name'])); fields.first_name = n.first; fields.last_name = n.last; }
    var existing = contacts.get('email', email);
    var consentFields = { lawful_basis: basis, consent_status: consent, consent_date: consent === 'YES' ? (pick(o, ['consent_date', 'opt_in_date']) || now) : '', consent_source: consent === 'YES' ? (pick(o, ['consent_source', 'source']) || opts.source || 'CSV import') : '' };
    if (existing) {
      var patch = { updated_at: now };
      Object.keys(fields).forEach(function (k) { if (oceStr_(fields[k])) patch[k] = fields[k]; });
      // Never upgrade consent silently: only overwrite when the import states it explicitly.
      if (consent !== 'UNKNOWN') Object.keys(consentFields).forEach(function (k) { patch[k] = consentFields[k]; });
      contacts.update(existing, patch);
      result.updated++;
    } else {
      contacts.append([Object.assign({ contact_id: oceUuid_(), email: email, source: opts.source || 'CSV_IMPORT', status: suppressed[email] ? 'SUPPRESSED' : 'ACTIVE', created_at: now, updated_at: now, send_count: 0 }, fields, consentFields)]);
      result.created++;
    }
  });
  oceFlushAll_();
  oceLog_('INFO', 'contacts', 'CSV import', { created: result.created, updated: result.updated, skipped: result.skipped });
  oceFlushAll_();
  return result;
}

function oceCandidatesPage_(opts) {
  opts = opts || {};
  var size = oceClamp_(opts.page_size, 1, 200, 50);
  var status = String(opts.status || 'PENDING').toUpperCase();
  var q = String(opts.q || '').toLowerCase();
  var mission = String(opts.mission_id || '');
  var minConf = Number(opts.min_confidence || 0);
  var rows = oceTable_('CANDIDATES').filter(function (c) {
    if (status !== 'ALL' && String(c.review_status).toUpperCase() !== status) return false;
    if (mission && String(c.mission_ids).indexOf(mission) < 0) return false;
    if (minConf && Number(c.confidence || 0) < minConf) return false;
    if (q && [c.email, c.organization, c.phone, c.website, c.category, c.location].join(' ').toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) { return (Number(b.confidence) || 0) - (Number(a.confidence) || 0) || (oceToDate_(b.last_seen_at) || 0) - (oceToDate_(a.last_seen_at) || 0); });
  var total = rows.length;
  var pages = Math.max(1, Math.ceil(total / size));
  var page = oceClamp_(opts.page, 1, pages, 1);
  return {
    page: page, page_size: size, total: total, total_pages: pages,
    items: rows.slice((page - 1) * size, page * size).map(function (c) {
      return { candidate_id: c.candidate_id, email: c.email, phone: c.phone, person_name: c.person_name, role: c.role, organization: c.organization,
        website: c.website, address: c.address, country: c.country, location: c.location, category: c.category, confidence: Number(c.confidence) || 0,
        sources_count: Number(c.sources_count) || 1, source_urls: oceStr_(c.source_urls).split(/\s+/).filter(Boolean), review_status: c.review_status,
        lawful_basis: c.lawful_basis, consent_status: c.consent_status, evidence: c.evidence, last_seen_at: c.last_seen_at };
    })
  };
}

function oceContactsPage_(opts) {
  opts = opts || {};
  var size = oceClamp_(opts.page_size, 1, 200, 50);
  var q = String(opts.q || '').toLowerCase();
  var eligibleOnly = String(opts.eligible || '').toUpperCase() === 'TRUE';
  var rows = oceTable_('CONTACTS').all().map(function (c) {
    return { row: c, el: oceContactEligibility_(c) };
  }).filter(function (x) {
    if (eligibleOnly && !x.el.ok) return false;
    if (q && [x.row.email, x.row.organization, x.row.first_name, x.row.last_name, x.row.tags, x.row.category].join(' ').toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  var total = rows.length;
  var pages = Math.max(1, Math.ceil(total / size));
  var page = oceClamp_(opts.page, 1, pages, 1);
  return {
    page: page, page_size: size, total: total, total_pages: pages,
    eligible_total: oceTable_('CONTACTS').count(function (c) { return oceContactEligibility_(c).ok; }),
    items: rows.slice((page - 1) * size, page * size).map(function (x) {
      var c = x.row;
      return { contact_id: c.contact_id, email: c.email, first_name: c.first_name, last_name: c.last_name, organization: c.organization, phone: c.phone,
        category: c.category, country: c.country, status: c.status, lawful_basis: c.lawful_basis, consent_status: c.consent_status, tags: c.tags,
        last_sent_at: c.last_sent_at, send_count: Number(c.send_count) || 0, eligible: x.el.ok, eligibility_reason: x.el.reason };
    })
  };
}

/** Updates consent/basis/status/tags for existing contacts (e.g. after an opt-in campaign). */
function oceUpdateContacts_(ids, patch) {
  var contacts = oceTable_('CONTACTS');
  var allowed = {};
  if (patch.lawful_basis !== undefined) {
    var b = String(patch.lawful_basis).toUpperCase();
    if (OCE_LAWFUL_BASES.indexOf(b) < 0) throw new Error('Invalid lawful_basis');
    allowed.lawful_basis = b;
  }
  if (patch.consent_status !== undefined) {
    var cs = String(patch.consent_status).toUpperCase();
    if (['YES', 'NO', 'UNKNOWN'].indexOf(cs) < 0) throw new Error('Invalid consent_status');
    if (cs === 'YES' && !oceStr_(patch.consent_source)) throw new Error('consent_source is required when recording consent.');
    allowed.consent_status = cs;
    if (cs === 'YES') { allowed.consent_date = new Date(); allowed.consent_source = oceClean_(patch.consent_source, 200); }
  }
  if (patch.tags !== undefined) allowed.tags = oceClean_(patch.tags, 300);
  if (patch.status !== undefined) {
    var st = String(patch.status).toUpperCase();
    if (['ACTIVE', 'INACTIVE'].indexOf(st) < 0) throw new Error('Status may only be set to ACTIVE or INACTIVE here; use suppression for opt-outs.');
    allowed.status = st;
  }
  allowed.updated_at = new Date();
  var n = 0;
  (ids || []).forEach(function (id) {
    var c = contacts.get('contact_id', id);
    if (!c) return;
    if (allowed.status === 'ACTIVE' && oceSuppressionSet_()[oceEmailNormalize_(c.email)]) return; // never re-activate an opt-out
    contacts.update(c, allowed);
    n++;
  });
  oceFlushAll_();
  return { updated: n };
}
