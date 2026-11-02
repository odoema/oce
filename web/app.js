/* OCE Source Collector UI
 * LEGO block: URL -> Scan -> Source Intelligence -> Review
 * Backend configuration belongs to infrastructure, never to the operator.
 * Uses a simple GET request to the Apps Script collector to avoid JSON POST preflight.
 */
const CONFIG = {
  COLLECTOR_ENDPOINT: 'https://script.google.com/macros/s/AKfycbxLpeSVROLACHa2i6CIlWddMSmKdoyKAaZ7QJmJWDVW-1s_LCM9JyrllYeZHGQFPmCO/exec'
};

let latest = null;
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

function extractJsonLdObjects(data) {
  const raw = asArray(data.jsonld);
  const out = [];
  raw.forEach(item => {
    if (item && typeof item === 'object') {
      if (Array.isArray(item['@graph'])) item['@graph'].forEach(x => { if (x && typeof x === 'object') out.push(x); });
      else out.push(item);
    }
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
  return [...new Set(types)].slice(0, 6);
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

  const emailRe = /mailto:([^?#\s>]+)/ig;
  let m;
  while ((m = emailRe.exec(JSON.stringify(links))) !== null) emails.add(m[1]);

  const phoneRe = /tel:([^?#\s>]+)/ig;
  while ((m = phoneRe.exec(JSON.stringify(links))) !== null) phones.add(m[1]);

  const publicEmailRe = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig;
  while ((m = publicEmailRe.exec(text)) !== null) emails.add(m[0].toLowerCase());

  links.forEach(link => {
    const label = String(link.label || '').trim();
    const href = String(link.url || '').toLowerCase();
    if (/contact|about|location|reach us|customer service|get in touch/.test((label + ' ' + href).toLowerCase())) {
      contactPages.push({ label: label || 'Contact page', url: link.url });
    }
  });

  return {
    emails: [...emails].slice(0, 20),
    phones: [...phones].slice(0, 20),
    contactPages: contactPages.slice(0, 20)
  };
}

function buildSourceIntelligence(data) {
  const objects = extractJsonLdObjects(data);
  const types = findType(objects);
  const indicators = findContactIndicators(data);

  return {
    organization: findFirst(objects, ['name', 'legalName', 'alternateName']) || data.title || '',
    type: types.join(', '),
    website: findFirst(objects, ['url']) || data.source_url || '',
    address: findAddress(objects),
    description: findFirst(objects, ['description']) || data.description || '',
    structuredDataTypes: types,
    contactIndicators: indicators,
    consentStatus: 'NO_CONSENT',
    sourceUrl: data.source_url || '',
    collectedAt: data.collected_at || ''
  };
}

function renderSourceIntelligence(data) {
  const info = buildSourceIntelligence(data);
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

async function scan() {
  const url = $('url').value.trim();
  if (!url) return setStatus('Enter a website URL.');

  if (!CONFIG.COLLECTOR_ENDPOINT || CONFIG.COLLECTOR_ENDPOINT.includes('REPLACE_WITH_DEPLOYED')) {
    return setStatus('OCE is waiting for its deployed collector endpoint.');
  }

  setStatus('Scanning public page…');
  $('results').classList.add('hidden');
  $('sourceIntelligence').classList.add('hidden');

  try {
    const endpoint = `${CONFIG.COLLECTOR_ENDPOINT}?url=${encodeURIComponent(url)}`;
    const response = await fetch(endpoint, { method: 'GET', redirect: 'follow', cache: 'no-store' });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Collector returned HTTP ${response.status}`);
    if (!result || !result.ok) throw new Error((result && result.error) || 'Scan failed');

    render(result.result);
    setStatus('Scan complete. Review source intelligence before importing.');
  } catch (error) {
    setStatus(error.message || 'Scan failed.');
  }
}

$('scan').onclick = scan;
$('export').onclick = () => {
  if (!latest) return;
  const exportData = { scan: latest, source_intelligence: buildSourceIntelligence(latest) };
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
