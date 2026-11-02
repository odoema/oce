/* OCE Source Collector UI
 * LEGO block: URL -> Scan -> Results
 * Backend configuration belongs to infrastructure, never to the operator.
 * Uses a simple GET request to the Apps Script collector to avoid JSON POST preflight.
 */
const CONFIG = {
  // Deployed OCE Apps Script /exec endpoint.
  // No collector secret/token is exposed in the browser.
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

function render(data) {
  latest = data;
  $('results').classList.remove('hidden');
  $('title').textContent = data.title || 'Untitled';
  $('source').textContent = data.source_url || '';
  $('summary').textContent = `${(data.tables || []).length} structured rows · ${(data.links || []).length} links`;

  const rows = data.tables || [];
  $('rows').innerHTML = rows.slice(0, 100).map((row, i) =>
    `<tr><td>${i + 1}</td>${[0, 1, 2, 3].map(j => `<td>${esc(row[j] || '')}</td>`).join('')}</tr>`
  ).join('') || '<tr><td colspan="5">No HTML table records detected.</td></tr>';

  $('links').innerHTML = (data.links || []).slice(0, 50).map(link =>
    `<a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.label)} ↗</a>`
  ).join('') || 'No labelled links detected.';
}

async function scan() {
  const url = $('url').value.trim();
  if (!url) return setStatus('Enter a website URL.');

  if (!CONFIG.COLLECTOR_ENDPOINT || CONFIG.COLLECTOR_ENDPOINT.includes('REPLACE_WITH_DEPLOYED')) {
    return setStatus('OCE is waiting for its deployed collector endpoint.');
  }

  setStatus('Scanning public page…');
  $('results').classList.add('hidden');

  try {
    const endpoint = `${CONFIG.COLLECTOR_ENDPOINT}?url=${encodeURIComponent(url)}`;
    const response = await fetch(endpoint, { method: 'GET', redirect: 'follow', cache: 'no-store' });
    if (!response.ok) throw new Error(`Collector returned HTTP ${response.status}`);

    const result = await response.json();
    if (!result.ok) throw new Error(result.error || 'Scan failed');

    render(result.result);
    setStatus('Scan complete. Review before importing.');
  } catch (error) {
    setStatus(error.message || 'Scan failed.');
  }
}

$('scan').onclick = scan;
$('export').onclick = () => {
  if (!latest) return;
  const blob = new Blob([JSON.stringify(latest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'oce-scan.json';
  link.click();
  URL.revokeObjectURL(url);
};

$('url').addEventListener('keydown', event => {
  if (event.key === 'Enter') scan();
});
