'use strict';
/** Syntax-checks every Apps Script and dashboard file, and fails on duplicate global names
 *  (Apps Script shares one global scope, so a duplicate silently overwrites the other file). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let failed = false;
const globals = {};
for (const dir of ['apps-script', 'web']) {
  for (const f of fs.readdirSync(path.join(root, dir)).filter((x) => /\.(gs|js)$/.test(x))) {
    const src = fs.readFileSync(path.join(root, dir, f), 'utf8');
    try { new vm.Script(src, { filename: `${dir}/${f}` }); } catch (e) { failed = true; console.error(`${dir}/${f}: ${e.message}`); }
    if (dir === 'apps-script') {
      for (const m of src.matchAll(/^(?:function|var|const|let)\s+([A-Za-z0-9_$]+)/gm)) {
        if (globals[m[1]]) { failed = true; console.error(`Duplicate global "${m[1]}" in ${f} and ${globals[m[1]]}`); }
        globals[m[1]] = f;
      }
    }
  }
}
JSON.parse(fs.readFileSync(path.join(root, 'apps-script', 'appsscript.json'), 'utf8'));
if (failed) process.exit(1);
console.log(`OK: ${Object.keys(globals).length} Apps Script globals, no duplicates, all files parse.`);
