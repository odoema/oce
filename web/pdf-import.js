/*
 * OCE PDF import: reads a PDF of any length by splitting it in the browser into pieces Google can convert
 * (at most 10 pages and under 2 MB each), then sending the pieces one at a time to the engine
 * (action documents.import). Splitting happens on this computer, so it costs nothing and uses no quota.
 * Uses pdf-lib (MIT, web/vendor/pdf-lib.min.js), loaded only when needed.
 */
(function (root) {
  'use strict';
  const LIMITS = { maxPages: 10, maxBytes: 1.9 * 1024 * 1024, maxFileBytes: 200 * 1024 * 1024 };

  /**
   * Splits PDF bytes into pieces of at most maxPages pages and (where possible) maxBytes bytes.
   * A piece that is still too big is halved until it fits or is a single page.
   * @return {Promise<Array<{from:number,to:number,bytes:Uint8Array}>>} 1-based page ranges
   */
  async function splitPdf(PDFLib, bytes, opts) {
    const o = Object.assign({}, LIMITS, opts || {});
    const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const total = src.getPageCount();
    const ranges = [];
    for (let s = 0; s < total; s += o.maxPages) ranges.push([s, Math.min(total, s + o.maxPages) - 1]);
    const out = [];
    async function build(a, b) {
      const doc = await PDFLib.PDFDocument.create();
      const idx = [];
      for (let i = a; i <= b; i++) idx.push(i);
      (await doc.copyPages(src, idx)).forEach((p) => doc.addPage(p));
      const piece = await doc.save({ useObjectStreams: true });
      if (piece.length > o.maxBytes && b > a) {
        const mid = Math.floor((a + b) / 2);
        await build(a, mid);
        await build(mid + 1, b);
      } else {
        out.push({ from: a + 1, to: b + 1, bytes: piece });
      }
    }
    for (const [a, b] of ranges) await build(a, b);
    return { total, pieces: out };
  }

  function toBase64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  let libPromise = null;
  function loadPdfLib() {
    if (root.PDFLib) return Promise.resolve(root.PDFLib);
    if (!libPromise) {
      libPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/pdf-lib.min.js';
        s.onload = () => resolve(root.PDFLib);
        s.onerror = () => reject(new Error('Could not load the PDF tool. Check your internet connection and try again.'));
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  /**
   * Reads a PDF File end to end. onProgress({phase, done, total, found, message}) is called as it goes.
   * @return {Promise<{pages:number, pieces:number, found:number, created:number, failed:Array}>}
   */
  async function importPdf(file, opts, onProgress) {
    opts = opts || {};
    const report = (p) => { try { onProgress && onProgress(p); } catch (e) { /* ignore */ } };
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Please choose a PDF file.');
    if (file.size > LIMITS.maxFileBytes) throw new Error('This PDF is larger than 200 MB. Split it into parts (for example, by chapter) and read them one after another.');
    report({ phase: 'split', done: 0, total: 0, found: 0, message: 'Preparing the PDF…' });
    const PDFLib = await loadPdfLib();
    let split;
    try { split = await splitPdf(PDFLib, new Uint8Array(await file.arrayBuffer())); } catch (e) {
      throw new Error('This PDF could not be opened (' + (e.message || e) + '). If it is password-protected, remove the password and try again.');
    }
    const res = { pages: split.total, pieces: split.pieces.length, found: 0, created: 0, failed: [] };
    for (let i = 0; i < split.pieces.length; i++) {
      const p = split.pieces[i];
      report({ phase: 'read', done: i, total: split.pieces.length, found: res.found, message: `Reading pages ${p.from}–${p.to} of ${split.total}…` });
      let attempt = 0;
      for (;;) {
        try {
          const r = await post('documents.import', { name: file.name, from: p.from, to: p.to, pages: split.total, data: toBase64(p.bytes), tags: opts.tags || '' });
          res.found += r.found || 0;
          res.created += r.created || 0;
          break;
        } catch (e) {
          if (++attempt >= 3) { res.failed.push({ from: p.from, to: p.to, error: e.message }); break; }
          await new Promise((ok) => setTimeout(ok, 2000 * attempt));
        }
      }
    }
    report({ phase: 'done', done: split.pieces.length, total: split.pieces.length, found: res.found, message: 'Done' });
    return res;
  }

  const api = { splitPdf, importPdf, toBase64, LIMITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ocePdfImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
