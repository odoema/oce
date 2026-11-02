/* OCE Contact Intelligence V1
 * LEGO block: public source -> structured business/contact candidates.
 * This block extracts evidence only. It does NOT subscribe contacts to marketing.
 * Consent / legal-basis eligibility remains a separate downstream gate.
 */

const OCE_CONTACT_INTELLIGENCE = {
  VERSION: '1.0.0',
  QUEUE_SHEET: 'SOURCE_QUEUE',
  CANDIDATE_SHEET: 'CONTACT_INTELLIGENCE',
  SCAN_LOG_SHEET: 'CONTACT_SCAN_LOG',
  MAX_BATCH: 10,
  MAX_CANDIDATES_PER_SOURCE: 250,
  MAX_EMAILS: 100,
  MAX_PHONES: 100
};

function setupContactIntelligence() {
  const ss = getOceSpreadsheet_();
  const candidate = ss.getSheetByName(OCE_CONTACT_INTELLIGENCE.CANDIDATE_SHEET) || ss.insertSheet(OCE_CONTACT_INTELLIGENCE.CANDIDATE_SHEET);
  const scanLog = ss.getSheetByName(OCE_CONTACT_INTELLIGENCE.SCAN_LOG_SHEET) || ss.insertSheet(OCE_CONTACT_INTELLIGENCE.SCAN_LOG_SHEET);

  const candidateHeaders = [
    'candidate_id',
    'source_id',
    'source_url',
    'email',
    'phone',
    'person_name',
    'role',
    'organization',
    'address',
    'country',
    'location',
    'category',
    'evidence',
    'confidence',
    'discovered_at',
    'consent_status',
    'marketing_eligible',
    'suppression_status',
    'analysis_version'
  ];
  if (candidate.getLastRow() === 0) candidate.getRange(1, 1, 1, candidateHeaders.length).setValues([candidateHeaders]);
  candidate.setFrozenRows(1);
  candidate.getRange(1, 1, 1, candidateHeaders.length).setFontWeight('bold');

  const scanHeaders = ['scan_id', 'source_id', 'source_url', 'status', 'candidate_count', 'scanned_at', 'error', 'analysis_version'];
  if (scanLog.getLastRow() === 0) scanLog.getRange(1, 1, 1, scanHeaders.length).setValues([scanHeaders]);
  scanLog.setFrozenRows(1);
  scanLog.getRange(1, 1, 1, scanHeaders.length).setFontWeight('bold');

  return {
    ok: true,
    candidate_sheet: candidate.getName(),
    scan_log_sheet: scanLog.getName(),
    version: OCE_CONTACT_INTELLIGENCE.VERSION
  };
}

function runContactIntelligence(limit) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    setupContactIntelligence();

    const max = Math.max(1, Math.min(OCE_CONTACT_INTELLIGENCE.MAX_BATCH, Number(limit || 5)));
    const queue = getCompletedQueueItemsForContactScan_(max);
    const summary = {
      ok: true,
      version: OCE_CONTACT_INTELLIGENCE.VERSION,
      requested: max,
      processed: 0,
      successful: 0,
      failed: 0,
      candidates: 0,
      items: []
    };

    queue.forEach(function(item) {
      const started = new Date();
      try {
        const result = scrapeUrl_(item.url);
        const candidates = extractContactCandidates_(result, item);
        const saved = saveContactCandidates_(candidates);
        logContactScan_(item, 'COMPLETED', saved.length, '', started);

        summary.processed += 1;
        summary.successful += 1;
        summary.candidates += saved.length;
        summary.items.push({
          source_id: item.source_id,
          url: item.url,
          status: 'COMPLETED',
          candidate_count: saved.length
        });
      } catch (err) {
        const message = String(err.message || err);
        logContactScan_(item, 'FAILED', 0, message, started);
        summary.processed += 1;
        summary.failed += 1;
        summary.items.push({
          source_id: item.source_id,
          url: item.url,
          status: 'FAILED',
          error: message
        });
      }
    });

    return summary;
  } finally {
    lock.releaseLock();
  }
}

function getCompletedQueueItemsForContactScan_(limit) {
  const ss = getOceSpreadsheet_();
  const queue = ss.getSheetByName(OCE_CONTACT_INTELLIGENCE.QUEUE_SHEET);
  if (!queue || queue.getLastRow() < 2) return [];

  const rows = queue.getRange(2, 1, queue.getLastRow() - 1, 11).getValues();
  const scanned = getContactScanStatus_();
  const out = [];

  rows.forEach(function(r) {
    if (out.length >= limit) return;
    const status = String(r[4] || '').toUpperCase();
    const sourceId = String(r[1] || '');
    const url = String(r[2] || '');
    if (status !== 'COMPLETED' || !sourceId || !url) return;
    if (scanned[sourceId] === 'COMPLETED') return;
    out.push({
      queue_id: String(r[0] || ''),
      source_id: sourceId,
      url: url,
      source: String(r[10] || 'QUEUE_WORKER')
    });
  });

  return out;
}

function getContactScanStatus_() {
  const ss = getOceSpreadsheet_();
  const sheet = ss.getSheetByName(OCE_CONTACT_INTELLIGENCE.SCAN_LOG_SHEET);
  const out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  rows.forEach(function(r) {
    const sourceId = String(r[1] || '');
    if (!sourceId) return;
    out[sourceId] = String(r[3] || '').toUpperCase();
  });
  return out;
}

function extractContactCandidates_(result, item) {
  const text = String(result && result.text || '');
  const jsonld = Array.isArray(result && result.jsonld) ? result.jsonld : [];
  const links = Array.isArray(result && result.links) ? result.links : [];
  const tables = Array.isArray(result && result.tables) ? result.tables : [];

  const emails = collectEmails_(text, links);
  const phones = collectPhones_(text, links);
  const entities = collectJsonLdEntities_(jsonld);
  const organization = firstNonEmpty_([
    entities.organization,
    extractLabeledValue_(text, ['company', 'organization', 'organisation', 'firm'])
  ]);
  const address = firstNonEmpty_([
    entities.address,
    extractLabeledValue_(text, ['address', 'office address', 'location'])
  ]);
  const country = firstNonEmpty_([
    entities.country,
    extractCountry_(text)
  ]);
  const location = firstNonEmpty_([
    entities.location,
    extractLocation_(text)
  ]);
  const person = entities.person || '';
  const role = entities.role || '';
  const category = inferCategory_(String(item.url || '') + ' ' + text + ' ' + organization);
  const evidenceBase = buildEvidence_(result, emails, phones, organization, person);
  const out = [];
  const seen = {};

  emails.forEach(function(email) {
    if (out.length >= OCE_CONTACT_INTELLIGENCE.MAX_CANDIDATES_PER_SOURCE) return;
    const key = 'email|' + email;
    if (seen[key]) return;
    seen[key] = true;
    out.push(buildCandidate_(item, {
      email: email,
      phone: bestPhone_(phones),
      person: person,
      role: role,
      organization: organization,
      address: address,
      country: country,
      location: location,
      category: category,
      evidence: evidenceBase + ' Email: ' + email,
      confidence: emailConfidence_(email, organization, person)
    }));
  });

  if (!emails.length && phones.length) {
    phones.slice(0, 25).forEach(function(phone) {
      if (out.length >= OCE_CONTACT_INTELLIGENCE.MAX_CANDIDATES_PER_SOURCE) return;
      const key = 'phone|' + phone;
      if (seen[key]) return;
      seen[key] = true;
      out.push(buildCandidate_(item, {
        email: '',
        phone: phone,
        person: person,
        role: role,
        organization: organization,
        address: address,
        country: country,
        location: location,
        category: category,
        evidence: evidenceBase + ' Phone: ' + phone,
        confidence: 'MEDIUM'
      }));
    });
  }

  if (!out.length && organization) {
    out.push(buildCandidate_(item, {
      email: '',
      phone: bestPhone_(phones),
      person: person,
      role: role,
      organization: organization,
      address: address,
      country: country,
      location: location,
      category: category,
      evidence: evidenceBase + ' Organization evidence only.',
      confidence: 'MEDIUM'
    }));
  }

  return out;
}

function buildCandidate_(item, data) {
  return [
    Utilities.getUuid(),
    item.source_id,
    item.url,
    normalizeEmailForIntelligence_(data.email),
    normalizePhoneForIntelligence_(data.phone),
    cleanIntelligence_(data.person),
    cleanIntelligence_(data.role),
    cleanIntelligence_(data.organization),
    cleanIntelligence_(data.address),
    cleanIntelligence_(data.country),
    cleanIntelligence_(data.location),
    cleanIntelligence_(data.category),
    cleanIntelligence_(data.evidence),
    data.confidence || 'LOW',
    new Date(),
    'NOT_ESTABLISHED',
    'REVIEW_REQUIRED',
    'NOT_CHECKED',
    OCE_CONTACT_INTELLIGENCE.VERSION
  ];
}

function saveContactCandidates_(rows) {
  if (!rows.length) return [];
  const sheet = getOceSpreadsheet_().getSheetByName(OCE_CONTACT_INTELLIGENCE.CANDIDATE_SHEET);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return rows;
}

function logContactScan_(item, status, candidateCount, error, started) {
  const sheet = getOceSpreadsheet_().getSheetByName(OCE_CONTACT_INTELLIGENCE.SCAN_LOG_SHEET);
  sheet.appendRow([
    Utilities.getUuid(),
    item.source_id,
    item.url,
    status,
    candidateCount,
    new Date(),
    error || '',
    OCE_CONTACT_INTELLIGENCE.VERSION
  ]);
}

function collectEmails_(text, links) {
  const values = [];
  const seen = {};
  const source = String(text || '') + ' ' + links.map(function(l) { return String(l && l.url || '') + ' ' + String(l && l.label || ''); }).join(' ');
  const regex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/ig;
  let match;
  while ((match = regex.exec(source)) && values.length < OCE_CONTACT_INTELLIGENCE.MAX_EMAILS) {
    const email = normalizeEmailForIntelligence_(match[0]);
    if (!isPlausibleEmail_(email) || seen[email]) continue;
    seen[email] = true;
    values.push(email);
  }
  return values;
}

function collectPhones_(text, links) {
  const values = [];
  const seen = {};
  const source = String(text || '') + ' ' + links.map(function(l) { return String(l && l.url || '') + ' ' + String(l && l.label || ''); }).join(' ');
  const regex = /(?:\+?256|0)\s?(?:7\d|3\d|4\d)\s?\d{3}\s?\d{3,4}/g;
  let match;
  while ((match = regex.exec(source)) && values.length < OCE_CONTACT_INTELLIGENCE.MAX_PHONES) {
    const phone = normalizePhoneForIntelligence_(match[0]);
    if (!phone || seen[phone]) continue;
    seen[phone] = true;
    values.push(phone);
  }
  return values;
}

function collectJsonLdEntities_(jsonld) {
  const out = {organization:'', address:'', country:'', location:'', person:'', role:''};
  const nodes = [];

  jsonld.forEach(function(block) {
    if (!block) return;
    if (Array.isArray(block)) block.forEach(function(x) { nodes.push(x); });
    else if (block['@graph'] && Array.isArray(block['@graph'])) block['@graph'].forEach(function(x) { nodes.push(x); });
    else nodes.push(block);
  });

  nodes.forEach(function(node) {
    if (!node || typeof node !== 'object') return;
    const type = String(node['@type'] || '').toLowerCase();
    const name = cleanIntelligence_(node.name || '');

    if (!out.organization && /organization|localbusiness|corporation|professionalservice|accountingservice|financialservice/.test(type)) {
      out.organization = name;
    }
    if (!out.person && /person/.test(type)) out.person = name;
    if (!out.role && node.jobTitle) out.role = cleanIntelligence_(node.jobTitle);

    const address = node.address;
    if (!out.address && address) {
      if (typeof address === 'string') out.address = cleanIntelligence_(address);
      else if (typeof address === 'object') {
        out.address = cleanIntelligence_([
          address.streetAddress,
          address.addressLocality,
          address.addressRegion,
          address.postalCode,
          address.addressCountry && (address.addressCountry.name || address.addressCountry)
        ].filter(Boolean).join(', '));
      }
    }

    if (!out.country && address && typeof address === 'object' && address.addressCountry) {
      out.country = cleanIntelligence_(address.addressCountry.name || address.addressCountry);
    }
    if (!out.location && node.location) {
      out.location = cleanIntelligence_(typeof node.location === 'string' ? node.location : (node.location.name || ''));
    }
  });

  return out;
}

function extractLabeledValue_(text, labels) {
  const source = String(text || '');
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i].replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(label + '\\s*[:\\-]\\s*([^|\\n\\r]{2,140})', 'i');
    const match = source.match(regex);
    if (match && match[1]) return cleanIntelligence_(match[1]);
  }
  return '';
}

function extractCountry_(text) {
  const source = String(text || '').toLowerCase();
  if (/\buganda\b/.test(source)) return 'Uganda';
  if (/\bkenya\b/.test(source)) return 'Kenya';
  if (/\brwanda\b/.test(source)) return 'Rwanda';
  if (/\btanzania\b/.test(source)) return 'Tanzania';
  return '';
}

function extractLocation_(text) {
  const source = String(text || '');
  const match = source.match(/\b(Kampala|Entebbe|Jinja|Mbarara|Gulu|Lira|Mbale|Fort Portal|Arua|Nebbi|Wakiso|Mukono)\b/i);
  return match ? cleanIntelligence_(match[1]) : '';
}

function inferCategory_(value) {
  const source = String(value || '').toLowerCase();
  if (/auditor|audit|accountan|accountancy|assurance|tax consultant|tax advisory/.test(source)) return 'ACCOUNTING_AUDIT';
  if (/insurance|insurer|broker/.test(source)) return 'INSURANCE';
  if (/bank|microfinance|fintech|financial service/.test(source)) return 'FINANCIAL_SERVICES';
  if (/law firm|advocate|legal service/.test(source)) return 'LEGAL_SERVICES';
  if (/hotel|lodge|resort/.test(source)) return 'HOSPITALITY';
  if (/school|university|college|academy/.test(source)) return 'EDUCATION';
  return 'OTHER';
}

function buildEvidence_(result, emails, phones, organization, person) {
  const parts = [];
  if (result && result.title) parts.push('Title: ' + cleanIntelligence_(result.title));
  if (organization) parts.push('Organization: ' + organization);
  if (person) parts.push('Person: ' + person);
  if (emails.length) parts.push('Email indicators: ' + emails.length);
  if (phones.length) parts.push('Phone indicators: ' + phones.length);
  return parts.join(' | ').slice(0, 900);
}

function bestPhone_(phones) {
  return phones.length ? phones[0] : '';
}

function emailConfidence_(email, organization, person) {
  const local = email.split('@')[0] || '';
  if (/^(info|contact|hello|office|admin|sales|support|accounts|audit|enquiries|enquiry)$/i.test(local)) return organization ? 'HIGH' : 'MEDIUM';
  if (person || organization) return 'HIGH';
  return 'MEDIUM';
}

function isPlausibleEmail_(email) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(email)) return false;
  return true;
}

function normalizeEmailForIntelligence_(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhoneForIntelligence_(value) {
  let phone = String(value || '').trim().replace(/[^\d+]/g, '');
  if (phone.indexOf('00') === 0) phone = '+' + phone.substring(2);
  if (/^07\d{8}$/.test(phone)) phone = '+256' + phone.substring(1);
  if (/^7\d{8}$/.test(phone)) phone = '+256' + phone;
  if (/^2567\d{8}$/.test(phone)) phone = '+' + phone;
  return phone;
}

function cleanIntelligence_(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function firstNonEmpty_(values) {
  for (let i = 0; i < values.length; i += 1) {
    if (String(values[i] || '').trim()) return cleanIntelligence_(values[i]);
  }
  return '';
}

function testContactIntelligenceExtraction() {
  const synthetic = {
    source_url: 'https://example.test/auditor',
    title: 'Example Audit Firm',
    text: 'Example Audit Firm Uganda. Contact: audit@example.co.ug Phone: +256 701 234 567 Address: Kampala, Uganda.',
    links: [
      {label:'Email', url:'mailto:audit@example.co.ug'},
      {label:'Call', url:'tel:+256701234567'}
    ],
    jsonld: [{
      '@context':'https://schema.org',
      '@type':'ProfessionalService',
      'name':'Example Audit Firm',
      'address': {
        '@type':'PostalAddress',
        'streetAddress':'Plot 1 Example Road',
        'addressLocality':'Kampala',
        'addressCountry':'Uganda'
      }
    }],
    tables: []
  };

  const candidates = extractContactCandidates_(synthetic, {
    source_id:'TEST-SOURCE',
    url:synthetic.source_url,
    source:'TEST'
  });

  if (!candidates.length) throw Error('No contact candidate extracted.');
  const row = candidates[0];
  if (row[3] !== 'audit@example.co.ug') throw Error('Email extraction failed.');
  if (row[4] !== '+256701234567') throw Error('Phone normalization failed.');
  if (row[7] !== 'Example Audit Firm') throw Error('Organization extraction failed.');
  if (row[9] !== 'Uganda') throw Error('Country extraction failed.');
  if (row[15] !== 'NOT_ESTABLISHED') throw Error('Consent state must remain NOT_ESTABLISHED.');
  if (row[16] !== 'REVIEW_REQUIRED') throw Error('Marketing eligibility must remain REVIEW_REQUIRED.');

  return {
    ok: true,
    version: OCE_CONTACT_INTELLIGENCE.VERSION,
    candidates: candidates.length,
    email: row[3],
    phone: row[4],
    organization: row[7],
    consent_status: row[15],
    marketing_eligible: row[16]
  };
}
