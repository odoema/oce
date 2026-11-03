/* OCE Discovery Compatibility
 * Small shared helpers required by Discovery Intelligence V3.
 * No crawler or queue behavior is changed here.
 */

const OC_DENY_HOST = /(^|\.)((facebook|instagram|linkedin|tiktok|youtube)\.com|x\.com|twitter\.com)$/i;

function ouCanonicalUrl_(value) {
  let url = String(value || '').trim();
  if (!/^https?:\/\//i.test(url)) return '';
  url = url.replace(/#.*$/, '');
  if (url.length > 2048) return '';
  return url;
}

function ouHostOf_(url) {
  const match = String(url || '').match(/^https?:\/\/([^\/?:#]+)/i);
  return match ? match[1].toLowerCase() : '';
}

function ouIsStaticAsset_(url) {
  return /\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|rar|7z|doc|docx|xls|xlsx|ppt|pptx|mp3|mp4|avi|mov)(?:$|\?)/i.test(String(url || ''));
}
