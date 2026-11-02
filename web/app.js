/* OCE Source Collector UI
 * LEGO block: URL -> Scan -> Source Intelligence -> Normalize -> Review
 * Backend configuration belongs to infrastructure, never to the operator.
 */
const CONFIG = {
  COLLECTOR_ENDPOINT: 'https://script.google.com/macros/s/AKfycbxLpeSVROLACHa2i6CIlWddMSmKdoyKAaZ7QJmWDVW-1s_LCM9JyrllYeZHGQFPmCO/exec'
};

let latest = null;
let latestIntelligence = null;
const $ = id => document.getElementById(id);

function setStatus(text, show = true) {
  $('status').textContent = text;
  $('status').classList.toggle('hidden', !show);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>\"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;'
  }[c]));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUgandaPhone(value) {
  let s = String(value || '').trim().replace(/[^\d+]/g, '');
  if (s.indexOf('00') === 0) s = '+' + s.slice(2);
  if (/^0?7\d{8}$/.test(s)) s = '+256' + s.slice(s.indexOf('7'));
  if (/^2567\d{8}$/.test(s)) s = '+' + s;
  return s;
}

function extractJsonLdObjects(data) {
  const raw = asArray(data.jsonld);
  const out = [];
  raw.forEach(item => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item['@graph'])) item['@graph'].forEach(x => {
      if (x && typeof x === 'object') out.push(x);
    });
    else out.push(item);
  });
  return out;
}

function findFirst(objects, keys) {
  for (const obj of objects) {
    for (const key of keys) {
      if (obj[key] && typeof obj[key] !== 'object') return String(obj[key]);
    }
  }
  return '';
}

function findType(objects) {
  const types = [];
  objects.forEach(obj => {
    const t = obj['@type'];
    if (Array.isArray(t)) t.forEach(x => types.push(String(x)));
    else if (t) types.push(String(t));
  });
  return unique(types).slice(0, 10);
}

function findAddress(objects) {
  for (const obj of objects) {
    const address = obj.address;
    if (!address) continue;
    if (typeof address === 'string') return address;
    if (typeof address === 'object') {
      const parts = [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode, address.addressCountry]
        .filter(Boolean).map(String);
      if (parts.length) return parts.join(', ');
    }
  }
  return '';
}

function findContactIndicators(data) {
  const links = asArray(data.links);
  const text = String(data.text || '');
  const emails = new Set();
  const phones = new Set();
  const contactPages = [];

  const serialized = JSON.stringify(links);
  let m;
  const emailLinkRe = /mailto:([^?#\s>]+)/ig;
  while ((m = emailLinkRe.exec(serialized)) !== null) emails.add(normalizeEmail(m[1]));

  const phoneLinkRe = /tel:([^?#\s>]+)/ig;
  while ((m = phoneLinkRe.exec(serialized)) !== null) phones.add(normalizeUgandaPhone(m[1]));

  const publicEmailRe = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig;
  while ((m = publicEmailRe.exec(text)) !== null) emails.add(normalizeEmail(m[0]));

  const publicPhoneRe = /(?:\+?256|0)(?:7|3)\d{8}\b/g;
  while ((m = publicPhoneRe.exec(text)) !== null) phones.add(normalizeUgandaPhone(m[0]));

  links.forEach(link => {
    const label = String(link.label || '').trim();
    const href = String(link.url || '').toLowerCase();
    const haystack = (label + ' ' + href).toLowerCase();
    if (/contact|about|location|reach us|customer service|get in touch/.test(haystack)) {
      contactPages.push({ label: label || 'Contact page', url: link.url });
    }
  });

  return {
    emails: unique([...emails]).slice(0, 50),
    phones: unique([...phones]).slice(0, 50),
    contactPages: contactPages.slice(0, 20)
  };
}

function buildNormalizedCandidates(indicators, sourceUrl) {
  const candidates = [];
  indicators.emails.forEach(email => candidates.push({
    kind: 'email', value: normalizeEmail(email), normalized: normalizeEmail(email),
    source_url: sourceUrl, consent_status: 'NO_CONSENT', review_status: 'PENDING'
  }));
  indicators.phones.forEach(phone => candidates.push({
    kind: 'phone', value: phone, normalized: normalizeUgandaPhone(phone),
    source_url: sourceUrl, consent_status: 'NO_CONSENT', review_status: 'PENDING'
  }));
  return candidates;
}

function buildSourceIntelligence(data) {
  const objects = extractJsonLdObjects(data);
  const types = findType(objects);
  const indicators = findContactIndicators(data);
  const candidates = buildNormalizedCandidates(indicators, data.source_url || '');

  return {
    organization: findFirst(objects, ['name', 'legalName', 'alternateName']) || data.title || '',
    type: types.join(', '),
    website: findFirst(objects, ['url']) || data.source_url || '',
    address: findAddress(objects),
    description: findFirst(objects, ['description']) || data.description || '',
    structuredDataTypes: types,
    contactIndicators: indicators,
    normalizedCandidates: candidates,
    consentStatus: 'NO_CONSENT',
    sourceUrl: data.source_url || '',
    collectedAt: data.collected_at || ''
  };
}

function renderCandidates(info) {
  const candidates = asArray(info.normalizedCandidates);
  $('candidateCount').textContent = String(candidates.length);
  $('candidateRows').innerHTML = candidates.length
    ? candidates.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.kind)}</td><td>${esc(c.normalized)}</td><td>${esc(c.consent_status)}</td><td>${esc(c.review_status)}</td></tr>`).join('')
    : '<tr><td colspan="5">No contact candidates detected on this page.</td></tr>';
  $('candidateReview').classList.remove('hidden');
}

function renderSourceIntelligence(data) {
  const info = buildSourceIntelligence(data);
  latestIntelligence = info;
  const indicator = info.contactIndicators;

  $('organization').textContent = info.organization || 'Not identified';
  $('sourceType').textContent = info.type || 'Not identified';
  $('website').textContent = info.website || data.source_url || '—';
  $('address').textContent = info.address || 'Not identified';
  $('emailCount').textContent = String(indicator.emails.length);
  $('phoneCount').textContent = String(indicator.phones.length);
  $('contactPageCount').textContent = String(indicator.contactPages.length);
  $('consentStatus').textContent = info.consentStatus;
  $('collectedAt').textContent = info.collectedAt ? new Date(info.collectedAt).toLocaleString() : '—';

  $('structuredTypes').innerHTML = info.structuredDataTypes.length
    ? info.structuredDataTypes.map(type => `<span class="tag">${esc(type)}</span>`).join(' ')
    : '<span>None detected</span>';

  $('contactPages').innerHTML = indicator.contactPages.length
    ? indicator.contactPages.map(link => `<a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.label)} ↗</a>`).join('')
    : 'No obvious contact pages detected.';

  renderCandidates(info);
  $('sourceIntelligence').classList.remove('hidden');
}

function render(data) {
  latest = data;
  $('results').classList.remove('hidden');
  $('title').textContent = data.title || 'Untitled';
  $('source').textContent = data.source_url || '';
  $('summary').textContent = `${asArray(data.tables).length} structured rows · ${asArray(data.links).length} links`;

  const rows = asArray(data.tables);
  $('rows').innerHTML = rows.slice(0, 100).map((row, i) =>
    `<tr><td>${i + 1}</td>${[0, 1, 2, 3].map(j => `<td>${esc(row[j] || '')}</td>`).join('')}</tr>`
  ).join('') || '<tr><td colspan="5">No HTML table records detected.</td></tr>';

  $('links').innerHTML = asArray(data.links).slice(0, 50).map(link =>
    `<a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.label)} ↗</a>`
  ).join('') || 'No labelled links detected.';

  renderSourceIntelligence(data);
}

function friendlyError(message) {
  const text = String(message || 'Scan failed.');
  if (/HTTP 403|Source returned HTTP 403/.test(text)) return 'This source refused automated collection (HTTP 403). No access-control bypass was attempted.';
  if (/HTTP 401|Source returned HTTP 401/.test(text)) return 'This source requires authentication (HTTP 401). OCE only scans public pages.';
  if (/HTTP 404|Source returned HTTP 404/.test(text)) return 'The requested source was not found (HTTP 404).';
  if (/HTTP 429|Source returned HTTP 429/.test(text)) return 'The source is rate-limiting automated requests (HTTP 429). Try again later.';
  if (/HTTP 5\d\d|Source returned HTTP 5/.test(text)) return 'The source server returned an error. Please try again later.';
  return text;
}

async function scan() {
  const url = $('url').value.trim();
  if (!url) return setStatus('Enter a website URL.');
  if (!/^https?:\/\//i.test(url)) return setStatus('Enter a valid HTTP/HTTPS URL.');
  if (!CONFIG.COLLECTOR_ENDPOINT) return setStatus('OCE is waiting for its deployed collector endpoint.');

  setStatus('Scanning public page…');
  $('results').classList.add('hidden');
  $('sourceIntelligence').classList.add('hidden');
  $('candidateReview').classList.add('hidden');

  try {
    const endpoint = `${CONFIG.COLLECTOR_ENDPOINT}?url=${encodeURIComponent(url)}`;
    const response = await fetch(endpoint, { method: 'GET', redirect: 'follow', cache: 'no-store' });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Collector returned HTTP ${response.status}`);
    if (!result || !result.ok) throw new Error((result && result.error) || 'Scan failed');
    render(result.result);
    setStatus('Scan complete. Review candidates before any import.');
  } catch (error) {
    setStatus(friendlyError(error.message || error));
  }
}

$('scan').onclick = scan;
$('export').onclick = () => {
  if (!latest) return;
  const exportData = { scan: latest, source_intelligence: latestIntelligence || buildSourceIntelligence(latest) };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = 'oce-source-intelligence.json';
  link.click();
  URL.revokeObjectURL(objectUrl);
};

$('url').addEventListener('keydown', event => {
  if (event.key === 'Enter') scan();
});
