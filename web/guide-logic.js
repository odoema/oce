/*
 * Shared, friendly logic used by both the guide (help.html) and the in-dashboard assistant (assistant.js).
 * Rule-based on purpose: free, instant, private, and predictable. Content comes from web/manual.js.
 */
window.OCE_GUIDE = (function () {
  'use strict';
  const M = window.OCE_MANUAL;

  /* ------------------------------------------------ objectives ("who do you want to reach?") */
  const PLACES = { uganda: 'Uganda', ugandan: 'Uganda', kampala: 'Uganda', entebbe: 'Uganda', jinja: 'Uganda', gulu: 'Uganda', mbarara: 'Uganda', mbale: 'Uganda',
    kenya: 'Kenya', kenyan: 'Kenya', nairobi: 'Kenya', mombasa: 'Kenya', tanzania: 'Tanzania', 'dar es salaam': 'Tanzania', rwanda: 'Rwanda', kigali: 'Rwanda',
    burundi: 'Burundi', nigeria: 'Nigeria', lagos: 'Nigeria', ghana: 'Ghana', accra: 'Ghana', zambia: 'Zambia', ethiopia: 'Ethiopia',
    'south africa': 'South Africa', 'united kingdom': 'United Kingdom', usa: 'United States', 'united states': 'United States' };
  const OPEN_DATA = ['bank', 'hotel', 'resort', 'lodge', 'university', 'universities', 'college', 'school', 'hospital', 'insurance', 'ngo', 'non-profit', 'charity', 'charities', 'telecom',
    'airline', 'newspaper', 'radio', 'television', 'museum', 'embassy', 'embassies', 'ministry', 'ministries', 'agency', 'agencies', 'authority', 'manufactur', 'sacco', 'microfinance', 'church', 'football club', 'stadium'];
  const REGISTERS = { audit: 'ICPAU\'s register of licensed firms', accountan: 'ICPAU\'s register of licensed firms', lawyer: 'the Uganda Law Society',
    advocate: 'the Uganda Law Society', 'law firm': 'the Uganda Law Society', doctor: 'the medical council', clinic: 'the medical council',
    startup: 'the Startup Uganda directory', tour: 'the Uganda Tourism Board' };
  const GENERIC = ['company', 'companies', 'business', 'businesses', 'firm', 'firms', 'organisation', 'organisations', 'organization', 'organizations', 'people', 'contacts', 'leads', 'everyone', 'anyone', 'clients', 'customers'];
  const FILLER = ['in', 'the', 'and', 'for', 'with', 'list', 'all', 'of', 'find', 'me', 'some', 'get', 'want', 'to', 'reach', 'near', 'around', 'based'];

  /** @return {{level:'idle'|'good'|'meh'|'bad', message:string, country:string, tooBroad:boolean, needsCountry:boolean}} */
  function judgeObjective(text) {
    const raw = String(text || '');
    const t = ' ' + raw.toLowerCase().replace(/[^a-z\- ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
    const out = { level: 'idle', message: 'Start typing…', country: '', tooBroad: false, needsCountry: false };
    if (raw.trim().length < 3) return out;
    const placeKey = Object.keys(PLACES).sort((a, b) => b.length - a.length).find((p) => t.includes(' ' + p + ' '));
    out.country = placeKey ? PLACES[placeKey] : '';
    const placeWords = Object.keys(PLACES).join(' ').split(' ');
    const words = t.trim().split(' ').filter((w) => w.length > 2 && !FILLER.includes(w) && !placeWords.includes(w));
    const specific = words.filter((w) => !GENERIC.includes(w));
    const open = OPEN_DATA.find((k) => t.includes(k));
    const regKey = Object.keys(REGISTERS).find((k) => t.includes(k));
    if (!specific.length) return Object.assign(out, { level: 'bad', tooBroad: true, message: '🤔 That\'s a bit broad. Say what kind: "Hotels in Uganda", "NGOs in Kenya", "Insurance companies in Uganda".' });
    if (!out.country) return Object.assign(out, { level: 'meh', needsCountry: true, message: '📍 Add a country, e.g. "' + raw.trim() + ' in Uganda". OCE uses it to pick the right sources and phone format.' });
    if (open) return Object.assign(out, { level: 'good', message: '🎉 Great choice. Wikipedia and Wikidata list these with their official websites, so expect plenty of starting points.' });
    if (regKey) return Object.assign(out, { level: 'good', message: '👍 Good. These are rarely on Wikipedia, but OCE goes straight to ' + REGISTERS[regKey] + '.' });
    return Object.assign(out, { level: 'meh', message: '🙂 OCE will try, but this group is niche. A directory or member-list page as a starting website helps a lot.' });
  }

  const SUGGESTIONS = [
    { icon: '🏦', text: 'Banks in Uganda' }, { icon: '🏨', text: 'Hotels in Kampala, Uganda' }, { icon: '🤝', text: 'NGOs in Uganda' },
    { icon: '🧾', text: 'Audit firms in Uganda' }, { icon: '🏫', text: 'Universities in Uganda' }, { icon: '🛡️', text: 'Insurance companies in Uganda' }
  ];

  /* ------------------------------------------------ lawful basis ("why may you email them?") */
  const BASIS = {
    start: { q: 'Did these people say yes to hearing from you? (a form, a sign-up sheet, a written yes)', yes: 'consent', no: 'b2b' },
    b2b: { q: 'Are they business contacts at work addresses, and does your offer clearly fit their job?', yes: 'li', no: 'customer' },
    customer: { q: 'Are they already your customers?', yes: 'contract', no: 'none' },
    consent: { basis: 'CONSENT', cls: 'good', a: '✅ Consent. OCE can email them. I\'ll note where the yes came from.' },
    li: { basis: 'LEGITIMATE_INTEREST', cls: 'meh', a: '🟡 Legitimate interest (B2B). OCE only emails these once ALLOW_LEGITIMATE_INTEREST is TRUE in Settings. Keep emails short, relevant and easy to opt out of.' },
    contract: { basis: 'CONTRACT', cls: 'meh', a: '🟡 Existing customer. I\'ll record it, but OCE won\'t email on that alone. Ask them to opt in, then record consent.' },
    none: { basis: 'NONE', cls: 'bad', a: '⛔ Then they can\'t be emailed yet. I\'ll still help you sort them, but none will be marked emailable.' }
  };

  /* ------------------------------------------------ answers from the manual ("ask me anything") */
  const STOP = ['the', 'and', 'for', 'with', 'how', 'what', 'why', 'when', 'where', 'who', 'can', 'does', 'do', 'is', 'are', 'my', 'a', 'an', 'to', 'of', 'in', 'on', 'it', 'i', 'me', 'you', 'oce', 'this', 'that', 'there', 'not', 'get', 'use'];
  const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');
  const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.includes(w)).map(stem);
  const docs = [];
  if (M) {
    M.troubles.forEach((t) => docs.push({ title: t.q, text: t.fix, link: 'help.html#trouble', weight: 1.3 }));
    M.chapters.filter((c) => c.id !== 'assistant').forEach((c) => {
      (c.steps || []).forEach((s) => docs.push({ title: c.title + ': ' + s.title, text: s.text, link: 'help.html#' + c.id, weight: 1 }));
      (c.tips || []).forEach((tip) => docs.push({ title: c.title, text: tip, link: 'help.html#' + c.id, weight: 1.1 }));
    });
    M.settings.forEach((s) => docs.push({ title: 'Setting ' + s.key, text: s.plain + (s.def !== '' ? ' (default ' + s.def + ')' : ''), link: 'help.html#settings-ref', weight: 0.8 }));
    M.goLive.forEach((g, i) => docs.push({ title: 'Go live, step ' + (i + 1), text: g, link: 'help.html#golive-list', weight: 1 }));
    docs.forEach((d) => { d.tok = new Set(tokens(d.title + ' ' + d.text)); });
  }
  /** Best matches for a free-text question, most relevant first. */
  function answer(question, max) {
    const q = tokens(question);
    if (!q.length) return [];
    return docs.map((d) => ({ d, s: q.filter((w) => d.tok.has(w)).length * d.weight / Math.sqrt(d.tok.size + 4) }))
      .filter((x) => x.s > 0.12).sort((a, b) => b.s - a.s).slice(0, max || 2).map((x) => x.d);
  }

  /* ------------------------------------------------ what does the person want? */
  const INTENTS = [
    { id: 'find', words: ['find', 'search', 'look', 'discover', 'mission', 'new contact', 'lead', 'prospect', 'scrape', 'crawl', 'collect'] },
    { id: 'review', words: ['review', 'approve', 'reject', 'pending', 'waiting', 'check contact', 'sort'] },
    { id: 'campaign', words: ['campaign', 'send', 'email', 'e-mail', 'newsletter', 'write', 'message', 'blast'] },
    { id: 'pdf', words: ['pdf', 'document', 'scanned', 'brochure'] },
    { id: 'import', words: ['import', 'upload', 'csv', 'excel', 'my list', 'spreadsheet', 'add contact'] },
    { id: 'status', words: ['status', 'how am i', 'progress', 'stats', 'numbers', 'summary', 'overview', 'doing'] },
    { id: 'connect', words: ['connect', 'api key', 'login', 'link the', 'set up', 'setup'] }
  ];
  function intent(text) {
    const t = String(text || '').toLowerCase();
    if (/\?\s*$/.test(t) && /^(how|what|why|when|where|can|does|is|do)\b/.test(t)) return 'question';
    const hit = INTENTS.map((i) => ({ id: i.id, n: i.words.filter((w) => t.includes(w)).length })).sort((a, b) => b.n - a.n)[0];
    return hit && hit.n ? hit.id : 'question';
  }

  return { judgeObjective, SUGGESTIONS, BASIS, answer, intent };
})();
