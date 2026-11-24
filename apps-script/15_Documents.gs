/**
 * 15_Documents: public PDF documents (member lists, directories, registers, tender notices).
 *
 *  - A PDF reached by a mission (or scanned on its own) is converted to text by Google Drive's free
 *    built-in converter, which also reads scanned pages (OCR). The temporary Google Doc is deleted at once.
 *  - Lists hold many organisations, so each e-mail gets its OWN context: the organisation name and phone
 *    come from the lines around that e-mail, not from the document title.
 *  - Needs the narrow Drive scope `drive.file` (only files OCE itself creates). Setting CRAWL_PDFS turns it off.
 *  - Limits: Google reads scanned PDFs best under 2 MB and OCRs only their first 10 pages. Text PDFs convert fully.
 */

var OCE_DOCS = {
  PDF_TYPES: /application\/(pdf|x-pdf)|application\/acrobat/i,
  MAX_PDF_BYTES: 10 * 1024 * 1024,
  MAX_PDFS_PER_RUN: 4,
  MAX_LIST_CANDIDATES: 400,
  FREE_MAIL: /(^|\.)(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|proton|protonmail|zoho|mail|gmx|yandex)\.[a-z.]+$/i,
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
    throw new Error('PDF reading needs a one-time permission: open the Apps Script editor, run oceSetup and click Allow.');
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
    var windowLines = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 3));
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

/** The organisation an entry belongs to: the nearest line above (or on) the e-mail that reads like a name. */
function oceListEntryName_(lines, i, email) {
  var onLine = lines[i].replace(email, ' ').replace(/(e-?mail|email|tel|phone|mob|fax|p\.?\s?o\.?\s?box)\s*[:.]?/ig, ' ')
    .replace(/[\w.+-]+@[\w.-]+/g, ' ').replace(/\+?\d[\d\s()\/-]{6,}/g, ' ')
    .replace(/^\s*\d+[.)]\s*/, '').replace(/(\s*[,;:|\/-]\s*)+/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '').replace(/\s+/g, ' ').trim();
  if (oceLooksLikeName_(onLine)) return oceClean_(onLine, 120);
  for (var k = i - 1; k >= Math.max(0, i - 4); k--) {
    var l = lines[k];
    if (!l || /@/.test(l)) break; // previous entry
    if (oceLooksLikeName_(l)) return oceClean_(l.replace(/^\s*\d+[.)]\s*/, ''), 120);
  }
  return '';
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
