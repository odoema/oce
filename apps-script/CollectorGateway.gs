// OCE Collector Gateway V1
// Browser-facing gateway: URL -> scan result.
// No collector token is ever sent to the browser.
// Public/authorized pages only. No login, CAPTCHA, paywall or access-control bypass.
function doGet(e){
  try{
    const url=String((e&&e.parameter&&e.parameter.url)||'').trim();
    if(!url) return json_({ok:false,error:'URL is required'});
    return json_({ok:true,result:scrapeUrl_(url)});
  }catch(err){
    return json_({ok:false,error:String(err.message||err)});
  }
}
