/* OCE Source Collector UI
 * LEGO block: URL -> Scan -> Results
 * Backend configuration belongs to infrastructure, never to the operator.
 * Browser transport uses JSONP-compatible GET to avoid Apps Script CORS/preflight issues.
 */
const CONFIG = {
  // Public Apps Script web-app endpoint. No collector secret belongs here.
  COLLECTOR_ENDPOINT: 'https://script.google.com/macros/s/REPLACE_WITH_DEPLOYED_OCE_EXEC_ID/exec'
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

function jsonpScan(url) {
  return new Promise((resolve, reject) => {
    const callback = `oceCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('The collector did not respond. Check that the OCE Apps Script web app is deployed for public access.'));
    }, 30000);

    function cleanup() {
      clearTimeout(timer);
      delete window[callback];
      script.remove();
    }

    window[callback] = result => {
      cleanup();
      if (!result || !result.ok) reject(new Error(result?.error || 'Scan failed'));
      else resolve(result.result);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('Unable to reach the OCE collector service.'));
    };

    script.src = `${CONFIG.COLLECTOR_ENDPOINT}?url=${encodeURIComponent(url)}&callback=${encodeURIComponent(callback)}`;
    document.body.appendChild(script);
  });
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
    const result = await jsonpScan(url);
    render(result);
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
