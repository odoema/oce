'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime } = require('./gas-runtime');

// Wednesday 25 Nov 2026, 10:00 in Kampala (inside the default 09-17 window, not a holiday).
const WORKDAY_10AM = new Date('2026-11-25T07:00:00Z');
const plain = (x) => JSON.parse(JSON.stringify(x));
/** Encodes an address the way Cloudflare's e-mail obfuscation does. */
function cfHex(email, key = 0x2a) {
  return key.toString(16).padStart(2, '0') + Buffer.from(email).toString('hex').match(/../g).map((h) => (parseInt(h, 16) ^ key).toString(16).padStart(2, '0')).join('');
}

function html(title, body, head = '') {
  return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: `<!doctype html><html lang="en"><head><title>${title}</title>${head}</head><body>${body}</body></html>` };
}

/** A small fake public web: a members directory with pagination, firm pages, traps and failures. */
function mountFakeWeb(rt) {
  rt.on('https://dir.example.ug/robots.txt', { status: 200, body: 'User-agent: *\nDisallow: /private\nCrawl-delay: 1\n' });
  rt.on('https://dir.example.ug/members', html('Member Firms | Example Accountants Association', `
    <h1>Registered member firms</h1>
    <a href="/members?page=2">Next ›</a>
    <a href="/firm/alpha">Alpha Audit Partners</a>
    <a href="/firm/beta?utm_source=x">Beta &amp; Co</a>
    <a href="/private/admin">Admin</a>
    <a href="/files/list.pdf">Download list (PDF)</a>
    <a href="https://facebook.com/exampleassoc">Facebook</a>
    <a href="https://other-site.com/partner">Partner site</a>
    <a href="/login">Member login</a>
    Contact the secretariat: secretariat [at] dir [dot] example [dot] ug, Tel: +256 414 123 456`));
  rt.on('https://dir.example.ug/members?page=2', html('Member Firms page 2', `<a href="/firm/gamma">Gamma Consulting</a><a href="/firm/alpha">Alpha again</a><a href="/firm/flaky">Flaky Ltd</a>`));
  rt.on('https://dir.example.ug/firm/alpha', html('Alpha Audit Partners | Contact', `
    <p>Alpha Audit Partners is a licensed audit firm in Kampala, Uganda.</p>
    <a href="mailto:info@alphaaudit.co.ug">Email us</a> Phone: 0772 111 222 &middot; Registered 2019-05-12
    <a href="/firm/alpha/team">Our team</a>`,
    `<script type="application/ld+json">{"@context":"https://schema.org","@type":"AccountingService","name":"Alpha Audit Partners Ltd","telephone":"+256 772 111 222","address":{"@type":"PostalAddress","streetAddress":"Plot 4 Kampala Road","addressLocality":"Kampala","addressCountry":"UG"}}</script>`));
  rt.on('https://dir.example.ug/firm/alpha/team', html('Team', `<p>Managing partner: jane.okello@alphaaudit.co.ug</p><p>Also info@alphaaudit.co.ug</p>`));
  rt.on('https://dir.example.ug/firm/beta', html('Beta &amp; Co Certified Accountants', `
    <span class="__cf_email__" data-cfemail="${cfHex('beta@beta.co.ug')}">[email protected]</span>
    Call: +256 (0) 414 555 666. Image: logo@2x.png. Example: someone@example.com`));
  rt.on('https://dir.example.ug/firm/gamma', html('Gamma Consulting', `<p>Office address: Plot 9, Jinja Road, Kampala</p><p>Tel: 0414 999 888</p>`));
  let flaky = 0;
  rt.on('https://dir.example.ug/firm/flaky', () => (++flaky === 1 ? { status: 503, body: 'busy' } : html('Flaky Ltd', '<a href="mailto:hello@flaky.ug">hello</a>')));
  rt.on('https://dir.example.ug/private/admin', html('secret', 'should never be fetched'));
  return { flakyCalls: () => flaky };
}

function setupRuntime(opts = {}) {
  const rt = createRuntime({ now: opts.now || WORKDAY_10AM });
  rt.call('oceSetup');
  return rt;
}

function drain(rt, max = 20) {
  for (let i = 0; i < max; i++) {
    rt.fresh();
    // Pretend backoff windows elapsed between ticks.
    const q = rt.sheet('SOURCE_QUEUE');
    const h = q.data[0];
    const idx = h.indexOf('next_attempt_at');
    q.data.slice(1).forEach((r) => { if (r[idx]) r[idx] = ''; });
    const s = rt.ctx.oceRunWorker_({ max_seconds: 300 });
    if (!s.processed) return;
  }
}

/* ------------------------------------------------------------------ utilities */

test('canonical URLs drop tracking, fragments, default ports and index files but keep pagination', () => {
  const rt = createRuntime();
  const c = rt.ctx.oceCanonicalUrl_;
  assert.equal(c('HTTPS://Example.UG:443/a/b/index.html?utm_source=x&page=2#top'), 'https://example.ug/a/b?page=2');
  assert.equal(c('https://example.ug/dir/?b=2&a=1'), 'https://example.ug/dir?a=1&b=2');
  assert.equal(c('https://example.ug'), 'https://example.ug/');
  assert.equal(c('ftp://example.ug'), '');
  assert.equal(rt.ctx.oceResolveUrl_('../x?y=1', 'https://a.ug/one/two/three'), 'https://a.ug/one/x?y=1');
  assert.equal(rt.ctx.oceResolveUrl_('//cdn.a.ug/p', 'https://a.ug/'), 'https://cdn.a.ug/p');
  assert.equal(rt.ctx.oceResolveUrl_('mailto:x@y.z', 'https://a.ug/'), '');
  assert.equal(rt.ctx.oceSiteOf_('https://shop.example.co.ug/x'), 'example.co.ug');
  assert.equal(rt.ctx.oceSiteOf_('https://www.example.com/x'), 'example.com');
});

test('public URL guard blocks private and local hosts', () => {
  const rt = createRuntime();
  ['http://localhost/', 'http://10.1.2.3/', 'http://192.168.1.1/', 'http://172.20.0.1/', 'http://169.254.169.254/latest', 'http://printer.local/'].forEach((u) => {
    assert.throws(() => rt.ctx.oceAssertPublicUrl_(u), /blocked/, u);
  });
  assert.equal(rt.ctx.oceAssertPublicUrl_('https://ursb.go.ug/'), true);
});

test('phone normalisation produces E.164 and rejects junk', () => {
  const rt = setupRuntime();
  const p = rt.ctx.ocePhoneNormalize_;
  rt.fresh();
  assert.equal(p('0772 123 456'), '+256772123456');
  assert.equal(p('+256 (0) 414 555 666'), '+256414555666');
  assert.equal(p('256772123456'), '+256772123456');
  assert.equal(p('00254 712 345 678'), '+254712345678');
  assert.equal(p('1234'), '');
  assert.equal(p('0000000000'), '');
});

/* ------------------------------------------------------------------ extraction */

test('extractor finds mailto, Cloudflare-protected and obfuscated e-mails and filters junk', () => {
  const rt = setupRuntime();
  rt.fresh();
  const page = rt.ctx.oceExtractPage_(`<html><head><title>Beta | Contact</title></head><body>
    <a href="mailto:Sales@Beta.co.ug?subject=hi">mail</a>
    <span data-cfemail="${cfHex('beta@beta.co.ug')}"></span>
    write to accounts [at] beta [dot] co [dot] ug
    image logo@2x.png sentry: 1234abcd@sentry.io placeholder you@example.com
    </body></html>`, 'https://beta.co.ug/contact');
  assert.ok(page.emails.includes('sales@beta.co.ug'));
  assert.ok(page.emails.includes('beta@beta.co.ug'), 'decodes Cloudflare data-cfemail');
  assert.ok(page.emails.includes('accounts@beta.co.ug'), 'de-obfuscates [at]/[dot]');
  assert.ok(!page.emails.some((e) => /2x\.png|sentry|example\.com/.test(e)), JSON.stringify(page.emails));
  assert.equal(page.is_contact_page, true);
});

test('extractor reads JSON-LD organisation, address and phone; ignores dates as phones', () => {
  const rt = setupRuntime();
  rt.fresh();
  const page = rt.ctx.oceExtractPage_(`<html><head><title>Home - Acme</title>
    <script type="application/ld+json">{"@graph":[{"@type":"WebSite","name":"Acme site"},{"@type":["Organization","LocalBusiness"],"name":"Acme Uganda Ltd","telephone":"+256 414 000 111","address":{"streetAddress":"Plot 1","addressLocality":"Kampala","addressCountry":"UG"}}]}</script>
    </head><body>Founded 2019-05-12. Ref 2023 11 23. Call us on 0772 123 456</body></html>`, 'https://acme.ug/');
  assert.equal(page.organization, 'Acme Uganda Ltd');
  assert.match(page.address, /Plot 1, Kampala/);
  assert.equal(page.country, 'Uganda');
  assert.deepEqual(plain(page.phones).sort(), ['+256414000111', '+256772123456']);
});

test('link scoring keeps same-site directory links and drops assets, social, login and off-site links', () => {
  const rt = setupRuntime();
  rt.fresh();
  const page = rt.ctx.oceExtractPage_(`<a href="/contact-us">Contact</a><a href="/doc.pdf">pdf</a><a href="https://twitter.com/x">tw</a>
    <a href="/wp-login.php">login</a><a href="https://elsewhere.com/a">x</a><a href="/blog/post">post</a><a href="/members?page=2">Next</a>`, 'https://site.ug/');
  const links = rt.ctx.oceScoreLinks_(page, { objective: 'members', same_site: true }).map((l) => l.url);
  assert.deepEqual(plain(links.slice(0, 2)).sort(), ['https://site.ug/contact-us', 'https://site.ug/members?page=2'].sort());
  assert.ok(!links.some((u) => /pdf|twitter|login|elsewhere/.test(u)));
});

test('robots.txt parsing: specific agent group, longest match, wildcards', () => {
  const rt = createRuntime();
  const rules = rt.ctx.oceParseRobots_('User-agent: *\nDisallow: /\n\nUser-agent: OCE-PublicCollector\nDisallow: /private\nAllow: /private/public$\nDisallow: /*.php$\nCrawl-delay: 7');
  const m = (p) => rt.ctx.oceRobotsMatch_(rules, p);
  assert.equal(m('/members'), true);
  assert.equal(m('/private/x'), false);
  assert.equal(m('/private/public'), true);
  assert.equal(m('/index.php'), false);
  assert.equal(m('/index.php?x'), true);
  assert.equal(rules.delay, 7);
  const star = rt.ctx.oceParseRobots_('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow:\n');
  assert.equal(rt.ctx.oceRobotsMatch_(star, '/anything'), true);
});

/* ------------------------------------------------------------------ crawling */

test('mission end-to-end: budgets, robots, retries, de-duplication and completion', () => {
  const rt = setupRuntime();
  const web = mountFakeWeb(rt);
  rt.fresh();
  const mission = rt.ctx.oceCreateMission_('Audit firms in Uganda', { seeds: ['https://dir.example.ug/members'], skip_discovery: true, max_pages: 9, max_depth: 2 });
  assert.equal(mission.status, 'RUNNING');
  assert.equal(rt.state.triggers.filter((t) => t.getHandlerFunction() === 'oceTick').length, 1, 'automation enabled');
  drain(rt);

  const fetched = rt.state.fetchLog.map((f) => f.url);
  assert.ok(!fetched.includes('https://dir.example.ug/private/admin'), 'robots disallow respected');
  assert.ok(!fetched.some((u) => /\.pdf|facebook|other-site|login/.test(u)), 'assets/social/off-site/login skipped');
  assert.equal(web.flakyCalls(), 2, 'transient 503 retried once');

  const queue = rt.sheet('SOURCE_QUEUE').objects();
  assert.ok(queue.length <= 9, 'page budget enforced: ' + queue.length);
  const alpha = queue.filter((r) => r.url === 'https://dir.example.ug/firm/alpha');
  assert.equal(alpha.length, 1, 'same URL queued once per mission');
  assert.ok(queue.some((r) => r.url === 'https://dir.example.ug/firm/beta'), 'tracking params stripped before de-dup');
  assert.ok(queue.every((r) => Number(r.depth) <= 2));
  assert.ok(queue.every((r) => !['QUEUED', 'SCRAPING'].includes(r.status)));

  const cands = rt.sheet('CANDIDATES').objects();
  const info = cands.filter((c) => c.email === 'info@alphaaudit.co.ug');
  assert.equal(info.length, 1, 'candidate de-duplicated across pages');
  assert.ok(Number(info[0].sources_count) >= 2, 'corroboration counted');
  assert.equal(info[0].organization, 'Alpha Audit Partners Ltd');
  assert.equal(info[0].consent_status, 'NOT_ESTABLISHED');
  assert.ok(cands.some((c) => c.email === 'beta@beta.co.ug'), 'cf email candidate');
  assert.ok(cands.some((c) => c.email === 'hello@flaky.ug'), 'retried page produced data');
  assert.ok(cands.some((c) => c.email === 'secretariat@dir.example.ug'));
  assert.ok(cands.some((c) => !c.email && c.phone === '+256414999888'), 'organisation-only candidate for page without e-mail');
  assert.ok(!cands.some((c) => /example\.com|2x\.png/.test(c.email)));

  rt.fresh();
  const m = rt.ctx.oceGetMission_(mission.mission_id);
  assert.match(m.status, /^COMPLETED/);
  assert.equal(m.progress, 100);
  assert.ok(m.candidates_found >= 5);

  rt.fresh();
  rt.ctx.oceTick();
  assert.equal(rt.state.triggers.length, 0, 'idle automation removes its trigger');
});

test('stale leases are recovered and repeated failures end as FAILED', () => {
  const rt = setupRuntime();
  rt.on('https://slow.example.ug/', html('ok', 'fine'));
  rt.fresh();
  const mission = rt.ctx.oceCreateMission_('x', { seeds: ['https://slow.example.ug/'], skip_discovery: true });
  const q = rt.sheet('SOURCE_QUEUE');
  const h = q.data[0];
  q.data[1][h.indexOf('status')] = 'SCRAPING';
  q.data[1][h.indexOf('lease_until')] = new Date(WORKDAY_10AM.getTime() - 60000);
  rt.fresh();
  const s = rt.ctx.oceRunWorker_({ max_seconds: 60 });
  assert.equal(s.recovered, 1);
  assert.equal(s.completed, 1);
  assert.equal(rt.sheet('SOURCE_QUEUE').objects()[0].status, 'COMPLETED');
  assert.ok(mission.mission_id);
});

test('login walls and bot challenges are reported as BLOCKED, non-HTML as SKIPPED', () => {
  const rt = setupRuntime();
  rt.on('https://w.example.ug/a', html('Sign in', '<form action="/login" class="login"><input type="password"></form>'));
  rt.on('https://w.example.ug/b', html('Just a moment...', '<div id="cf-challenge">checking</div>'));
  rt.on('https://w.example.ug/c', { status: 200, headers: { 'Content-Type': 'application/pdf' }, body: '%PDF' });
  rt.on('https://w.example.ug/d', { status: 403, body: 'no' });
  rt.on('https://w.example.ug/e', html('Contact', '<form><div class="g-recaptcha"></div></form><a href="mailto:a@w.example.ug">a</a>'));
  rt.fresh();
  const out = rt.ctx.oceFetchMany_(['a', 'b', 'c', 'd', 'e'].map((x) => 'https://w.example.ug/' + x));
  assert.deepEqual(plain(out.map((o) => o.status)), ['BLOCKED', 'BLOCKED', 'SKIPPED', 'BLOCKED', 'OK']);
});

test('huge pages never break the sheet (50k cell limit) and scraped formulas are neutralised', () => {
  const rt = setupRuntime();
  rt.on('https://big.example.ug/', html('=HYPERLINK("http://evil")', '<p>' + 'x'.repeat(200000) + '</p><a href="mailto:big@big.example.ug">m</a>'));
  rt.fresh();
  rt.ctx.oceCreateMission_('big', { seeds: ['https://big.example.ug/'], skip_discovery: true });
  rt.fresh();
  const s = rt.ctx.oceRunWorker_({ max_seconds: 60 });
  assert.equal(s.completed, 1);
  const res = rt.sheet('SOURCE_RESULTS').objects()[0];
  assert.ok(String(res.title).startsWith("'="), 'formula escaped');
  assert.ok(String(res.text_excerpt).length <= 1500);
});

/* ------------------------------------------------------------------ review, contacts, campaigns, delivery */

function seedContacts(rt) {
  mountFakeWeb(rt);
  rt.fresh();
  rt.ctx.oceCreateMission_('Audit firms in Uganda', { seeds: ['https://dir.example.ug/members'], skip_discovery: true, max_pages: 12 });
  drain(rt);
  rt.fresh();
  const pending = rt.ctx.oceCandidatesPage_({ status: 'PENDING', page_size: 100 }).items.filter((c) => c.email);
  return pending;
}

test('review gate: approval creates contacts; eligibility follows lawful basis and settings', () => {
  const rt = setupRuntime();
  const pending = seedContacts(rt);
  const alpha = pending.find((c) => c.email === 'info@alphaaudit.co.ug');
  const beta = pending.find((c) => c.email === 'beta@beta.co.ug');
  rt.fresh();
  assert.throws(() => rt.ctx.oceReviewCandidates_([alpha.candidate_id], 'APPROVE', { lawful_basis: 'CONSENT', consent_status: 'YES' }), /consent_source/);
  rt.fresh();
  rt.ctx.oceReviewCandidates_([alpha.candidate_id], 'APPROVE', { lawful_basis: 'CONSENT', consent_status: 'YES', consent_source: 'Signed up at 2026 expo' });
  rt.fresh();
  rt.ctx.oceReviewCandidates_([beta.candidate_id], 'APPROVE', { lawful_basis: 'LEGITIMATE_INTEREST' });
  rt.fresh();
  let contacts = rt.ctx.oceContactsPage_({}).items;
  assert.equal(contacts.length, 2);
  assert.equal(contacts.find((c) => c.email === 'info@alphaaudit.co.ug').eligible, true);
  assert.equal(contacts.find((c) => c.email === 'beta@beta.co.ug').eligibility_reason, 'NO_LAWFUL_BASIS');
  rt.fresh();
  rt.ctx.oceSetSetting_('ALLOW_LEGITIMATE_INTEREST', 'TRUE');
  rt.fresh();
  contacts = rt.ctx.oceContactsPage_({}).items;
  assert.equal(contacts.find((c) => c.email === 'beta@beta.co.ug').eligible, true);
  const cand = rt.sheet('CANDIDATES').objects().find((c) => c.email === 'info@alphaaudit.co.ug');
  assert.equal(cand.review_status, 'IMPORTED');
});

function readyCampaign(rt) {
  const pending = seedContacts(rt);
  rt.fresh();
  rt.ctx.oceReviewCandidates_(pending.map((c) => c.candidate_id), 'APPROVE', { lawful_basis: 'CONSENT', consent_status: 'YES', consent_source: 'Expo sign-up sheet' });
  rt.fresh();
  rt.ctx.oceApplySettings_({ DEFAULT_FROM_EMAIL: 'hello@odoch.example', DEFAULT_FROM_NAME: 'Odoch', SENDER_POSTAL_ADDRESS: 'Plot 1, Kampala, Uganda' });
  rt.fresh();
  const seg = rt.ctx.oceSaveSegment_({ segment_name: 'Ugandan firms', rules: [{ field: 'email', operator: 'ends_with', value: '.ug' }] });
  rt.fresh();
  const cmp = rt.ctx.oceSaveCampaign_({ name: 'Launch', segment_id: seg.segment_id, subject: 'Hello {{first_name|there}} at {{organization}}', body_html: '<p>Hi {{first_name|there}},</p><p>News for <b>{{organization}}</b>.</p>' });
  return { cmp, seg };
}

test('segments, queue and DRY_RUN delivery simulate without contacting any provider', () => {
  const rt = setupRuntime();
  const { cmp, seg } = readyCampaign(rt);
  assert.ok(seg.audience >= 3);
  rt.fresh();
  const view = rt.ctx.oceSetCampaignStatus_(cmp.campaign_id, 'ACTIVE');
  assert.equal(view.queue.pending, seg.audience);
  rt.state.fetchLog.length = 0;
  rt.fresh();
  const run = rt.ctx.oceRunDelivery_({});
  assert.equal(run.mode, 'DRY_RUN');
  assert.equal(run.simulated, seg.audience);
  assert.equal(rt.state.fetchLog.length, 0, 'no network in DRY_RUN');
  rt.fresh();
  const after = rt.ctx.oceListCampaigns_()[0];
  assert.equal(after.status, 'COMPLETED');
  rt.fresh();
  const preview = rt.ctx.ocePreviewCampaign_(cmp.campaign_id);
  assert.match(preview.html, /action=unsubscribe&(amp;)?t=/);
  assert.match(preview.html, /Plot 1, Kampala, Uganda/);
});

test('production delivery is gated, then sends through Resend with idempotency, caps and retries', () => {
  const rt = setupRuntime();
  const { cmp, seg } = readyCampaign(rt);
  rt.fresh();
  rt.ctx.oceApplySettings_({ DELIVERY_MODE: 'PRODUCTION', SEND_ENABLED: 'TRUE', DAILY_SEND_LIMIT: '2' });
  rt.fresh();
  rt.ctx.oceSetCampaignStatus_(cmp.campaign_id, 'ACTIVE');
  rt.fresh();
  assert.match(rt.ctx.oceRunDelivery_({}).skipped, /Production not approved/);
  rt.state.properties.OCE_PRODUCTION_APPROVED = 'TRUE';
  rt.fresh();
  assert.match(rt.ctx.oceRunDelivery_({}).skipped, /RESEND_API_KEY/);
  rt.state.properties.RESEND_API_KEY = 're_test';

  let calls = 0;
  const bodies = [];
  rt.on('https://api.resend.com/emails/batch', (url, opts) => {
    calls++;
    bodies.push({ headers: opts.headers, payload: JSON.parse(opts.payload) });
    if (calls === 1) return { status: 429, body: '{"message":"rate limited"}' };
    return { status: 200, body: JSON.stringify({ data: JSON.parse(opts.payload).map((_, i) => ({ id: 'msg_' + calls + '_' + i })) }) };
  });
  rt.fresh();
  const first = rt.ctx.oceRunDelivery_({});
  assert.equal(first.sent, 0, '429 is retried later, not failed');
  // let the retry window pass
  const sq = rt.sheet('SEND_QUEUE'); const h = sq.data[0]; sq.data.slice(1).forEach((r) => { r[h.indexOf('next_attempt_at')] = ''; });
  rt.fresh();
  const second = rt.ctx.oceRunDelivery_({});
  assert.equal(second.sent, 2, 'daily limit of 2 respected');
  const payload = bodies[1].payload;
  assert.equal(payload.length, 2);
  assert.match(bodies[1].headers['Idempotency-Key'], /^oce-[0-9a-f]{48}$/);
  assert.equal(payload[0].from, 'Odoch <hello@odoch.example>');
  assert.match(payload[0].headers['List-Unsubscribe'], /action=unsubscribe/);
  assert.equal(payload[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(!/\{\{/.test(payload[0].subject + payload[0].html), 'all placeholders rendered');
  rt.fresh();
  assert.match(rt.ctx.oceRunDelivery_({}).campaigns[0].skipped, /Daily limit/);
  const log = rt.sheet('SEND_LOG').objects().filter((r) => r.event === 'SENT');
  assert.equal(log.length, 2);
  assert.ok(seg.audience > 2);
});

test('sending window, weekends and holidays block production sends', () => {
  const saturday = setupRuntime({ now: new Date('2026-11-28T07:00:00Z') });
  saturday.fresh();
  assert.equal(saturday.ctx.oceSendingBlockedReason_('DRY_RUN'), 'Weekend');
  const night = setupRuntime({ now: new Date('2026-11-25T18:00:00Z') });
  night.fresh();
  assert.equal(night.ctx.oceSendingBlockedReason_('DRY_RUN'), 'Outside sending window');
  const christmas = setupRuntime({ now: new Date('2026-12-25T07:00:00Z') });
  christmas.fresh();
  assert.match(christmas.ctx.oceSendingBlockedReason_('DRY_RUN'), /Holiday: Christmas/);
});

test('one-click unsubscribe (GET and RFC 8058 POST) suppresses; tampered tokens are rejected', () => {
  const rt = setupRuntime();
  const { cmp } = readyCampaign(rt);
  rt.fresh();
  const token = rt.ctx.oceUnsubscribeToken_('info@alphaaudit.co.ug', cmp.campaign_id);
  rt.fresh();
  const bad = rt.ctx.doGet({ parameter: { action: 'unsubscribe', t: token.slice(0, -2) + 'aa' } });
  assert.match(bad.getContent(), /invalid/i);
  rt.fresh();
  const good = rt.ctx.doGet({ parameter: { action: 'unsubscribe', t: token } });
  assert.match(good.getContent(), /unsubscribed/i);
  const sup = rt.sheet('SUPPRESSION').objects();
  assert.equal(sup.length, 1);
  assert.equal(sup[0].reason, 'UNSUBSCRIBED');
  rt.fresh();
  const c = rt.ctx.oceContactsPage_({ q: 'alphaaudit' }).items.find((x) => x.email === 'info@alphaaudit.co.ug');
  assert.equal(c.status, 'UNSUBSCRIBED');
  assert.equal(c.eligible, false);
  rt.fresh();
  const t2 = rt.ctx.oceUnsubscribeToken_('beta@beta.co.ug', cmp.campaign_id);
  rt.fresh();
  const post = JSON.parse(rt.ctx.doPost({ parameter: { action: 'unsubscribe', t: t2 }, postData: { contents: 'List-Unsubscribe=One-Click' } }).getContent());
  assert.equal(post.ok, true);
  rt.fresh();
  assert.equal(rt.ctx.oceUpdateContacts_([c.contact_id], { status: 'ACTIVE' }).updated, 0, 'an opt-out can never be re-activated');
});

test('Resend webhooks: hard bounces and complaints suppress; webhook key required', () => {
  const rt = setupRuntime();
  readyCampaign(rt);
  const key = rt.state.properties.OCE_WEBHOOK_KEY;
  rt.fresh();
  const denied = JSON.parse(rt.ctx.doPost({ parameter: { action: 'webhook', key: 'nope' }, postData: { contents: '{}' } }).getContent());
  assert.equal(denied.ok, false);
  rt.fresh();
  rt.ctx.doPost({ parameter: { action: 'webhook', provider: 'resend', key }, postData: { contents: JSON.stringify({ type: 'email.bounced', data: { email_id: 'm1', to: ['info@alphaaudit.co.ug'], bounce: { type: 'Permanent' } } }) } });
  rt.fresh();
  rt.ctx.doPost({ parameter: { action: 'webhook', provider: 'resend', key }, postData: { contents: JSON.stringify({ type: 'email.bounced', data: { email_id: 'm2', to: ['beta@beta.co.ug'], bounce: { type: 'Transient' } } }) } });
  rt.fresh();
  rt.ctx.doPost({ parameter: { action: 'webhook', provider: 'resend', key }, postData: { contents: JSON.stringify({ type: 'email.complained', data: { email_id: 'm3', to: ['secretariat@dir.example.ug'] } }) } });
  const sup = rt.sheet('SUPPRESSION').objects().map((r) => r.email + ':' + r.reason).sort();
  assert.deepEqual(sup, ['info@alphaaudit.co.ug:HARD_BOUNCE', 'secretariat@dir.example.ug:COMPLAINT']);
});

test('CSV import never upgrades consent silently and validates rows', () => {
  const rt = setupRuntime();
  rt.fresh();
  const r1 = rt.ctx.oceImportCsv_('Email,Full Name,Company,Consent,Consent Source\nann@x.ug,Dr Ann Mukasa,X Ltd,yes,Webinar form\nbad-email,,,\nbob@y.ug,Bob,Y Ltd,,', { source: 'Webinar' });
  assert.deepEqual([r1.created, r1.skipped], [2, 1]);
  rt.fresh();
  const r2 = rt.ctx.oceImportCsv_('email,consent\nann@x.ug,\n', {});
  assert.equal(r2.updated, 1);
  rt.fresh();
  const ann = rt.ctx.oceContactsPage_({ q: 'ann@' }).items[0];
  assert.equal(ann.consent_status, 'YES', 'blank consent in a later import does not erase consent');
  assert.equal(ann.first_name, 'Ann');
  assert.equal(ann.eligible, true);
  const bob = rt.ctx.oceContactsPage_({ q: 'bob@' }).items[0];
  assert.equal(bob.eligible, false);
});

/* ------------------------------------------------------------------ API */

test('API: health is public, everything else needs the key; writes require POST', () => {
  const rt = setupRuntime();
  const key = rt.state.properties.OCE_API_KEY;
  assert.equal(rt.api('GET', { action: 'health' }).ok, true);
  assert.match(rt.api('GET', { action: 'dashboard' }).error, /Unauthorized/);
  assert.match(rt.api('GET', { action: 'scan.url', url: 'https://x.ug' }).error, /Unauthorized/, 'no open proxy');
  assert.equal(rt.api('GET', { action: 'dashboard', key }).ok, true);
  assert.match(rt.api('GET', { action: 'missions.create', key, objective: 'x' }).error, /Use POST/);
  rt.on('https://m.example.ug/', html('M', 'hello'));
  const created = rt.api('POST', { action: 'missions.create', key, objective: 'Clinics in Kampala', seeds: 'https://m.example.ug/', skip_discovery: 'true' });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.data.status, 'RUNNING');
  const settings = rt.api('POST', { action: 'settings.set', key, settings: { VERSION: '9' } });
  assert.match(settings.error, /not editable/);
  const secrets = rt.api('GET', { action: 'settings.get', key }).data.secrets;
  assert.ok(secrets.every((s) => !('value' in s)), 'secret values are never returned');
});

test('discovery: search results ranked, deny-listed hosts removed, catalogue seeds by geography', () => {
  const rt = setupRuntime();
  rt.on(/bing\.com\/search/, { status: 200, body: `<rss><channel>
    <item><title>Registered audit firms directory - ICPAU</title><link>https://www.icpau.co.ug/members/firms</link><description>Directory of registered audit firms in Uganda</description></item>
    <item><title>Audit firm Facebook</title><link>https://facebook.com/somefirm</link><description>x</description></item>
    <item><title>Top 10 audit firms 2025 blog</title><link>https://blog.example.com/2025/01/top</link><description>news</description></item>
  </channel></rss>` });
  rt.fresh();
  const d = rt.ctx.oceDiscover_('Audit firms in Uganda', 10);
  assert.ok(d.via.includes('bing-rss') && d.via.includes('catalog'));
  assert.ok(!d.seeds.some((s) => /facebook/.test(s.url)));
  assert.ok(d.seeds.some((s) => /icpauportal\.com/.test(s.url)), 'catalogue seed for UG audit');
  const perSite = {};
  d.seeds.forEach((s) => { const site = rt.ctx.oceSiteOf_(s.url); perSite[site] = (perSite[site] || 0) + 1; });
  assert.ok(Object.values(perSite).every((n) => n <= 2), 'site diversity');
});

/* ------------------------------------------------------------------ migration */

test('v1 data is migrated in place: missions, queue columns, stuck items and candidates', () => {
  const rt = createRuntime({ now: WORKDAY_10AM });
  const ss = rt.ctx.SpreadsheetApp.create('OCE — Source Intelligence Data');
  rt.state.properties.OCE_SPREADSHEET_ID = ss.getId();
  const runs = ss.insertSheet('SCOUT_RUNS');
  runs.appendRow(['run_id', 'started_at', 'completed_at', 'seed_count', 'discovered_count', 'queued_count', 'failed_count', 'topic', 'status', 'progress']);
  runs.appendRow(['run-1', new Date('2026-11-02'), '', 6, 30, 20, 2, 'Auditor firms in Uganda', 'COLLECTING', 40]);
  const q = ss.insertSheet('SOURCE_QUEUE');
  q.appendRow(['queue_id', 'source_id', 'url', 'priority', 'status', 'queued_at', 'started_at', 'completed_at', 'attempt_count', 'last_error', 'source']);
  q.appendRow(['q1', 's1', 'https://icpau.co.ug/firms', 90, 'SCRAPING', new Date(), new Date(), '', 0, '', 'DISCOVERY_INTELLIGENCE|mission_id=run-1']);
  q.appendRow(['q2', 's2', 'https://icpau.co.ug/firms/a', 60, 'COMPLETED', new Date(), new Date(), new Date(), 0, '', 'DISCOVERED_PAGE|mission_id=run-1']);
  const ci = ss.insertSheet('CONTACT_INTELLIGENCE');
  ci.appendRow(['candidate_id', 'source_id', 'source_url', 'email', 'phone', 'person_name', 'role', 'organization', 'address', 'country', 'location', 'category', 'evidence', 'confidence']);
  ci.appendRow(['c1', 's2', 'https://icpau.co.ug/firms/a', 'A@Firm.co.ug', '0772000111', '', '', 'A Firm', '', 'Uganda', 'Kampala', 'ACCOUNTING_AUDIT', 'x', 'HIGH']);
  ci.appendRow(['c2', 's2', 'https://icpau.co.ug/firms/b', 'a@firm.co.ug', '', '', '', 'A Firm', '', 'Uganda', 'Kampala', 'ACCOUNTING_AUDIT', 'x', 'MEDIUM']);
  rt.state.triggers.push({ getHandlerFunction: () => 'runOceMissionBatch' }, { getHandlerFunction: () => 'runOceMissionBatch' });

  const report = rt.call('oceSetup');
  assert.equal(report.legacy_triggers_removed, 2);
  assert.deepEqual(plain(report.migration), { missions: 1, queue_rows: 2, candidates: 1, stuck_reset: 1 });
  const queue = rt.sheet('SOURCE_QUEUE').objects();
  assert.equal(queue[0].status, 'QUEUED');
  assert.equal(queue[0].mission_id, 'run-1');
  const m = rt.sheet('MISSIONS').objects()[0];
  assert.equal(m.status, 'PAUSED');
  const cand = rt.sheet('CANDIDATES').objects();
  assert.equal(cand.length, 1);
  assert.equal(cand[0].email, 'a@firm.co.ug');
  assert.equal(cand[0].sources_count, 2);
  assert.equal(rt.call('oceSetup').migration.skipped, 'already migrated');
});

test('organisation names come from the meaningful part of page titles; street names are not cities', () => {
  const rt = setupRuntime();
  rt.fresh();
  const o = rt.ctx.oceOrgFromTitle_;
  assert.equal(o('Registered Member Firms | Demo Accountants Association'), 'Demo Accountants Association');
  assert.equal(o('Contact Us | Alpha Audit Partners'), 'Alpha Audit Partners');
  assert.equal(o('Home - Acme Uganda Ltd'), 'Acme Uganda Ltd');
  assert.equal(o('Delta Tax Advisors — Mbarara'), 'Delta Tax Advisors');
  assert.equal(o('Members'), '');
  assert.equal(rt.ctx.oceDetectCity_('Office: Plot 12 Jinja Road, Kampala'), 'Kampala');
  assert.equal(rt.ctx.oceDetectCity_('Branch in Gulu'), 'Gulu');
});

test('politeness: one host is paced >= 1 s (or its Crawl-delay) and capped per tick; other hosts proceed in parallel', () => {
  const rt = setupRuntime();
  const times = {};
  const stamp = (host) => { (times[host] = times[host] || []).push(rt.ctx.Date.now()); };
  rt.on('https://slowhost.example.ug/robots.txt', { status: 200, body: 'User-agent: *\nCrawl-delay: 3\n' });
  rt.on(/^https:\/\/slowhost\.example\.ug\/p\/\d+$/, (url) => { stamp('slow'); const n = +url.split('/').pop(); return html('Slow ' + n, [1, 2, 3, 4].map((k) => `<a href="/p/${n * 4 + k}">p</a>`).join('')); });
  rt.on(/^https:\/\/fasthost\.example\.ug\/p\/\d+$/, (url) => { stamp('fast'); const n = +url.split('/').pop(); return html('Fast ' + n, [1, 2, 3, 4].map((k) => `<a href="/p/${n * 4 + k}">p</a>`).join('')); });
  rt.fresh();
  rt.ctx.oceCreateMission_('pace', { seeds: ['https://slowhost.example.ug/p/0', 'https://fasthost.example.ug/p/0'], skip_discovery: true, max_pages: 500, max_depth: 5 });
  rt.fresh();
  rt.ctx.oceSetSetting_('CRAWL_PER_HOST_PER_TICK', '10');
  rt.fresh();
  rt.ctx.oceRunWorker_({ max_seconds: 120 });
  const gaps = (arr) => arr.slice(1).map((t, i) => t - arr[i]);
  assert.equal(times.fast.length, 10, 'per-tick cap');
  assert.ok(gaps(times.fast).every((g) => g >= 1000), 'fast host spaced >= 1s: ' + gaps(times.fast));
  assert.ok(times.slow.length >= 5 && times.slow.length <= 10);
  assert.ok(gaps(times.slow).every((g) => g >= 3000), 'crawl-delay honoured: ' + gaps(times.slow));
});
