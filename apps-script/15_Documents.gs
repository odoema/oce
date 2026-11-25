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
 *  - Limits: Google OCRs scanned PDFs only up to about 2 MB / 10 pages, so the dashboard's "Read a PDF list"
 *    splits uploads into such pieces in the browser (web/pdf-import.js) and sends them here one by one.
 *    Crawled PDFs: up to 50 MB (Apps Script download limit); text PDFs convert fully.
 */

var OCE_DOCS = {
  PDF_TYPES: /application\/(pdf|x-pdf)|application\/acrobat/i,
  MAX_PDF_BYTES: 50 * 1024 * 1024, // Apps Script cannot download more than about 50 MB
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
  if (bytes.length > OCE_DOCS.MAX_PDF_BYTES) { o.status = 'SKIPPED'; o.error = 'PDF larger than 50 MB: download it and use "Read a PDF list" in the dashboard'; return; }
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
  if (bytes.length > 2 * 1024 * 1024 && o.text.replace(/\s+/g, '').length < 200) {
    // Google only OCRs scanned PDFs up to about 2 MB / 10 pages; the dashboard upload splits them so every page is read.
    o.status = 'SKIPPED';
    o.error = 'Large scanned PDF: download it and use "Read a PDF list" in the dashboard to read every page';
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

/**
 * One piece of an uploaded PDF (split in the browser by web/pdf-import.js): converts it and saves the
 * contacts it lists as candidates for review. Pieces are independent, so a failed piece can be resent.
 * @param {{name:string, from:number, to:number, pages:number, data:string, tags?:string}} p data = base64 PDF bytes
 */
function oceImportPdfPiece_(p) {
  var name = oceClean_(p.name || 'upload.pdf', 120);
  var data = String(p.data || '');
  if (!data) throw new Error('Missing parameter: data');
  if (data.length > 4 * 1024 * 1024) throw new Error('This piece is too large (over 3 MB). The dashboard splits PDFs automatically; please reload it and try again.');
  var bytes = Utilities.base64Decode(data);
  if (!oceIsPdfResponse_('', bytes, '')) throw new Error('That piece is not a PDF.');
  var range = 'pages ' + Number(p.from || 1) + '–' + Number(p.to || p.from || 1);
  var text = ocePdfToText_(bytes, name + ' ' + range);
  var source = 'upload:' + name + '#' + range.replace(/\s/g, '');
  var ctx = { doc_name: name + ' (' + range + ')', mission_id: '' };
  var register = oceLooksLikeRegister_(text);
  var list = register ? oceBuildRegisterCandidates_(text, source, ctx) : oceBuildListCandidates_(text, source, ctx);
  var withContact = list.filter(function (c) { return c.email || c.phone; }).length;
  if (p.tags) list.forEach(function (c) { c.category = c.category || ''; c.evidence = oceClean_(c.evidence + ' | tags: ' + p.tags, 600); });
  var up = oceUpsertCandidates_(list);
  oceLog_('INFO', 'documents', 'Uploaded PDF ' + name + ' ' + range + ': ' + list.length + ' contacts', { created: up.created });
  oceFlushAll_();
  return { name: name, from: Number(p.from || 1), to: Number(p.to || 1), characters: String(text || '').length, found: list.length, created: up.created,
    with_contact: withContact, organisations_only: list.length - withContact, register: register };
}

/* ---------------------------------------------------------------- registers (lists without e-mails) */

var OCE_REGISTER = {
  // Where an address starts inside an entry (also used to split "NAME ADDRESS" written on one line).
  ADDRESS_START: /(\b\d+(st|nd|rd|th)\s+floor\b|\bground floor\b|\bfloor\b|\bplot\b|\bsuite\b|\broom\b|\brm\b|\bblock\b|\bp\.?\s?o\.?\s?box\b|\bbox\s+\d|\bopp(osite)?\.?\b|\bnext to\b|\bnear\b|\bbehind\b|\boff\b\s+\w+\s+(road|rd|street)|\b[\w'’-]+\s+(house|h['’]se|building|bldg|plaza|tower|towers|towers|centre|center|complex|mall|arcade|chambers|court|courts|estate|market|square|heights|headquarters|hotel)\b|\b[\w'’-]+\s+(road|rd|street|st|avenue|ave|lane|close|crescent|drive|bypass|way)\b)/i,
  NAME_END: /\b(advocates?|solicitors?|consultants?|& co\.?|and co\.?|company|associates|partners|ltd|limited|llp|plc|inc|chambers|group|firm|department|dept|unit|division|directorate)\)?\.?\s*$/i,
  NAME_THEN_ADDRESS: /^(.*?\b(advocates?|solicitors?|consultants?|& co\.?|ltd|limited|associates|partners|department)\)?\.?)\s+(?=\S[^,]*,)/i,
  PLACES: ['kampala', 'wakiso', 'mukono', 'entebbe', 'jinja', 'gulu', 'lira', 'mbarara', 'hoima', 'masaka', 'fort portal', 'arua', 'mbale', 'kabale', 'iganga', 'busia', 'tororo', 'soroti',
    'luwero', 'kayunga', 'masindi', 'mityana', 'mubende', 'kasese', 'bushenyi', 'ntungamo', 'rukungiri', 'kitgum', 'moroto', 'kotido', 'nebbi', 'pakwach', 'koboko', 'yumbe',
    'adjumani', 'moyo', 'kapchorwa', 'pallisa', 'kumi', 'kamuli', 'bugiri', 'mayuge', 'kalangala', 'rakai', 'lyantonde', 'sembabule', 'mpigi', 'butambala', 'gomba', 'kiboga',
    'kyankwanzi', 'nakaseke', 'nakasongola', 'kiruhura', 'ibanda', 'isingiro', 'kisoro', 'kanungu', 'kagadi', 'kibaale', 'kyenjojo', 'kamwenge', 'bundibugyo', 'ntoroko',
    'apac', 'kole', 'oyam', 'dokolo', 'amolatar', 'alebtong', 'otuke', 'pader', 'agago', 'amuru', 'nwoya', 'omoro', 'napak', 'nakapiripirit', 'amudat', 'kaabong', 'abim',
    'katakwi', 'amuria', 'kaberamaido', 'serere', 'ngora', 'bukedea', 'budaka', 'butaleja', 'namutumba', 'luuka', 'buyende', 'kaliro', 'namayingo', 'bududa', 'manafwa',
    'sironko', 'bulambuli', 'kween', 'bukwo', 'buikwe', 'buvuma', 'kyotera', 'kalungu', 'bukomansimbi', 'lwengo', 'lugazi', 'njeru', 'nansana', 'kira', 'makindye',
    'luweero', 'kyegegwa', 'mitooma', 'sheema', 'shema', 'rubirizi', 'buhweju', 'kazo', 'rwampara', 'kitagwenda', 'bunyangabu', 'kikuube', 'kakumiro',
    'namisindwa', 'butebo', 'bugweri', 'kapelebyong', 'kalaki', 'karenga', 'nabilatuk', 'obongi', 'terego', 'madi okollo', 'rubanda', 'kiryandongo', 'buliisa', 'zombo', 'maracha',
    'kyankwanzi', 'bukomansimbi', 'kabarole', 'kabwohe', 'ishaka', 'kanungu', 'kiboga', 'busembatya', 'nebbi', 'lugazi', 'matugga', 'gayaza', 'bweyogerere', 'mutundwe', 'najjera',
    'nairobi', 'mombasa', 'kisumu', 'kigali', 'dar es salaam', 'juba']
};

/**
 * Numbered registers (law firms, licensed practitioners, approved suppliers…): each entry becomes an
 * organisation lead with its name, address and town, plus any e-mail or phone it carries. Used when a
 * document lists many numbered entries but few e-mails.
 * @return {Object[]} candidates; leads without e-mail or phone have contact_level 'ORGANISATION_ONLY'
 */
function oceBuildRegisterCandidates_(text, url, ctx) {
  var entries = oceSplitRegisterEntries_(text);
  var docName = ctx && ctx.doc_name || '';
  var out = [];
  entries.forEach(function (lines) {
    var parsed = oceParseRegisterEntry_(lines);
    if (!parsed.name) return;
    var joined = lines.join('\n');
    var emails = oceCollectEmails_(joined, []);
    var phones = oceCollectPhones_(joined, []);
    var score = 40 + (parsed.address ? 8 : 0) + (parsed.location ? 4 : 0) + (emails.length ? 15 : 0) + (phones.length ? 10 : 0);
    out.push({
      email: emails[0] || '', phone: phones[0] || '', organization: parsed.name, website: emails[0] && !OCE_DOCS.FREE_MAIL.test(emails[0].split('@')[1]) ? 'https://' + emails[0].split('@')[1] : '',
      address: parsed.address, country: oceDetectCountry_(joined) || (parsed.location && OCE_REGISTER.PLACES.indexOf(parsed.location.toLowerCase()) >= 0 && OCE_REGISTER.PLACES.indexOf(parsed.location.toLowerCase()) < OCE_REGISTER.PLACES.indexOf('nairobi') ? 'Uganda' : ''),
      location: parsed.location, category: oceInferCategory_(parsed.name + ' ' + docName), person_name: '', role: '', source_url: url, mission_id: ctx && ctx.mission_id || '',
      confidence: Math.min(100, score), contact_level: emails.length || phones.length ? 'CONTACT' : 'ORGANISATION_ONLY',
      evidence: oceClean_('Listed in' + (docName ? ' "' + docName + '"' : ' a register') + ' as no. ' + parsed.number + ': ' + parsed.name + (parsed.address ? ', ' + parsed.address : '') + (parsed.location ? ', ' + parsed.location : '') +
        (emails.length || phones.length ? '' : ' (no e-mail or phone in the document)'), 600)
    });
  });
  return out;
}

/** Splits text into numbered entries ("12. NAME …" or "12." alone on a line). Headers before entry 1 are dropped. */
function oceSplitRegisterEntries_(text) {
  var lines = String(text || '').replace(/\t/g, '\n').split('\n').map(function (l) {
    // Table headings repeated on every page, sometimes glued to the line above ("… KAMPALA NO. LEGAL DEPARTMENT LOCATION DISTRICT").
    return l.replace(/\s+/g, ' ').replace(/\s*\bNO\.?\s+[A-Z' ]{0,40}?\bLOCATION\s+DISTRICT\b.*$/i, '').trim();
  }).filter(Boolean);
  var entries = [];
  var cur = null;
  lines.forEach(function (l) {
    var m = l.match(/^(\d{1,4})[.)]\s*(.*)$/);
    if (m && !/^\d{1,4}[.)]\s*\d/.test(l)) {
      if (cur) entries.push(cur);
      cur = [l];
      return;
    }
    if (/^(no\.?|s\/?n|#)?\s*(law firm|name|firm|organi[sz]ation|company|legal dep\w*)\b.*\b(location|address|district|town)\b/i.test(l) || /\blocation\s+district\s*$/i.test(l)) return; // repeated table header
    if (/^list of\b/i.test(l) && /\b(as at|as of|\d{4})\b/i.test(l)) return; // repeated page title
    if (cur) cur.push(l);
  });
  if (cur) entries.push(cur);
  return entries;
}

/** {number, name, address, location} from the lines of one register entry. */
function oceParseRegisterEntry_(lines) {
  var first = lines[0].match(/^(\d{1,4})[.)]\s*(.*)$/);
  var number = first ? first[1] : '';
  var rest = [first ? first[2] : lines[0]].concat(lines.slice(1)).filter(function (l) { return l; });
  var nameParts = [];
  var addrParts = [];
  var inAddress = false;
  rest.forEach(function (l) {
    if (inAddress) { addrParts.push(l); return; }
    // "A.L ADVOCATES 5TH FLOOR, PAN AFRICA HOUSE, …": split where the address starts.
    var m = l.match(OCE_REGISTER.ADDRESS_START);
    if (nameParts.length && m && m.index === 0) { addrParts.push(l); inAddress = true; return; } // a line that starts with an address
    var nt = !OCE_REGISTER.NAME_END.test(nameParts.join(' ')) ? l.match(OCE_REGISTER.NAME_THEN_ADDRESS) : null;
    if (nt && (!m || nt[1].length <= m.index)) {
      nameParts.push(nt[1].trim());
      addrParts.push(l.slice(nt[0].length).trim());
      inAddress = true;
      return;
    }
    var nameSoFar = nameParts.join(' ');
    var looksDone = OCE_REGISTER.NAME_END.test(nameSoFar);
    if (nameParts.length && looksDone && !/^\(/.test(l) && !/^(&|and)\b|^(advocates?|solicitors?|consultants?|legal|associates?|& co)\b/i.test(l)) {
      addrParts.push(l); inAddress = true; return; // the name is complete, so a new line starts the address
    }
    if (m && (m.index > 0 || nameParts.length) && (looksDone || m.index > 0)) {
      var before = l.slice(0, m.index).trim();
      if (before && !(nameParts.length && looksDone && !OCE_REGISTER.NAME_END.test(before) && before.split(' ').length > 3)) nameParts.push(before);
      else if (before) addrParts.push(before);
      addrParts.push(l.slice(m.index).trim());
      inAddress = true;
      return;
    }
    if (m && !nameParts.length) { addrParts.push(l); inAddress = true; return; }
    if (looksDone && !/^\(/.test(l) && !/^(&|and)\b|^(advocates?|solicitors?|consultants?|legal|associates?|& co)\b/i.test(l) && /,/.test(l)) {
      addrParts.push(l); inAddress = true; return;
    }
    nameParts.push(l);
  });
  var address = addrParts.join(' ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();
  // District/town: a trailing known place name (the last column of most registers).
  var location = '';
  var low = address.toLowerCase();
  var places = OCE_REGISTER.PLACES.slice().sort(function (a, b) { return b.length - a.length; });
  for (var i = 0; i < places.length; i++) {
    var p = places[i];
    if (low === p || (low.length > p.length && low.slice(-p.length - 1) === ' ' + p) || low.slice(-p.length - 1) === ',' + p) {
      location = p.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      address = address.slice(0, address.length - p.length).replace(/[\s,]+$/, '');
      break;
    }
  }
  if (!location && /^[A-Za-z' -]{3,20}$/.test(addrParts[addrParts.length - 1] || '') && addrParts.length > 1) {
    location = addrParts[addrParts.length - 1].replace(/\b\w+/g, function (w) { return w.charAt(0) + w.slice(1).toLowerCase(); });
    address = addrParts.slice(0, -1).join(' ');
  }
  var name = nameParts.join(' ').replace(/\s+/g, ' ').replace(/\s+([,.)])/g, '$1').trim();
  name = name.replace(/\b([A-Z][A-Z'’&.-]+)\b/g, function (w) { return w.length <= 3 && /^(&|CO\.?|LLP|PLC|LTD|AB|AN|AM|AD|AL)$/.test(w) ? w : w; });
  return { number: number, name: oceClean_(name, 160), address: oceClean_(address, 300), location: location };
}

/** True when a document reads like a numbered register rather than a contact list. */
function oceLooksLikeRegister_(text) {
  var numbered = (String(text || '').match(/(^|\n)\s*\d{1,4}[.)]\s/g) || []).length;
  var emails = (String(text || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).length;
  return numbered >= 5 && emails < numbered / 3;
}
