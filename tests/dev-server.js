'use strict';
/**
 * Local demo/dev server: serves web/ and runs the real Apps Script code (apps-script/*.gs)
 * in the mock runtime behind /exec, with a small fake public web so missions produce data.
 *
 *   node tests/dev-server.js        -> http://localhost:8787  (API key printed on start)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createRuntime } = require('./gas-runtime');

const PORT = Number(process.env.PORT || 8787);
const rt = createRuntime({ serviceUrl: `http://localhost:${PORT}/exec` });
const page = (title, body, head = '') => ({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: `<!doctype html><html><head><title>${title}</title>${head}</head><body>${body}</body></html>` });

// Fake public web used by the demo mission.
rt.on('https://demo-directory.ug/members', page('Registered Member Firms | Demo Accountants Association', `
  <a href="/members?page=2">Next ›</a><a href="/firm/alpha">Alpha Audit Partners</a><a href="/firm/beta">Beta &amp; Co</a><a href="/firm/delta">Delta Tax Advisors</a>
  Secretariat: secretariat [at] demo-directory [dot] ug · Tel +256 414 123 456`));
rt.on('https://demo-directory.ug/members?page=2', page('Members page 2', '<a href="/firm/gamma">Gamma Consulting</a><a href="/firm/omega">Omega Assurance</a>'));
rt.on('https://demo-directory.ug/firm/alpha', page('Alpha Audit Partners | Contact', '<a href="mailto:info@alphaaudit.co.ug">Email</a> Phone: 0772 111 222 <a href="/firm/alpha/team">Team</a>',
  '<script type="application/ld+json">{"@type":"AccountingService","name":"Alpha Audit Partners Ltd","address":{"streetAddress":"Plot 4 Kampala Road","addressLocality":"Kampala","addressCountry":"UG"}}</script>'));
rt.on('https://demo-directory.ug/firm/alpha/team', page('Team', 'Managing partner: Jane Okello — jane.okello@alphaaudit.co.ug'));
rt.on('https://demo-directory.ug/firm/beta', page('Beta & Co Certified Accountants', 'Write to accounts@betaco.ug or call +256 (0) 414 555 666. Office address: Plot 12 Jinja Road, Kampala'));
rt.on('https://demo-directory.ug/firm/delta', page('Delta Tax Advisors — Mbarara', '<a href="mailto:hello@deltatax.ug">hello@deltatax.ug</a> Mobile: 0701 234 567. Mbarara, Uganda'));
rt.on('https://demo-directory.ug/firm/gamma', page('Gamma Consulting', 'Tel: 0414 999 888 — Office address: Plot 9, Lira Road, Gulu'));
rt.on('https://demo-directory.ug/firm/omega', { status: 403, body: 'Forbidden' });
rt.on(/bing\.com\/search/, { status: 200, body: '<rss><channel></channel></rss>' });

const setup = rt.call('oceSetup');
const KEY = setup.api_key;
if (process.env.OCE_DEMO_SEED !== '0') {
  rt.fresh();
  rt.ctx.oceCreateMission_('Audit firms in Uganda', { seeds: ['https://demo-directory.ug/members'], skip_discovery: true, max_pages: 40 });
  for (let i = 0; i < 6; i++) { rt.fresh(); if (!rt.ctx.oceRunWorker_({ max_seconds: 300 }).processed) break; }
  rt.fresh();
  rt.ctx.oceApplySettings_({ DEFAULT_FROM_EMAIL: 'hello@odoch.example', DEFAULT_FROM_NAME: 'Brian at Odoch', SENDER_POSTAL_ADDRESS: 'Plot 1, Kampala Road, Kampala, Uganda' });
  rt.fresh();
  const pending = rt.ctx.oceCandidatesPage_({ status: 'PENDING', page_size: 100 }).items.filter((c) => /alphaaudit|deltatax/.test(c.email));
  rt.ctx.oceReviewCandidates_(pending.map((c) => c.candidate_id), 'APPROVE', { lawful_basis: 'CONSENT', consent_status: 'YES', consent_source: 'ICPAU 2026 expo sign-up sheet' });
  rt.fresh();
  rt.ctx.oceSaveCampaign_({ name: 'December audit-season offer', subject: 'Hello {{first_name|there}} — year-end support for {{organization|your firm}}', body_html: '<p>Hi {{first_name|there}},</p><p>We help audit firms like <b>{{organization}}</b> close the year faster.</p><p>Regards,<br>Brian</p>' });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/exec') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      rt.fresh();
      const parameter = Object.fromEntries(url.searchParams);
      const out = req.method === 'POST' ? rt.ctx.doPost({ parameter, postData: { contents: body } }) : rt.ctx.doGet({ parameter });
      const isHtml = !!out.html;
      res.writeHead(200, { 'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'application/json' });
      res.end(isHtml ? out.getContent() : out.getContent());
    });
    return;
  }
  const file = path.join(__dirname, '..', 'web', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(path.join(__dirname, '..', 'web')) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`OCE dev server: http://localhost:${PORT}`);
  console.log(`Web app URL:    http://localhost:${PORT}/exec`);
  console.log(`API key:        ${KEY}`);
});
