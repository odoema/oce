/* OCE Source Collector UI
 * LEGO block: URL -> Scan -> Results
 * Backend configuration belongs to infrastructure, never to the operator.
 */
const CONFIG = {
  // Set this to the deployed collector service URL before publishing a live scanner.
  // Never put a collector secret/token in this file.
  COLLECTOR_ENDPOINT: ''
};

let latest = null;
const $ = id => document.getElementById(id);

function setStatus(text, show = true) {
  $('status').textContent = text;
  $('status').classList.toggle('hidden', !show);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
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

  if (!CONFIG.COLLECTOR_ENDPOINT) {
    return setStatus('The OCE collector service is not connected yet. The interface is ready; the backend endpoint still needs to be deployed and configured.');
  }

  setStatus('Scanning public page…');
  $('results').classList.add('hidden');

  try {
    const response = await fetch(CONFIG.COLLECTOR_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'scan', url })
    });

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
