// OCE Collector Gateway V2
// Browser-facing gateway: URL -> scan result.
// No collector token is ever sent to the browser.
// Public/authorized pages only. No login, CAPTCHA, paywall or access-control bypass.

function doGet(e) {
  try {
    var url = String((e && e.parameter && e.parameter.url) || '').trim();
    if (!url) return gatewayJson_({ok:false,error:'URL is required'});
    var result = scrapeUrl_(url);
    return gatewayJson_({ok:true,result:result});
  } catch (err) {
    return gatewayJson_({ok:false,error:String(err.message || err)});
  }
}

function gatewayJson_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
