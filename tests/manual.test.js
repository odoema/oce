/*
 * Keeps the in-app guide (web/manual.js -> web/help.html) in step with the app.
 * If one of these fails, update web/manual.js: see docs/manual.md.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function loadManual() {
  const ctx = { window: {} };
  vm.runInNewContext(read('web/manual.js'), ctx);
  return ctx.window.OCE_MANUAL;
}
function loadConfig() {
  const ctx = {};
  vm.runInNewContext(read('apps-script/00_Config.gs') + '\n;this.__oce = OCE; this.__settings = OCE_DEFAULT_SETTINGS;', ctx);
  return { version: ctx.__oce.VERSION, settings: ctx.__settings };
}
// Visible text of the dashboard (markup + labels rendered by app.js), entities decoded, spaces collapsed.
function dashboardText() {
  const html = read('web/index.html').replace(/<[^>]+>/g, ' ');
  const js = read('web/app.js') + ' ' + read('web/assistant.js');
  return (html + ' ' + js).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
}

const M = loadManual();
const C = loadConfig();
const FIX = ' → update web/manual.js (see docs/manual.md)';

test('guide version matches the app version everywhere', () => {
  assert.strictEqual(M.version, C.version, 'web/manual.js version' + FIX);
  assert.strictEqual(JSON.parse(read('package.json')).version, C.version, 'package.json version');
  const html = read('web/index.html') + read('web/help.html');
  const stamps = [...html.matchAll(/\?v=([\d.]+)/g)].map((m) => m[1]);
  assert.ok(stamps.length >= 4, 'cache-busting ?v= stamps present');
  stamps.forEach((v) => assert.strictEqual(v, C.version, 'stale ?v=' + v + ' in index.html/help.html'));
  const vs = C.settings.find((r) => r[0] === 'VERSION');
  assert.strictEqual(vs[1], C.version, 'OCE_DEFAULT_SETTINGS VERSION');
});

test('"What\'s new" has an entry for the current version, and the changelog too', () => {
  assert.ok(Array.isArray(M.whatsNew[C.version]) && M.whatsNew[C.version].length, 'whatsNew[' + C.version + ']' + FIX);
  assert.ok(read('CHANGELOG.md').includes('## ' + C.version), 'CHANGELOG.md has no "## ' + C.version + '" section');
});

test('every dashboard tab is covered by a guide chapter', () => {
  const views = [...read('web/index.html').matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(views.length >= 6);
  const covered = new Set(M.chapters.flatMap((c) => c.covers));
  views.forEach((v) => assert.ok(covered.has(v), 'dashboard tab "' + v + '" has no chapter' + FIX));
  M.chapters.forEach((c) => assert.ok(views.includes(c.open), 'chapter ' + c.id + ' opens unknown tab ' + c.open));
});

test('every button and field the guide names still exists in the dashboard', () => {
  const text = dashboardText();
  const labels = new Set();
  Object.values(M.mockScreens).forEach((s) => s.items.forEach((i) => labels.add(i.label)));
  M.chapters.forEach((c) => (c.ui || []).forEach((l) => labels.add(l)));
  const missing = [...labels].filter((l) => !text.includes(l));
  assert.deepStrictEqual(missing, [], 'renamed or removed in the dashboard: ' + missing.join(' | ') + FIX);
});

test('walkthrough steps only point at things drawn on their mock screen', () => {
  M.chapters.forEach((c) => (c.steps || []).forEach((s, i) => {
    const sc = M.mockScreens[s.mock.screen];
    assert.ok(sc, c.id + ' step ' + (i + 1) + ': unknown screen ' + s.mock.screen);
    const labels = sc.items.map((x) => x.label);
    if (s.mock.click) assert.ok(labels.includes(s.mock.click), c.id + ' step ' + (i + 1) + ': "' + s.mock.click + '" not on the ' + s.mock.screen + ' mock');
    if (s.mock.type) assert.ok(labels.includes(s.mock.type.into), c.id + ' step ' + (i + 1) + ': "' + s.mock.type.into + '" not on the mock');
  }));
});

test('the settings reference lists exactly the engine settings, with the same defaults', () => {
  const engine = new Map(C.settings.map((r) => [r[0], String(r[1])]));
  const guide = new Map(M.settings.map((s) => [s.key, String(s.def)]));
  const missing = [...engine.keys()].filter((k) => !guide.has(k));
  const extra = [...guide.keys()].filter((k) => !engine.has(k));
  assert.deepStrictEqual(missing, [], 'settings missing from the guide: ' + missing.join(', ') + FIX);
  assert.deepStrictEqual(extra, [], 'settings in the guide that no longer exist: ' + extra.join(', ') + FIX);
  engine.forEach((def, k) => assert.strictEqual(guide.get(k), def, 'default of ' + k + ' differs' + FIX));
  M.settings.forEach((s) => assert.ok(s.plain && s.plain.length > 8, s.key + ' needs a plain explanation'));
});

test('assistant logic: objectives, intents and answers behave', () => {
  const ctx = { window: { OCE_MANUAL: M } };
  vm.runInNewContext(read('web/guide-logic.js'), ctx);
  const G = ctx.window.OCE_GUIDE;
  assert.strictEqual(G.judgeObjective('Banks in Uganda').level, 'good');
  assert.strictEqual(G.judgeObjective('Audit firms in Kampala, Uganda').level, 'good');
  assert.ok(G.judgeObjective('Hotels').needsCountry);
  assert.ok(G.judgeObjective('Companies in Uganda').tooBroad);
  assert.strictEqual(G.intent('find hotels in Kampala'), 'find');
  assert.strictEqual(G.intent('I want to send an email to my list'), 'campaign');
  assert.strictEqual(G.intent('upload my csv'), 'import');
  assert.strictEqual(G.intent('how do unsubscribes work?'), 'question');
  assert.ok(G.answer('why is my mission empty').length, 'answers a common question from the manual');
  ['start', 'b2b', 'customer'].forEach((k) => assert.ok(G.BASIS[G.BASIS[k].yes] && G.BASIS[G.BASIS[k].no], 'basis tree ' + k));
});

test('PDF reading: the Drive advanced service is declared (enables the Drive API) and scopes stay narrow', () => {
  const m = JSON.parse(read('apps-script/appsscript.json'));
  const svc = (m.dependencies && m.dependencies.enabledAdvancedServices) || [];
  assert.ok(svc.some((s) => s.serviceId === 'drive'), 'Drive advanced service declared');
  assert.ok(m.oauthScopes.includes('https://www.googleapis.com/auth/drive.file'));
  assert.ok(!m.oauthScopes.includes('https://www.googleapis.com/auth/drive'), 'no full-Drive scope');
});

test('help page scripts parse and the guide loads with no browser errors', () => {
  ['web/help.js', 'web/assistant.js', 'web/guide-logic.js'].forEach((f) => new vm.Script(read(f), { filename: f }));
  assert.ok(read('web/help.html').includes('manual.js') && read('web/index.html').includes('help.html'), 'dashboard links to the guide');
});
