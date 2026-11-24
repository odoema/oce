/**
 * 01_Store: one spreadsheet, header-mapped tables, buffered batch writes.
 *
 * Every table is read once per execution, mutated in memory and flushed with
 * the minimum number of setValues() calls. Columns are addressed by header
 * name, so operators may reorder or add columns without breaking OCE.
 */

/** Returns the OCE data spreadsheet, creating and remembering it on first use. */
function oceDb_() {
  var cache = oceRuntimeCache_();
  if (cache.db) return cache.db;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(OCE.SPREADSHEET_PROPERTY);
  var ss = null;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; }
  }
  if (!ss) {
    var active = null;
    try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (err) { active = null; }
    ss = active || SpreadsheetApp.create(OCE.SPREADSHEET_NAME);
    props.setProperty(OCE.SPREADSHEET_PROPERTY, ss.getId());
  }
  cache.db = ss;
  return ss;
}

/** Ensures every schema sheet exists with its headers. Safe to run repeatedly. */
function oceEnsureSchema_() {
  var ss = oceDb_();
  Object.keys(OCE_SCHEMA).forEach(function (name) {
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    oceEnsureHeaders_(sheet, OCE_SCHEMA[name]);
  });
  var t = oceTable_('SETTINGS');
  var have = {};
  t.all().forEach(function (r) { have[r.key] = true; });
  var missing = OCE_DEFAULT_SETTINGS.filter(function (r) { return !have[r[0]]; })
    .map(function (r) { return { key: r[0], value: r[1], description: r[2] }; });
  if (missing.length) t.append(missing);
  var version = t.find(function (r) { return r.key === 'VERSION'; });
  if (version && String(version.value) !== OCE.VERSION) t.update(version, { value: OCE.VERSION });
  t.flush();
  delete oceRuntimeCache_().settings;
  return ss;
}

function oceEnsureHeaders_(sheet, headers) {
  var changed = false;
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    changed = true;
  } else {
    var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
    if (missing.length) { sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]); changed = true; }
  }
  if (changed) {
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
  }
}

/** Cached per-execution table handle. */
function oceTable_(name) {
  var cache = oceRuntimeCache_();
  cache.tables = cache.tables || {};
  if (!cache.tables[name]) cache.tables[name] = new OceTable_(name);
  return cache.tables[name];
}

/** Flushes every table touched in this execution. */
function oceFlushAll_() {
  var tables = (oceRuntimeCache_().tables) || {};
  Object.keys(tables).forEach(function (k) { tables[k].flush(); });
}

/** Drops cached tables so the next access re-reads the sheet (used after taking a lock). */
function oceResetTables_() {
  var cache = oceRuntimeCache_();
  if (cache.tables) Object.keys(cache.tables).forEach(function (k) { cache.tables[k].flush(); });
  cache.tables = {};
  delete cache.settings;
  delete cache.queueState;
  delete cache.suppression;
}

function OceTable_(name) {
  var ss = oceDb_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    if (!OCE_SCHEMA[name]) throw new Error('Unknown table: ' + name);
    sheet = ss.insertSheet(name);
  }
  if (OCE_SCHEMA[name]) oceEnsureHeaders_(sheet, OCE_SCHEMA[name]);
  this.name = name;
  this.sheet = sheet;
  var width = sheet.getLastColumn();
  this.headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  this.index = {};
  var self = this;
  this.headers.forEach(function (h, i) { if (h && self.index[h] === undefined) self.index[h] = i; });
  var lastRow = sheet.getLastRow();
  var values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
  this.rows = values.map(function (v, i) { return self._toObject(v, i + 2); });
  this.nextRow = lastRow + 1;
  this.dirty = {};
  this.pending = [];
}

OceTable_.prototype._toObject = function (values, rowNumber) {
  var obj = {};
  for (var i = 0; i < this.headers.length; i++) {
    if (this.headers[i]) obj[this.headers[i]] = values[i] === undefined ? '' : values[i];
  }
  Object.defineProperty(obj, '__row', { value: rowNumber, enumerable: false, writable: true });
  Object.defineProperty(obj, '__raw', { value: values, enumerable: false, writable: true });
  return obj;
};

OceTable_.prototype._toValues = function (obj) {
  var raw = obj.__raw ? obj.__raw.slice() : [];
  while (raw.length < this.headers.length) raw.push('');
  for (var i = 0; i < this.headers.length; i++) {
    var h = this.headers[i];
    if (!h || !Object.prototype.hasOwnProperty.call(obj, h)) continue;
    raw[i] = oceCellValue_(obj[h]);
  }
  return raw;
};

OceTable_.prototype.all = function () { return this.rows; };
OceTable_.prototype.filter = function (fn) { return this.rows.filter(fn); };
OceTable_.prototype.find = function (fn) {
  for (var i = 0; i < this.rows.length; i++) if (fn(this.rows[i])) return this.rows[i];
  return null;
};
OceTable_.prototype.count = function (fn) {
  if (!fn) return this.rows.length;
  var n = 0;
  for (var i = 0; i < this.rows.length; i++) if (fn(this.rows[i])) n++;
  return n;
};

/** Builds (and memoises) a key -> row map. Keys are compared as trimmed strings. */
OceTable_.prototype.keyed = function (field) {
  this._keyed = this._keyed || {};
  if (!this._keyed[field]) {
    var map = {};
    this.rows.forEach(function (r) {
      var k = String(r[field] === undefined ? '' : r[field]).trim();
      if (k && !map[k]) map[k] = r;
    });
    this._keyed[field] = map;
  }
  return this._keyed[field];
};

OceTable_.prototype.get = function (field, value) {
  return this.keyed(field)[String(value === undefined ? '' : value).trim()] || null;
};

OceTable_.prototype.update = function (obj, patch) {
  var self = this;
  Object.keys(patch || {}).forEach(function (k) {
    if (self.index[k] === undefined) return;
    var old = obj[k];
    obj[k] = patch[k];
    if (self._keyed && self._keyed[k]) {
      var oldKey = String(old === undefined ? '' : old).trim();
      if (self._keyed[k][oldKey] === obj) delete self._keyed[k][oldKey];
      var newKey = String(patch[k] === undefined ? '' : patch[k]).trim();
      if (newKey && !self._keyed[k][newKey]) self._keyed[k][newKey] = obj;
    }
  });
  if (obj.__row) this.dirty[obj.__row] = obj;
  return obj;
};

OceTable_.prototype.append = function (objects) {
  var self = this;
  var out = [];
  (objects || []).forEach(function (o) {
    var obj = self._toObject(self.headers.map(function () { return ''; }), self.nextRow++);
    Object.keys(o).forEach(function (k) { if (self.index[k] !== undefined) obj[k] = o[k]; });
    self.rows.push(obj);
    self.pending.push(obj);
    if (self._keyed) Object.keys(self._keyed).forEach(function (f) {
      var key = String(obj[f] === undefined ? '' : obj[f]).trim();
      if (key && !self._keyed[f][key]) self._keyed[f][key] = obj;
    });
    out.push(obj);
  });
  return out;
};

OceTable_.prototype.flush = function () {
  var self = this;
  var width = this.headers.length;
  var pendingRows = {};
  this.pending.forEach(function (o) { pendingRows[o.__row] = true; });
  var rowNumbers = Object.keys(this.dirty).map(Number).filter(function (n) { return !pendingRows[n]; }).sort(function (a, b) { return a - b; });
  var i = 0;
  while (i < rowNumbers.length) {
    var start = rowNumbers[i];
    var block = [this._toValues(this.dirty[start])];
    while (i + 1 < rowNumbers.length && rowNumbers[i + 1] === rowNumbers[i] + 1) {
      i++;
      block.push(this._toValues(this.dirty[rowNumbers[i]]));
    }
    this.sheet.getRange(start, 1, block.length, width).setValues(block);
    block.forEach(function (v, j) { self.dirty[start + j].__raw = v; });
    i++;
  }
  this.dirty = {};
  if (this.pending.length) {
    var first = this.pending[0].__row;
    var values = this.pending.map(function (o) { return self._toValues(o); });
    this.sheet.getRange(first, 1, values.length, width).setValues(values);
    this.pending.forEach(function (o, j) { o.__raw = values[j]; });
    this.pending = [];
  }
};

/** Converts a JS value to something a sheet cell accepts, enforcing the 50k character cell limit. */
function oceCellValue_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return isFinite(v) ? v : '';
  if (typeof v === 'object') v = JSON.stringify(v);
  var s = String(v);
  if (s.length > 45000) s = s.slice(0, 45000) + '…[truncated]';
  // Prevent formula injection from scraped content.
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) && !/^\+\d[\d\s]*$/.test(s)) s = "'" + s;
  return s;
}

/** Structured operational log (EVENTS sheet + Stackdriver). Never throws. */
function oceLog_(level, component, message, data) {
  try {
    console.log('[OCE][' + level + '][' + component + '] ' + message + (data ? ' ' + JSON.stringify(data) : ''));
    oceTable_('EVENTS').append([{ timestamp: new Date(), level: level, component: component, message: String(message).slice(0, 1000), data: data ? JSON.stringify(data).slice(0, 5000) : '' }]);
  } catch (err) { /* logging must never break a workflow */ }
}
