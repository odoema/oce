'use strict';
/**
 * Minimal, faithful-enough Google Apps Script runtime for Node tests.
 * Loads every apps-script/*.gs file into one shared V8 context (like Apps Script does)
 * and provides in-memory SpreadsheetApp, UrlFetchApp, PropertiesService, CacheService,
 * LockService, ScriptApp, Utilities, ContentService and HtmlService.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function toSigned(buf) { return Array.from(buf, (b) => (b > 127 ? b - 256 : b)); }
function toBuffer(bytes) { return Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))); }

class Range {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined || v === null ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.nr) throw new Error(`setValues rows mismatch: ${values.length} vs ${this.nr}`);
    values.forEach((line, r) => {
      if (line.length !== this.nc) throw new Error(`setValues cols mismatch: ${line.length} vs ${this.nc}`);
      line.forEach((v, c) => {
        if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
        if (v !== null && typeof v === 'object' && !(v instanceof Date)) throw new Error('Unsupported cell value');
        this.sheet.set(this.row + r, this.col + c, v);
      });
    });
    this.sheet.writes++;
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  getValue() { return this.getValues()[0][0]; }
  setFontWeight() { return this; }
  setNumberFormat() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; this.writes = 0; }
  getName() { return this.name; }
  set(row, col, v) {
    while (this.data.length < row) this.data.push([]);
    const line = this.data[row - 1];
    while (line.length < col) line.push('');
    line[col - 1] = v;
  }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i].some((v) => v !== '' && v !== null && v !== undefined)) return i + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.data.forEach((line) => { for (let i = line.length - 1; i >= 0; i--) if (line[i] !== '' && line[i] !== undefined) { max = Math.max(max, i + 1); break; } });
    return max;
  }
  getRange(row, col, nr = 1, nc = 1) {
    if (row < 1 || col < 1 || nr < 1 || nc < 1) throw new Error(`Invalid range ${row},${col},${nr},${nc}`);
    return new Range(this, row, col, nr, nc);
  }
  appendRow(values) { this.getRange(this.getLastRow() + 1, 1, 1, values.length).setValues([values]); return this; }
  setFrozenRows() { return this; }
  autoResizeColumns() { return this; }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  /** test helper: rows as objects */
  objects() {
    const [h, ...rows] = this.data;
    return rows.filter((r) => r.some((v) => v !== '')).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] === undefined ? '' : r[i]])));
  }
}

class Spreadsheet {
  constructor(name, id) { this.name = name; this.id = id; this.sheets = {}; }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { if (this.sheets[n]) throw new Error('Sheet exists: ' + n); this.sheets[n] = new Sheet(n); return this.sheets[n]; }
  getSheets() { return Object.values(this.sheets); }
}

class HttpResponse {
  constructor({ status = 200, headers = {}, body = '' }) { this.status = status; this.headers = headers; this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8'); }
  getResponseCode() { return this.status; }
  getHeaders() { return this.headers; }
  getContentText() { return this.body.toString('utf8'); }
  getBlob() { const b = this.body; return { getBytes: () => toSigned(b), getDataAsString: (cs) => b.toString(cs && /8859|latin/i.test(cs) ? 'latin1' : 'utf8') }; }
}

function createRuntime(opts = {}) {
  const state = {
    spreadsheets: {},
    properties: {},
    cache: {},
    triggers: [],
    fetchLog: [],
    routes: [],
    now: opts.now || null,
    clockOffset: 0,
    serviceUrl: opts.serviceUrl === undefined ? 'https://script.google.com/macros/s/TEST/exec' : opts.serviceUrl
  };
  let idCounter = 0;

  function route(url, options) {
    state.fetchLog.push({ url, options });
    for (const r of state.routes) {
      const m = typeof r.match === 'string' ? url === r.match : r.match.test(url);
      if (m) {
        const res = typeof r.respond === 'function' ? r.respond(url, options) : r.respond;
        if (res instanceof Error) throw res;
        return new HttpResponse(res);
      }
    }
    if (/\/robots\.txt$/.test(url)) return new HttpResponse({ status: 404, body: 'not found' });
    return new HttpResponse({ status: 404, body: 'no route for ' + url });
  }

  const SpreadsheetApp = {
    create(name) { const id = 'ss' + (++idCounter); state.spreadsheets[id] = new Spreadsheet(name, id); return state.spreadsheets[id]; },
    openById(id) { if (!state.spreadsheets[id]) throw new Error('Not found'); return state.spreadsheets[id]; },
    getActiveSpreadsheet() { return null; },
    getActive() { return null; },
    getUi() { throw new Error('No UI in tests'); }
  };

  const UrlFetchApp = {
    fetch(url, options = {}) { return route(url, options); },
    fetchAll(requests) { return requests.map((r) => route(r.url, r)); }
  };

  const props = {
    getProperty: (k) => (Object.prototype.hasOwnProperty.call(state.properties, k) ? state.properties[k] : null),
    setProperty: (k, v) => { state.properties[k] = String(v); return props; },
    deleteProperty: (k) => { delete state.properties[k]; return props; },
    getProperties: () => ({ ...state.properties })
  };
  const PropertiesService = { getScriptProperties: () => props };

  const cacheObj = {
    get: (k) => (state.cache[k] === undefined ? null : state.cache[k]),
    put: (k, v) => { state.cache[k] = String(v); },
    remove: (k) => { delete state.cache[k]; }
  };
  const CacheService = { getScriptCache: () => cacheObj };

  const lock = { held: false, tryLock() { if (this.held) return false; this.held = true; return true; }, waitLock() { this.held = true; }, releaseLock() { this.held = false; } };
  const LockService = { getScriptLock: () => lock };

  function TriggerBuilder(handler) {
    const t = { handler, everyMinutes: null };
    const b = {
      timeBased: () => b,
      everyMinutes: (m) => { t.everyMinutes = m; return b; },
      everyHours: (h) => { t.everyMinutes = h * 60; return b; },
      create: () => { const trig = { getHandlerFunction: () => handler, ...t }; state.triggers.push(trig); return trig; }
    };
    return b;
  }
  const ScriptApp = {
    getProjectTriggers: () => state.triggers.slice(),
    deleteTrigger: (t) => { state.triggers = state.triggers.filter((x) => x !== t); },
    newTrigger: (h) => TriggerBuilder(h),
    getService: () => ({ getUrl: () => state.serviceUrl })
  };

  const Utilities = {
    getUuid: () => crypto.randomUUID(),
    sleep: (ms) => { state.clockOffset += Number(ms) || 0; },
    formatDate(date, tz, fmt) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' })
        .formatToParts(date).map((p) => [p.type, p.value]));
      const dow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
      return fmt.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day).replace('HH', parts.hour)
        .replace(/\bH\b/, String(Number(parts.hour))).replace('mm', parts.minute).replace('ss', parts.second).replace(/\bu\b/, String(dow));
    },
    computeHmacSha256Signature: (msg, key) => toSigned(crypto.createHmac('sha256', key).update(msg, 'utf8').digest()),
    computeDigest: (_alg, msg) => toSigned(crypto.createHash('sha256').update(msg, 'utf8').digest()),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    base64EncodeWebSafe: (s) => Buffer.from(String(s), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) => toSigned(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: (bytes) => ({ getDataAsString: (cs) => toBuffer(bytes).toString(cs && /8859|latin/i.test(cs) ? 'latin1' : 'utf8'), getBytes: () => bytes }),
    parseCsv(text) {
      const rows = []; let row = []; let cur = ''; let q = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
        else cur += ch;
      }
      if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
      return rows;
    }
  };

  const ContentService = {
    MimeType: { JSON: 'JSON' },
    createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent() { return this.text; } })
  };
  const HtmlService = { createHtmlOutput: (html) => ({ html, setTitle() { return this; }, getContent() { return this.html; } }) };

  const logs = [];
  const context = {
    SpreadsheetApp, UrlFetchApp, PropertiesService, CacheService, LockService, ScriptApp, Utilities, ContentService, HtmlService,
    Logger: { log: (m) => logs.push(String(m)) },
    console: { log: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) },
    Date, JSON, Math, Object, Array, String, Number, RegExp, Error, Boolean, Infinity, isFinite, isNaN, parseInt, parseFloat,
    encodeURIComponent, decodeURIComponent
  };
  // Virtual clock: starts at opts.now (or real now), follows real elapsed time, and jumps forward on Utilities.sleep().
  {
    const RealDate = Date;
    const base = state.now ? state.now.getTime() : RealDate.now();
    const realStart = RealDate.now();
    const clock = () => base + (RealDate.now() - realStart) + state.clockOffset;
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(clock()); } static now() { return clock(); } }
    context.Date = FakeDate;
  }
  vm.createContext(context);
  const dir = path.join(__dirname, '..', 'apps-script');
  fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort().forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), context, { filename: f });
  });

  return {
    ctx: context,
    state,
    logs,
    /** Simulates a new Apps Script execution (per-execution memo is reset). */
    fresh() { context.__oceRuntime = {}; return context; },
    on(match, respond) { state.routes.unshift({ match, respond }); return this; },
    db() { return state.spreadsheets[state.properties.OCE_SPREADSHEET_ID]; },
    sheet(name) { return this.db().getSheetByName(name); },
    call(fn, ...args) { this.fresh(); return context[fn](...args); },
    api(method, params) {
      this.fresh();
      const out = method === 'GET' ? context.doGet({ parameter: params }) : context.doPost({ parameter: {}, postData: { contents: JSON.stringify(params) } });
      return JSON.parse(out.getContent());
    }
  };
}

module.exports = { createRuntime, HttpResponse };
