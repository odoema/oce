/**
 * 15_Documents: public PDF documents (member lists, directories, registers, tender notices).
 *
 *  - A PDF reached by a mission (or scanned on its own) is converted to text by Google Drive's free
 *    built-in converter, which also reads scanned pages (OCR). The temporary Google Doc is deleted at once.
 *  - Lists hold many organisations, so each e-mail gets its OWN context: the organisation name and phone
 *    come from the lines around that e-mail, not from the document title.
 *  - Needs the narrow Drive scope `drive.file` (only files OCE itself creates). The Drive advanced service is
 *    declared in appsscript.json only so Google enables the Drive API for the script's hidden Cloud project.
 *    Setting CRAWL_PDFS turns PDF reading off.
 *  - Limits: Google reads scanned PDFs best under 2 MB and OCRs only their first 10 pages. Text PDFs convert fully.
 */

var OCE_DOCS = {
  PDF_TYPES: /application\/(pdf|x-pdf)|application\/acrobat/i,
  MAX_PDF_BYTES: 10 * 1024 * 1024,
  MAX_PDFS_PER_RUN: 4,
  MAX_LIST_CANDIDATES: 400,
  FREE_MAIL: /(^|\.)(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|proton|protonmail|zoho|mail|gmx|yandex)\.[a-z.]+$/i,
  ORG_HINT_STRONG: /\b(ltd|limited|plc|inc|llc|llp|company|associates|partners|& co|group|holdings|consult\w*|advocates|chartered|accountants|auditors|bank|sacco|foundation|trust|society|association|institute|university|college|school|hospital|clinic|polyclinic|klinik|medical|health|pharmacy|hotel|lodge|enterprises|services|solutions|agency|authority|ministry|council|embassy|mission|fellowship|international|centre for)\b/i,
  ORG_HINT: /\b(ltd|limited|plc|inc|llc|llp|co\.?|company|associates|partners|& co|group|holdings|consult\w*|advocates|chartered|accountants|auditors|bank|sacco|ngo|foundation|trust|society|association|institute|university|college|school|hospital|clinic|hotel|lodge|enterprises|services|solutions|agency|authority|ministry|council|uganda|kenya)\b/i
};

var oceDocsState_ = { converted: 0 };

/** True when the response is a PDF (by type, by magic bytes, or a .pdf URL served as binary). */
function oceIsPdfResponse_(contentType, bytes, url) {
  if (OCE_DOCS.PDF_TYPES.test(contentType || '')) return true;
  if (bytes && bytes.length > 4 && bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70) return true; // %PDF
  return /\.pdf(\?|#|$)/i.test(String(url || '')) && /octet-stream|binary|download/i.test(contentType || '');
}

/** Converts PDF bytes to plain text through Google Drive (temporary Google Doc, deleted afterwards). */
function ocePdfToText_(bytes, name) {
  var token = ScriptApp.getOAuthToken();
  var auth = { Authorization: 'Bearer ' + token };
  var boundary = 'oce' + oceUuid_().replace(/-/g, '');
  var meta = JSON.stringify({ name: 'OCE temp - ' + oceClean_(name || 'document', 80), mimeType: 'application/vnd.google-apps.document' });
  var head = Utilities.newBlob('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
    '\r\n--' + boundary + '\r\nContent-Type: application/pdf\r\n\r\n').getBytes();
  var tail = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();
  var up = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=en&fields=id', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: head.concat(bytes, tail), headers: auth, muteHttpExceptions: true
  });
  var code = up.getResponseCode();
  if (code === 401 || code === 403) {
    var why = String(up.getContentText() || '');
    throw new Error(/has not been used|is disabled|accessNotConfigured/i.test(why)
      ? 'PDF reading: the Google Drive API is not enabled yet for this script (it switches on with the next deploy; wait a few minutes and retry).'
      : 'PDF reading needs a one-time permission: open the Apps Script editor, run oceSetup and click Allow.');
  }
  if (code < 200 || code >= 300) throw new Error('PDF conversion failed (HTTP ' + code + ')');
  var id = oceParseJson_(up.getContentText(), {}).id;
  if (!id) throw new Error('PDF conversion returned no file');
  try {
    var ex = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '/export?mimeType=text%2Fplain', { headers: auth, muteHttpExceptions: true });
    if (ex.getResponseCode() !== 200) throw new Error('PDF text export failed (HTTP ' + ex.getResponseCode() + ')');
    return ex.getContentText();
  } finally {
    try { UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id), { method: 'delete', headers: auth, muteHttpExceptions: true }); } catch (e) { /* best effort */ }
  }
}

/** Fills a fetch outcome from a PDF response. Called by the fetcher. */
function oceClassifyPdf_(o, bytes) {
  if (!oceSettingBool_('CRAWL_PDFS', true)) { o.status = 'SKIPPED'; o.error = 'PDF reading is switched off (CRAWL_PDFS)'; return; }
  if (bytes.length > OCE_DOCS.MAX_PDF_BYTES) { o.status = 'SKIPPED'; o.error = 'PDF larger than 10 MB'; return; }
  if (oceDocsState_.converted >= OCE_DOCS.MAX_PDFS_PER_RUN) { o.status = 'RETRY'; o.error = 'PDF waits for the next round'; return; }
  oceDocsState_.converted++;
  var name = decodeURIComponent(String((oceParseUrl_(o.final_url || o.url) || {}).path || '').split('/').pop() || 'document.pdf');
  try {
    o.text = String(ocePdfToText_(bytes, name) || '').replace(/\r\n?/g, '\n').slice(0, 400000);
  } catch (err) {
    o.status = /permission/i.test(err.message) ? 'FAILED' : 'RETRY';
    o.error = String(err.message || err);
    oceLog_('WARN', 'documents', o.error, { url: o.final_url || o.url });
    return;
  }
  o.pdf = true;
  o.doc_name = name;
  var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  o.html = '<html><head><title>' + esc(name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ')) + '</title></head><body>' +
    o.text.split('\n').map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</body></html>';
  o.ok = true;
  o.status = 'OK';
}

/**
 * Candidates from a list-like document: each e-mail (or phone-only entry) gets the organisation name and
 * phone found in the lines around it.
 */
function oceBuildListCandidates_(text, url, ctx) {
  var lines = String(text || '').split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); });
  var docName = ctx && ctx.doc_name || '';
  var out = [];
  var seen = {};
  for (var i = 0; i < lines.length && out.length < OCE_DOCS.MAX_LIST_CANDIDATES; i++) {
    var emails = oceCollectEmails_(lines[i], []);
    if (!emails.length) continue;
    var bounds = oceListEntryBounds_(lines, i);
    var windowLines = lines.slice(bounds.start, bounds.end);
    var windowText = windowLines.join('\n');
    var phones = oceCollectPhones_(windowText, []);
    var org = oceListEntryName_(lines, i, emails[0]);
    emails.forEach(function (email) {
      if (seen[email]) return;
      seen[email] = true;
      var domain = email.split('@')[1];
      var score = 45;
      if (org) score += 12;
      if (phones.length) score += 10;
      if (!OCE_DOCS.FREE_MAIL.test(domain)) score += 8;
      if (/^(no-?reply|donotreply|bounce|mailer-daemon|postmaster|abuse|webmaster)/.test(email)) score -= 40;
      out.push({
        email: email, phone: phones[0] || '', organization: org,
        website: OCE_DOCS.FREE_MAIL.test(domain) ? '' : 'https://' + domain,
        address: '', country: oceDetectCountry_(windowText) || '', location: oceDetectCity_(windowText) || '', category: oceInferCategory_(org + ' ' + docName),
        person_name: '', role: '', source_url: url, mission_id: ctx && ctx.mission_id || '',
        confidence: Math.max(0, Math.min(100, score)),
        evidence: oceClean_('Found in PDF' + (docName ? ' "' + docName + '"' : '') + ', line ' + (i + 1) + ': ' + windowLines.join(' / '), 600)
      });
    });
  }
  return out;
}

/**
 * Lines that belong to the entry holding line i: back to just after the previous e-mail line (at most 6
 * lines, stopping at a blank line), forward until the next line with an e-mail (at most 2 lines).
 */
function oceListEntryBounds_(lines, i) {
  var start = i;
  for (var k = i - 1; k >= Math.max(0, i - 6); k--) { if (!lines[k] || /@/.test(lines[k])) break; start = k; }
  var end = i + 1;
  for (var j = i + 1; j < Math.min(lines.length, i + 3); j++) { if (!lines[j] || /@/.test(lines[j])) break; end = j + 1; }
  return { start: start, end: end };
}

/** Address-like lines: streets, plots, boxes, floors, or a bare place name. Never an organisation name. */
var OCE_ADDRESS_LINE = /\b(road|rd|street|st|avenue|ave|lane|close|drive|plot|p\.?\s?o\.?\s?box|box|floor|flr|suite|building|bldg|house|tower|plaza|centre|center|mall|arcade|industrial area|airfield|airport|garden|estate|village|district|kololo|nakasero|bugolobi|ntinda|naguru|muyenga|kansanga|wandegeya|kamwokya|kisementi|entebbe|kampala|nairobi|kigali|dar es salaam|uganda|kenya)\b|^\d{3,}\b|\b\d{5}\b/i;
function oceIsAddressLine_(s) {
  s = String(s || '');
  if (OCE_DOCS.ORG_HINT_STRONG.test(s)) return false;
  return OCE_ADDRESS_LINE.test(s);
}

/** The organisation an entry belongs to: the nearest line above (or on) the e-mail that reads like a name. */
function oceListEntryName_(lines, i, email) {
  var onLine = lines[i].replace(email, ' ').replace(/(e-?mail|email|tel|phone|mob|fax|p\.?\s?o\.?\s?box)\s*[:.]?/ig, ' ')
    .replace(/[\w.+-]+@[\w.-]+/g, ' ').replace(/\+?\d[\d\s()\/-]{6,}/g, ' ')
    .replace(/^\s*\d+[.)]\s*/, '').replace(/(\s*[,;:|\/-]\s*)+/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '').replace(/\s+/g, ' ').trim();
  if (oceLooksLikeName_(onLine) && !oceIsAddressLine_(onLine)) return oceClean_(onLine, 120);
  var fallback = '';
  for (var k = i - 1; k >= Math.max(0, i - 6); k--) {
    var l = lines[k];
    if (!l || /@/.test(l)) break; // previous entry
    var name = l.replace(/^\s*\d+[.)]\s*/, '');
    if (!oceLooksLikeName_(name) || oceIsAddressLine_(name)) continue;
    if (OCE_DOCS.ORG_HINT_STRONG.test(name)) return oceClean_(name, 120);
    fallback = fallback || name; // nearest plausible name; keep looking for a clearer organisation line above
  }
  return oceClean_(fallback, 120);
}

function oceLooksLikeName_(s) {
  s = String(s || '').replace(/^\s*\d+[.)]\s*/, '').trim();
  if (s.length < 3 || s.length > 120) return false;
  if (/@|https?:|www\./i.test(s)) return false;
  var letters = (s.match(/[A-Za-z]/g) || []).length;
  var digits = (s.match(/\d/g) || []).length;
  if (letters < 3 || digits > letters / 2) return false;
  if (/^(p\.?\s?o\.?\s?box|plot|tel|phone|fax|mob|email|e-mail|address|website|location|physical address|postal)\b/i.test(s)) return false;
  return OCE_DOCS.ORG_HINT.test(s) || /^[A-Z][A-Za-z&'.,-]+(\s+[A-Z&][A-Za-z&'.,-]*){0,8}$/.test(s) || s === s.toUpperCase();
}
