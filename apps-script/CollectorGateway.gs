// OCE Collector Gateway V3
// Canonical browser-facing Apps Script entry point.
// URL -> public source scan.
// No collector token is sent to the browser.
// Public/authorized pages only. No login, CAPTCHA, paywall or access-control bypass.

function doGet(e) {
  try {
    var url = String((e && e.parameter && e.parameter.url) || '').trim();
    if (!url) return gatewayJson_({ok:false,error:'URL is required'});

    var result = scrapeUrl_(url);
    return gatewayJson_({ok:true,result:result});
  } catch (err) {
    return gatewayJson_({ok:false,error:formatCollectorError_(err)});
  }
}

function gatewayJson_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function formatCollectorError_(err) {
  var message = String((err && err.message) || err || 'Unknown error');
  if (/^Source returned HTTP 401$/.test(message)) return 'Source requires authentication (HTTP 401).';
  if (/^Source returned HTTP 403$/.test(message)) return 'Source refused automated collection (HTTP 403). No bypass was attempted.';
  if (/^Source returned HTTP 404$/.test(message)) return 'Source was not found (HTTP 404).';
  if (/^Source returned HTTP 429$/.test(message)) return 'Source is rate limiting automated requests (HTTP 429).';
  if (/^Source returned HTTP 5\d\d$/.test(message)) return 'Source server returned an error (' + message.replace('Source returned HTTP ', 'HTTP ') + ').';
  return message;
}
