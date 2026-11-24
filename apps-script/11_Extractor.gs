/**
 * 11_Extractor: one pass over a page -> page intelligence + contact evidence.
 *
 * Handles mailto/tel links, Cloudflare-protected e-mails, common obfuscation
 * ("name [at] domain [dot] com"), schema.org JSON-LD (including @graph),
 * organisation/address heuristics and link scoring for the crawl frontier.
 */

var OCE_EXTRACT = {
  MAX_LINKS: 400,
  MAX_EMAILS: 60,
  MAX_PHONES: 40,
  TEXT_EXCERPT: 1500,
  BAD_EMAIL_DOMAINS: /(^|\.)(example\.(com|org|net)|domain\.com|email\.com|yourdomain\.|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|godaddy\.com|schema\.org|w3\.org|png|jpe?g|gif|webp|svg)$/i,
  BAD_EMAIL_LOCAL: /^(your|name|email|user|someone|firstname|lastname|john\.?doe|jane\.?doe|test)$/i,
  CONTACT_HINTS: /contact|about|team|staff|people|leadership|management|directory|member|listing|firm|compan|business|partner|office|location|branch|find|search|profile|supplier|vendor|service|provider|association|register|registry/i,
  NEGATIVE_HINTS: /login|log-in|signin|sign-in|signup|sign-up|register\/?$|cart|checkout|basket|account|password|privacy|cookie|terms|wp-admin|wp-login|feed|rss|calendar|print|share|sharer|intent\/|tag\/|author\/|\/page\/\d{2,}|replytocom|lang=|attachment/i
};

/**
 * @param {string} html
 * @param {string} url  final URL of the page
 * @return {Object} page intelligence
 */
function oceExtractPage_(html, url) {
  html = String(html || '');
  var head = html.slice(0, 60000);
  var title = oceClean_(oceDecodeEntities_((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''), 300);
  var description = oceClean_(oceDecodeEntities_(oceMetaContent_(head, ['description', 'og:description', 'twitter:description'])), 500);
  var siteName = oceClean_(oceDecodeEntities_(oceMetaContent_(head, ['og:site_name', 'application-name'])), 200);
  var lang = ((html.match(/<html[^>]+lang=["']?([a-z]{2,3})/i) || [])[1] || '').toLowerCase();
  var canonicalHref = (head.match(/<link[^>]+rel=["']canonical["'][^>]*>/i) || [''])[0].match(/href=["']([^"']+)["']/i);
  var base = (head.match(/<base[^>]+href=["']([^"']+)["']/i) || [])[1];
  var baseUrl = base ? (oceResolveUrl_(base, url) || url) : url;

  var cfEmails = [];
  html.replace(/data-cfemail=["']([0-9a-f]+)["']/gi, function (_, hex) { var e = oceDecodeCfEmail_(hex); if (e) cfEmails.push(e); return _; });
  html.replace(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi, function (_, hex) { var e = oceDecodeCfEmail_(hex); if (e) cfEmails.push(e); return _; });

  var jsonld = oceExtractJsonLd_(html);
  var links = oceExtractLinks_(html, baseUrl);
  var text = oceHtmlToText_(html);

  var mailtos = [], tels = [], socials = [];
  links.forEach(function (l) {
    if (l.kind === 'mailto') mailtos.push(l.href);
    else if (l.kind === 'tel') tels.push(l.href);
    else if (l.kind === 'web' && oceIsSocialUrl_(l.url)) socials.push(l.url);
  });

  var entities = oceJsonLdEntities_(jsonld);
  var emails = oceCollectEmails_(text, mailtos.concat(cfEmails).concat(entities.emails));
  var phones = oceCollectPhones_(text, tels.concat(entities.phones));
  var organization = entities.organization || siteName || oceLabeled_(text, ['company name', 'organisation', 'organization', 'firm name', 'business name']) ||
    oceOrgFromTitle_(title);
  var address = entities.address || oceLabeled_(text, ['physical address', 'office address', 'postal address', 'address', 'location', 'head office', 'visit us']);

  // <meta name="robots"> plus OCE/googlebot-specific variants; X-Robots-Tag is merged in by the worker.
  var robotsMeta = [oceMetaContent_(head, ['robots']), oceMetaContent_(head, ['oce']), oceMetaContent_(head, ['googlebot'])].join(',').toLowerCase();

  return {
    url: url,
    noindex: /\b(noindex|none)\b/.test(robotsMeta),
    nofollow: /\b(nofollow|none)\b/.test(robotsMeta),
    title: title,
    description: description,
    site_name: siteName,
    language: lang,
    canonical: canonicalHref ? oceResolveUrl_(canonicalHref[1], baseUrl) : '',
    links: links.filter(function (l) { return l.kind === 'web'; }),
    jsonld: jsonld,
    text: text,
    text_excerpt: text.slice(0, OCE_EXTRACT.TEXT_EXCERPT),
    emails: emails,
    mailto_emails: oceUnique_(mailtos.concat(cfEmails).map(oceEmailNormalize_)),
    phones: phones,
    socials: oceUnique_(socials).slice(0, 12),
    organization: oceClean_(organization, 200),
    address: oceClean_(address, 300),
    country: entities.country || oceDetectCountry_(text),
    location: entities.location || oceDetectCity_(text),
    person: entities.person,
    role: entities.role,
    category: oceInferCategory_(url + ' ' + title + ' ' + description + ' ' + entities.types.join(' ')),
    jsonld_types: entities.types,
    is_contact_page: /contact|about|reach|find-us|get-in-touch|location/i.test(url + ' ' + title)
  };
}

/**
 * Picks the organisation name out of a page title such as
 * "Contact Us | Alpha Audit Partners" or "Registered Member Firms | Demo Accountants Association".
 */
function oceOrgFromTitle_(title) {
  var parts = String(title || '').split(/\s+[|–—·•»:]\s+|\s+-\s+/).map(function (s) { return oceClean_(s, 160); }).filter(Boolean);
  if (!parts.length) return '';
  var orgSuffix = /\b(ltd|limited|llp|llc|inc|plc|co\.?|company|partners|associates|association|institute|council|authority|society|foundation|group|holdings|consult(ing|ants)?|advis(ors|ers|ory)|accountants|auditors|services|bank|hospital|clinic|school|university|college|ministry|agency|chambers|advocates|& co)\b/i;
  var generic = /^(home|homepage|welcome|contact( us)?|about( us)?|our team|team|services|members?|member firms|registered.*|directory|search|results|listing|listings|page \d+|find .*|news|blog|events?|gallery)$/i;
  var strong = parts.filter(function (p) { return orgSuffix.test(p) && !generic.test(p); });
  if (strong.length) return strong[strong.length - 1];
  var usable = parts.filter(function (p) { return !generic.test(p) && p.length > 2; });
  return usable.length ? usable[0] : '';
}

function oceMetaContent_(html, names) {
  for (var i = 0; i < names.length; i++) {
    var n = names[i].replace(/[.:]/g, '\\$&');
    var m = html.match(new RegExp('<meta[^>]+(?:name|property)=["\']' + n + '["\'][^>]*content=["\']([^"\']*)["\']', 'i')) ||
            html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:name|property)=["\']' + n + '["\']', 'i'));
    if (m && m[1]) return m[1];
  }
  return '';
}

function oceDecodeCfEmail_(hex) {
  try {
    var key = parseInt(hex.substr(0, 2), 16);
    var out = '';
    for (var i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ key);
    out = oceEmailNormalize_(out);
    return oceIsValidEmail_(out) ? out : '';
  } catch (err) { return ''; }
}

function oceHtmlToText_(html) {
  var body = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/i, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|address|td|th|dd|dt)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return oceDecodeEntities_(body).replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim().slice(0, 60000);
}

function oceExtractLinks_(html, baseUrl) {
  var out = [];
  var seen = {};
  var re = /<a\b([^>]*?)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) && out.length < OCE_EXTRACT.MAX_LINKS) {
    var href = oceDecodeEntities_(m[2] || m[3] || m[4] || '').trim();
    var attrs = (m[1] || '') + ' ' + (m[5] || '');
    var label = oceClean_(oceDecodeEntities_(String(m[6] || '').replace(/<[^>]+>/g, ' ')), 160);
    if (!label) label = oceClean_((attrs.match(/(?:title|aria-label)=["']([^"']+)["']/i) || [])[1] || '', 160);
    if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href)) continue;
    if (/^mailto:/i.test(href)) { out.push({ kind: 'mailto', href: href.replace(/^mailto:/i, '').split('?')[0], label: label }); continue; }
    if (/^tel:/i.test(href)) { out.push({ kind: 'tel', href: href.replace(/^tel:/i, ''), label: label }); continue; }
    var abs = oceResolveUrl_(href, baseUrl);
    if (!abs) continue;
    var canonical = oceCanonicalUrl_(abs);
    if (!canonical || seen[canonical]) continue;
    seen[canonical] = true;
    out.push({ kind: 'web', url: canonical, label: label, nofollow: /rel=["'][^"']*nofollow/i.test(attrs) });
  }
  return out;
}

function oceExtractJsonLd_(html) {
  var out = [];
  var re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  var m;
  while ((m = re.exec(html)) && out.length < 25) {
    var raw = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    var parsed = oceParseJson_(raw, null);
    if (parsed === null) parsed = oceParseJson_(raw.replace(/[\u0000-\u001f]+/g, ' '), null);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

function oceJsonLdEntities_(jsonld) {
  var out = { organization: '', address: '', country: '', location: '', person: '', role: '', emails: [], phones: [], types: [] };
  var nodes = [];
  function walk(n, depth) {
    if (!n || depth > 6) return;
    if (Array.isArray(n)) { n.forEach(function (x) { walk(x, depth + 1); }); return; }
    if (typeof n !== 'object') return;
    nodes.push(n);
    if (n['@graph']) walk(n['@graph'], depth + 1);
    ['publisher', 'author', 'provider', 'organizer', 'brand', 'parentOrganization', 'member', 'employee', 'founder', 'contactPoint', 'department', 'location'].forEach(function (k) {
      if (n[k] && typeof n[k] === 'object') walk(n[k], depth + 1);
    });
  }
  walk(jsonld, 0);
  nodes.forEach(function (node) {
    var types = [].concat(node['@type'] || []).map(String);
    types.forEach(function (t) { if (out.types.indexOf(t) < 0) out.types.push(t); });
    var t = types.join(' ').toLowerCase();
    var name = oceClean_(typeof node.name === 'string' ? node.name : '', 200);
    if (!out.organization && name && /organization|organisation|business|corporation|service|store|hospital|school|college|university|ngo|agency|office|clinic|hotel|restaurant|bank|firm|practice/.test(t)) out.organization = name;
    if (!out.person && name && /person/.test(t)) out.person = name;
    if (!out.role && node.jobTitle) out.role = oceClean_(node.jobTitle, 120);
    if (node.email) [].concat(node.email).forEach(function (e) { out.emails.push(String(e)); });
    if (node.telephone) [].concat(node.telephone).forEach(function (p) { out.phones.push(String(p)); });
    var a = node.address;
    if (a && !out.address) {
      if (typeof a === 'string') out.address = oceClean_(a, 300);
      else if (typeof a === 'object' && !Array.isArray(a)) {
        var country = a.addressCountry && (a.addressCountry.name || a.addressCountry);
        out.address = oceClean_([a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, typeof country === 'string' ? country : ''].filter(Boolean).join(', '), 300);
        if (!out.country && typeof country === 'string') out.country = oceCountryName_(country);
        if (!out.location && a.addressLocality) out.location = oceClean_(a.addressLocality, 80);
      }
    }
  });
  return out;
}

function oceCollectEmails_(text, explicit) {
  var found = [];
  (explicit || []).forEach(function (e) { found.push(oceEmailNormalize_(e)); });
  var deobfuscated = String(text || '')
    .replace(/\s*[\[\(\{<]\s*(at|@)\s*[\]\)\}>]\s*/gi, '@')
    .replace(/\s+(at)\s+(?=[a-z0-9-]+\s*(\[|\(|\s)\s*dot)/gi, '@')
    .replace(/\s*[\[\(\{<]\s*(dot|\.)\s*[\]\)\}>]\s*/gi, '.')
    .replace(/(@[a-z0-9-]+)\s+dot\s+([a-z]{2,})/gi, '$1.$2');
  var re = /[a-z0-9][a-z0-9._%+'-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;
  var m;
  while ((m = re.exec(deobfuscated)) && found.length < OCE_EXTRACT.MAX_EMAILS * 2) found.push(oceEmailNormalize_(m[0]));
  return oceUnique_(found).filter(function (e) {
    if (!oceIsValidEmail_(e)) return false;
    var parts = e.split('@');
    if (OCE_EXTRACT.BAD_EMAIL_DOMAINS.test(parts[1]) || OCE_EXTRACT.BAD_EMAIL_LOCAL.test(parts[0])) return false;
    if (/\d+x\d*\.|@\dx\./.test(e) || /\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(e)) return false;
    if (/^[0-9a-f]{16,}$/.test(parts[0])) return false; // hashed tracking ids
    return true;
  }).slice(0, OCE_EXTRACT.MAX_EMAILS);
}

function oceCollectPhones_(text, explicit) {
  var found = [];
  (explicit || []).forEach(function (p) { var n = ocePhoneNormalize_(p); if (n) found.push(n); });
  var source = String(text || '');
  var re = /(?:(?:tel|phone|mobile|cell|call|whatsapp|fax|office|line|contact)[^\n\d+]{0,12})?(\+?\(?\d{1,4}\)?[\s.\-]?(?:\(?\d{1,4}\)?[\s.\-]?){2,5}\d{2,4})/gi;
  var m;
  while ((m = re.exec(source)) && found.length < OCE_EXTRACT.MAX_PHONES * 3) {
    var raw = m[1];
    var label = m[0].slice(0, m[0].length - raw.length);
    if (/fax/i.test(label)) continue;
    var digits = raw.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) continue;
    if (/^(19|20)\d{2}[\s.\-/]?\d{1,2}[\s.\-/]?\d{1,2}$/.test(raw.trim())) continue; // dates
    if (!label && raw.charAt(0) !== '+' && raw.charAt(0) !== '0' && raw.charAt(0) !== '(') continue; // unlabeled bare numbers are usually IDs
    var n = ocePhoneNormalize_(raw);
    if (n) found.push(n);
  }
  return oceUnique_(found).slice(0, OCE_EXTRACT.MAX_PHONES);
}

function oceLabeled_(text, labels) {
  var source = String(text || '');
  for (var i = 0; i < labels.length; i++) {
    var re = new RegExp('(?:^|\\n|\\s)' + labels[i].replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*[:\\-–]\\s*([^\\n]{3,160})', 'i');
    var m = source.match(re);
    if (m && m[1] && !/@|https?:/.test(m[1].slice(0, 20))) return oceClean_(m[1], 200);
  }
  return '';
}

var OCE_COUNTRIES = { ug: 'Uganda', uganda: 'Uganda', ke: 'Kenya', kenya: 'Kenya', tz: 'Tanzania', tanzania: 'Tanzania', rw: 'Rwanda', rwanda: 'Rwanda',
  bi: 'Burundi', burundi: 'Burundi', ss: 'South Sudan', 'south sudan': 'South Sudan', cd: 'DR Congo', ng: 'Nigeria', nigeria: 'Nigeria', gh: 'Ghana', ghana: 'Ghana',
  za: 'South Africa', 'south africa': 'South Africa', et: 'Ethiopia', ethiopia: 'Ethiopia', zm: 'Zambia', zambia: 'Zambia', gb: 'United Kingdom', uk: 'United Kingdom', us: 'United States', usa: 'United States' };

function oceCountryName_(v) {
  var k = String(v || '').trim().toLowerCase();
  return OCE_COUNTRIES[k] || oceClean_(v, 60);
}

function oceDetectCountry_(text) {
  var m = String(text || '').match(/\b(Uganda|Kenya|Tanzania|Rwanda|Burundi|South Sudan|Nigeria|Ghana|South Africa|Ethiopia|Zambia)\b/i);
  return m ? oceCountryName_(m[1]) : '';
}

function oceDetectCity_(text) {
  // Ignore street names ("Jinja Road", "Kampala Rd") — they are not the organisation's city.
  var m = String(text || '').match(/\b(Kampala|Entebbe|Jinja|Mbarara|Gulu|Lira|Mbale|Fort Portal|Arua|Nebbi|Wakiso|Mukono|Masaka|Hoima|Kabale|Soroti|Tororo|Nairobi|Mombasa|Kisumu|Dar es Salaam|Arusha|Kigali|Lagos|Abuja|Accra|Johannesburg|Addis Ababa)\b(?!\s+(road|rd|street|st|avenue|ave|lane|close|crescent|drive|highway|way)\b)/i);
  return m ? m[1].replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : '';
}

function oceInferCategory_(value) {
  var s = String(value || '').toLowerCase();
  var map = [
    ['ACCOUNTING_AUDIT', /auditor|audit|accountan|accountancy|assurance|cpa\b|tax consult|tax advis|bookkeep/],
    ['LEGAL', /law firm|advocate|attorney|legal service|solicitor|lawyer/],
    ['HEALTH', /hospital|clinic|medical|health|pharmac|dental|diagnostic/],
    ['EDUCATION', /school|university|college|academy|institute|training centre|training center/],
    ['FINANCIAL_SERVICES', /bank|microfinance|sacco|fintech|financial service|investment|asset manag|insurance|insurer|broker/],
    ['HOSPITALITY', /hotel|lodge|resort|restaurant|cafe|guest house|tour|safari|travel/],
    ['CONSTRUCTION', /construction|contractor|civil works|engineering|architect|real estate|property/],
    ['TECHNOLOGY', /software|technology|\bit\b|digital|tech|telecom|web design|startup/],
    ['NGO', /ngo|non-profit|nonprofit|foundation|charity|civil society|community based/],
    ['AGRICULTURE', /agri|farm|coffee|dairy|poultry|agro/],
    ['MANUFACTURING', /manufactur|factory|industr|processing plant/],
    ['RETAIL_TRADE', /supplier|wholesale|retail|shop|store|trading|distributor|merchandise/],
    ['GOVERNMENT', /ministry|authority|agency|council|government|\.go\.|\.gov/]
  ];
  for (var i = 0; i < map.length; i++) if (map[i][1].test(s)) return map[i][0];
  return 'OTHER';
}

/**
 * Builds contact candidates from page intelligence.
 * One candidate per e-mail; when a page has no e-mail, one organisation-level candidate with the best phone.
 */
function oceBuildCandidates_(page, ctx) {
  var site = oceSiteOf_(page.url);
  var out = [];
  var mailtoSet = {};
  page.mailto_emails.forEach(function (e) { mailtoSet[e] = true; });
  var base = {
    organization: page.organization, website: 'https://' + oceHostOf_(page.url), address: page.address,
    country: page.country, location: page.location, category: page.category, person_name: page.person, role: page.role,
    source_url: page.url, mission_id: ctx && ctx.mission_id || ''
  };
  page.emails.forEach(function (email) {
    var domain = email.split('@')[1];
    var c = Object.assign({}, base);
    c.email = email;
    c.phone = page.phones[0] || '';
    var score = 30;
    if (oceSiteOf_('https://' + domain) === site) score += 25;
    if (mailtoSet[email]) score += 15;
    if (page.organization) score += 8;
    if (page.phones.length) score += 7;
    if (page.address) score += 5;
    if (page.jsonld_types.length) score += 5;
    if (page.is_contact_page) score += 5;
    if (/^(no-?reply|donotreply|bounce|mailer-daemon|postmaster|abuse|webmaster|hostmaster)/.test(email)) score -= 40;
    if (page.emails.length > 25) score -= 15; // bulk lists are noisier
    c.confidence = Math.max(0, Math.min(100, score));
    c.evidence = oceEvidence_(page, 'email ' + email + (mailtoSet[email] ? ' (mailto link)' : ' (page text)'));
    out.push(c);
  });
  if (!out.length && (page.phones.length || page.organization) && (page.phones.length || page.address)) {
    var c2 = Object.assign({}, base);
    c2.email = '';
    c2.phone = page.phones[0] || '';
    c2.confidence = Math.min(100, 20 + (page.phones.length ? 20 : 0) + (page.organization ? 10 : 0) + (page.address ? 10 : 0) + (page.is_contact_page ? 5 : 0));
    c2.evidence = oceEvidence_(page, 'organisation contact without e-mail');
    out.push(c2);
  }
  return out;
}

function oceEvidence_(page, what) {
  return oceClean_(['Found ' + what, page.title ? 'title: ' + page.title : '', page.organization ? 'org: ' + page.organization : '',
    page.phones.length ? 'phones: ' + page.phones.slice(0, 3).join(', ') : ''].filter(Boolean).join(' | '), 600);
}

/**
 * Scores outgoing links for the frontier. Returns [{url, label, priority}] best first.
 */
function oceScoreLinks_(page, ctx) {
  var topicTerms = oceTokens_(ctx && ctx.objective || '');
  var site = oceSiteOf_(page.url);
  var sameSite = !(ctx && ctx.same_site === false);
  return page.links.map(function (l) {
    if (l.nofollow || oceIsAssetUrl_(l.url) || oceIsSocialUrl_(l.url)) return null;
    var hay = (l.url + ' ' + l.label).toLowerCase();
    if (OCE_EXTRACT.NEGATIVE_HINTS.test(hay)) return null;
    var linkSite = oceSiteOf_(l.url);
    if (sameSite && linkSite !== site) return null;
    var p = 35;
    if (OCE_EXTRACT.CONTACT_HINTS.test(hay)) p += 25;
    if (/contact|about|team|staff/.test(hay)) p += 10;
    if (/[?&](page|p|pg|start|offset)=\d+/i.test(l.url) || /\/page\/\d+/i.test(l.url) || /\bnext\b|›|»/.test(l.label.toLowerCase())) p += 12;
    topicTerms.forEach(function (t) { if (hay.indexOf(t) >= 0) p += 6; });
    if (linkSite !== site) p -= 10;
    if (l.url.length > 180) p -= 10;
    return { url: l.url, label: l.label, priority: Math.max(1, Math.min(95, p)) };
  }).filter(Boolean).sort(function (a, b) { return b.priority - a.priority; });
}
