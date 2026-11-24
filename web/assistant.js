/*
 * OCE assistant: a friendly, step-by-step helper inside the dashboard.
 * It asks one question at a time, offers suggestions, explains what it is doing, and calls the same
 * API the dashboard uses (api/post/store/show/load from app.js). Rule-based: no AI service, no cost.
 * Wording lives here; shared logic (objective checker, basis questions, answers) in guide-logic.js.
 */
(function () {
  'use strict';
  const G = window.OCE_GUIDE;
  class Abort extends Error {}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const refresh = () => { try { load(current); } catch (e) { /* view not ready */ } };

  /* ------------------------------------------------ panel */
  document.body.insertAdjacentHTML('beforeend', `
    <button id="oceAsk" class="ask-fab" aria-controls="oceChat" aria-expanded="false"><span class="ask-face" aria-hidden="true">●‿●</span> Ask OCE</button>
    <aside id="oceChat" class="chat hidden" aria-label="OCE assistant">
      <header class="chat-head">
        <span class="chat-avatar" aria-hidden="true">●‿●</span>
        <div><b>OCE assistant</b><small id="chatSub">Here to help, step by step</small></div>
        <button id="chatMenu" class="chat-icon" title="Back to the start">⌂ Menu</button>
        <button id="chatClose" class="chat-icon" aria-label="Close assistant">✕</button>
      </header>
      <div id="chatLog" class="chat-log" role="log" aria-live="polite"></div>
      <div class="chat-foot">
        <div id="chatChips" class="chat-chips"></div>
        <form id="chatForm" class="chat-form">
          <input id="chatInput" autocomplete="off" placeholder="Type here…" aria-label="Your answer">
          <button class="chat-send" aria-label="Send">➤</button>
        </form>
      </div>
    </aside>`);
  const log = $('chatLog'), chipsBox = $('chatChips'), form = $('chatForm'), input = $('chatInput');

  function open() {
    $('oceChat').classList.remove('hidden');
    document.body.classList.add('chat-open');
    $('oceAsk').classList.add('hidden');
    $('oceAsk').setAttribute('aria-expanded', 'true');
    if (!log.children.length) start(mainMenu);
    setTimeout(() => input.focus(), 50);
    try { localStorage.setItem('oce.assistant.seen', '1'); } catch (e) { /* ignore */ }
  }
  function close() {
    $('oceChat').classList.add('hidden');
    document.body.classList.remove('chat-open');
    $('oceAsk').classList.remove('hidden');
    $('oceAsk').setAttribute('aria-expanded', 'false');
  }
  $('oceAsk').addEventListener('click', open);
  $('chatClose').addEventListener('click', close);
  $('chatMenu').addEventListener('click', () => start(mainMenu));
  window.oceAssistant = { open, start: (name) => { open(); start({ find: findFlow, review: reviewFlow, campaign: campaignFlow, import: importFlow, status: statusFlow }[name] || mainMenu); } };

  /* ------------------------------------------------ talking */
  const scroll = () => { log.scrollTop = log.scrollHeight; };
  async function say(html, opts) {
    opts = opts || {};
    const typing = document.createElement('div');
    typing.className = 'msg bot typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    log.appendChild(typing); scroll();
    await sleep(reduced ? 0 : (opts.quick ? 250 : Math.min(1100, 350 + String(html).replace(/<[^>]+>/g, '').length * 6)));
    typing.remove();
    const m = document.createElement('div');
    m.className = 'msg bot' + (opts.card ? ' card-msg' : '');
    m.innerHTML = html;
    log.appendChild(m); scroll();
    return m;
  }
  function me(text) {
    const m = document.createElement('div');
    m.className = 'msg me';
    m.textContent = text;
    log.appendChild(m); scroll();
  }

  /* ------------------------------------------------ asking */
  let pending = null;
  let flowSeq = 0;
  function clearAsk() { chipsBox.innerHTML = ''; input.type = 'text'; input.value = ''; input.placeholder = 'Type here…'; }
  /**
   * Shows suggestion chips and/or the text box, resolves with the chosen value.
   * @param {{chips?:Array<{label:string,value?:*}>, input?:boolean|'password', placeholder?:string, mask?:boolean}} o
   */
  function ask(o) {
    o = o || {};
    clearAsk();
    const seq = flowSeq;
    return new Promise((resolve, reject) => {
      pending = { resolve, reject, seq };
      (o.chips || []).forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chat-chip' + (c.primary ? ' primary' : '');
        b.textContent = c.label;
        b.addEventListener('click', () => { me(c.label); finish(c.value !== undefined ? c.value : c.label); });
        chipsBox.appendChild(b);
      });
      input.disabled = o.input === false;
      input.type = o.input === 'password' ? 'password' : 'text';
      input.placeholder = o.input === false ? 'Pick an option above' : (o.placeholder || 'Type here…');
      pending.mask = o.input === 'password';
      scroll();
      if (o.input !== false) setTimeout(() => input.focus(), 30);
    });
  }
  function finish(value) {
    const p = pending; pending = null;
    clearAsk();
    if (p) p.resolve(value);
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v || !pending) return;
    me(pending.mask ? '•'.repeat(Math.min(v.length, 16)) : v);
    finish(v);
  });
  async function start(flow) {
    flowSeq++;
    if (pending) { const p = pending; pending = null; p.reject(new Abort()); }
    clearAsk();
    try { await flow(); } catch (e) {
      if (e instanceof Abort) return;
      await say(`😕 That didn't work: <i>${esc(e.message || e)}</i>`);
      const next = await ask({ chips: [{ label: '↺ Try again', value: 'again' }, { label: '⌂ Menu', value: 'menu' }], input: false });
      start(next === 'again' ? flow : mainMenu);
    }
  }
  const yesNo = (yes, no) => ask({ chips: [{ label: yes || 'Yes', value: true }, { label: no || 'No', value: false }], input: false });

  /* ------------------------------------------------ menu */
  async function mainMenu() {
    const h = new Date().getHours();
    const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    if (!store.key) {
      await say(`${hello}! 👋 I'm your OCE assistant. I'll walk you through everything, one small step at a time.`);
      await say('First, let\'s connect me to your OCE. It takes a minute.');
      return connectFlow(true);
    }
    let d = null;
    try { d = await api('dashboard'); setConn(true, d); } catch (e) { /* show menu anyway */ }
    const waiting = d ? d.candidates.pending : 0;
    await say(`${hello}! 👋 What would you like to do?` + (waiting ? `<br><small>📬 ${num(waiting)} contact${waiting > 1 ? 's are' : ' is'} waiting for your review.</small>` : ''), { quick: true });
    const pick = await ask({
      chips: [
        { label: '🔎 Find new contacts', value: 'find', primary: true },
        { label: `✅ Review what I found${waiting ? ' (' + num(waiting) + ')' : ''}`, value: 'review' },
        { label: '✍️ Write a campaign', value: 'campaign' },
        { label: '📥 Import my own list', value: 'import' },
        { label: '📊 How am I doing?', value: 'status' },
        { label: '❓ Ask a question', value: 'question' }
      ],
      placeholder: 'Or just tell me, e.g. "find hotels in Kampala"'
    });
    return route(pick);
  }
  async function route(text) {
    const id = ['find', 'review', 'campaign', 'import', 'status', 'question', 'connect'].includes(text) ? text : G.intent(text);
    if (id === 'find') return findFlow(['find', 'review', 'campaign', 'import', 'status', 'question'].includes(text) ? '' : text);
    if (id === 'review') return reviewFlow();
    if (id === 'campaign') return campaignFlow();
    if (id === 'import') return importFlow();
    if (id === 'status') return statusFlow();
    if (id === 'connect') return connectFlow(false);
    return questionFlow(text === 'question' ? '' : text);
  }
  async function next(extra) {
    const v = await ask({ chips: (extra || []).concat([{ label: '⌂ Something else', value: 'menu' }]), placeholder: 'Or tell me what you want to do' });
    return v === 'menu' ? mainMenu() : route(v);
  }

  /* ------------------------------------------------ connect */
  async function connectFlow(firstTime) {
    let url = store.endpoint;
    const reuse = url && /\/exec$/.test(url)
      ? await ask({ chips: [{ label: 'Use the saved address', value: 'keep', primary: true }, { label: 'Paste a new one', value: 'new' }], input: false })
      : 'new';
    if (reuse === 'new') {
      await say('Paste your <b>web app address</b>. It starts with https://script.google.com and ends with <code>/exec</code>.');
      for (;;) {
        url = String(await ask({ placeholder: 'https://script.google.com/macros/s/…/exec' })).trim();
        if (/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) break;
        await say('Hmm, that doesn\'t look right. It should start with <code>https://script.google.com</code> and end with <code>/exec</code>. Try again?');
      }
    }
    await say('Now your <b>API key</b>. It stays in this browser only. (Lost it? In the Apps Script editor, run <code>oceShowApiKey</code>.)');
    const key = String(await ask({ input: 'password', placeholder: 'Paste your API key' })).trim();
    store.save(url, key);
    await say('Checking…', { quick: true });
    try {
      const d = await api('dashboard');
      setConn(true, d);
      refresh();
      await say(`🎉 Connected! You have <b>${num(d.contacts.total)}</b> contacts and <b>${num(d.candidates.pending)}</b> waiting for review.`);
    } catch (e) {
      store.clear();
      await say(`That didn't work: <i>${esc(e.message)}</i>. Let's try again.`);
      return connectFlow(firstTime);
    }
    if (firstTime) await say('Tip: you can open me any time with the <b>Ask OCE</b> button, bottom right.');
    return mainMenu();
  }

  /* ------------------------------------------------ find contacts */
  async function findFlow(prefill) {
    let objective = prefill && G.judgeObjective(prefill).level !== 'bad' ? prefill : '';
    if (!objective) {
      await say('Who would you like to reach? Pick one, or type your own.');
      objective = String(await ask({ chips: G.SUGGESTIONS.map((s) => ({ label: s.icon + ' ' + s.text, value: s.text })), placeholder: 'e.g. Schools in Gulu, Uganda' }));
    }
    let v = G.judgeObjective(objective);
    while (v.tooBroad) {
      await say(v.message);
      objective = String(await ask({ chips: G.SUGGESTIONS.slice(0, 3).map((s) => ({ label: s.icon + ' ' + s.text, value: s.text })), placeholder: 'What kind of organisation?' }));
      v = G.judgeObjective(objective);
    }
    if (v.needsCountry) {
      await say('Which country should I look in?');
      const c = await ask({ chips: ['Uganda', 'Kenya', 'Tanzania', 'Rwanda'].map((x) => ({ label: x })), placeholder: 'Or type a country' });
      objective = objective.replace(/[.\s]+$/, '') + ' in ' + c;
      v = G.judgeObjective(objective);
    }
    await say(`<b>${esc(objective)}</b>. ${v.message}`);
    await say('Let me see where I\'d start looking… 🔍', { quick: true });
    let seeds = [];
    try {
      const d = await api('discover.preview', { objective, limit: 12 });
      seeds = d.seeds || [];
    } catch (e) { await say(`I couldn't check sources just now (${esc(e.message)}), but the mission can still try.`); }
    if (seeds.length) {
      await say(`I found <b>${seeds.length}</b> good places to start:<ul class="chat-list">${seeds.slice(0, 6).map((s) =>
        `<li><a href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name || short(s.url, 40))}</a><small>${esc(short(s.url, 38))}</small></li>`).join('')}</ul>${seeds.length > 6 ? `<small>…and ${seeds.length - 6} more.</small>` : ''}`, { card: true });
    } else {
      await say('I couldn\'t find ready-made starting points for this one. A directory or member-list page would really help.');
    }
    await say('Do you know a website that <b>lists</b> them? (an association\'s member list, a directory page) Paste it, or skip.');
    let extra = '';
    for (;;) {
      const a = String(await ask({ chips: [{ label: 'Skip', value: '' }], placeholder: 'https://… (one or more, separated by spaces)' }));
      if (!a) break;
      const urls = a.split(/[\s,]+/).filter((u) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+/i.test(u));
      if (urls.length) { extra = urls.join('\n'); await say(`👍 Added ${urls.length} starting page${urls.length > 1 ? 's' : ''}.`, { quick: true }); break; }
      await say('That doesn\'t look like a web address. Try again, or press Skip.');
    }
    if (!seeds.length && !extra) {
      await say('Without any starting points the mission would come back empty. Want to try a broader search?');
      return (await yesNo('Yes, try again', 'No, back to menu')) ? findFlow('') : mainMenu();
    }
    await say('How deep should I dig?');
    const size = await ask({ input: false, chips: [
      { label: '⚡ Quick look (50 pages)', value: 50 }, { label: '👍 Normal (150 pages)', value: 150, primary: true }, { label: '🔬 Deep (300 pages)', value: 300 }] });
    await say(`Here's the plan:<ul class="chat-list plain"><li>🎯 <b>${esc(objective)}</b></li><li>🌍 ${seeds.length} sources found${extra ? ' + your ' + extra.split('\n').length + ' page(s)' : ''}</li><li>📄 Up to ${size} pages, politely (I obey each site's rules)</li></ul>Shall I start?`, { card: true });
    const go = await ask({ input: false, chips: [{ label: '🚀 Start the mission', value: 'go', primary: true }, { label: '✏️ Change the search', value: 'again' }, { label: 'Cancel', value: 'menu' }] });
    if (go === 'again') return findFlow('');
    if (go === 'menu') return mainMenu();
    const m = await post('missions.create', { objective, max_pages: size, max_depth: 2, seeds: extra });
    refresh();
    if (m.status !== 'RUNNING') { await say(`The mission couldn't start: ${esc(m.notes || m.status)}`); return next([{ label: '🔎 Try another search', value: 'find' }]); }
    await say(`🚀 Mission started with <b>${num(m.seed_count)}</b> starting sources! I keep working every 5 minutes, even if you close this page.`);
    return collectLoop(m.mission_id);
  }
  async function collectLoop(missionId) {
    for (;;) {
      const c = await ask({ input: false, chips: [{ label: '⚡ Collect a batch now (about a minute)', value: 'go', primary: true }, { label: '✅ Review what\'s found', value: 'review' }, { label: '👋 I\'ll come back later', value: 'later' }] });
      if (c === 'review') return reviewFlow(missionId);
      if (c === 'later') { await say('Sounds good. Check back in a few minutes. The number next to <b>Review</b> in the sidebar shows what\'s waiting.'); return next(); }
      await say('On it… visiting pages politely. This takes up to a minute. ⏳', { quick: true });
      const r = await post('worker.run', { max_seconds: 60, mission_id: missionId });
      refresh();
      if (r.skipped) { await say(`I couldn't collect right now: ${esc(r.skipped)}. The background job will carry on by itself.`); continue; }
      const mm = await api('missions.get', { mission_id: missionId }).catch(() => null);
      const pct = mm ? Number(mm.progress || 0) : 0;
      await say(`Visited <b>${num(r.processed)}</b> pages and found <b>${num(r.candidates)}</b> contacts.` +
        (mm ? `<div class="chat-progress"><i style="width:${Math.max(3, Math.min(100, pct))}%"></i></div><small>${pct}% of the mission done · ${num(mm.candidates_found)} contacts so far</small>` : ''));
      if (mm && /COMPLETED/.test(mm.status)) { await say('🏁 That mission is finished!'); return reviewFlow(missionId); }
    }
  }

  /* ------------------------------------------------ review */
  async function reviewFlow(missionId) {
    const d = await api('candidates.page', { status: 'PENDING', page_size: 40, mission_id: missionId || '' });
    if (!d.items.length) {
      await say(missionId ? 'Nothing from this mission is waiting yet. Give it a few minutes.' : '🎉 Nothing is waiting for review. You\'re all caught up!');
      return next([{ label: '🔎 Find new contacts', value: 'find' }]);
    }
    await say(`<b>${num(d.total)}</b> contact${d.total > 1 ? 's are' : ' is'} waiting. Found isn't the same as allowed, so first: why may you email these people?`);
    const b = await basisQuestions();
    const good = d.items.filter((c) => Number(c.confidence) >= 70);
    let mode = 'one';
    if (good.length > 1) {
      await say(`${good.length} of these look strong (score 70 or more). How do you want to go?`);
      mode = await ask({ input: false, chips: [{ label: '👀 One by one', value: 'one', primary: true }, { label: `⚡ Approve the ${good.length} strong ones`, value: 'bulk' }] });
    }
    const tally = { APPROVE: 0, REJECT: 0, SUPPRESS: 0, skip: 0 };
    const decide = (ids, decision) => post('candidates.review', { ids, decision, lawful_basis: b.basis, consent_status: b.basis === 'CONSENT' ? 'YES' : 'UNKNOWN', consent_source: b.source || '' });
    if (mode === 'bulk') {
      await decide(good.map((c) => c.candidate_id), 'APPROVE');
      tally.APPROVE = good.length;
      await say(`✅ Approved ${good.length}. They're in your Contacts now.`);
    } else {
      await say('I\'ll show them one at a time. Have a look and tell me what to do.', { quick: true });
      for (const c of d.items) {
        await say(card(c), { card: true, quick: true });
        const a = await ask({ input: false, chips: [{ label: '✅ Approve', value: 'APPROVE', primary: true }, { label: '❌ Reject', value: 'REJECT' }, { label: '⏭ Skip', value: 'skip' }, { label: '🚫 Never contact', value: 'SUPPRESS' }, { label: '⏹ Stop here', value: 'stop' }] });
        if (a === 'stop') break;
        if (a !== 'skip') await decide([c.candidate_id], a);
        tally[a]++;
      }
    }
    refresh();
    await say(`Done for now: ✅ ${tally.APPROVE} approved · ❌ ${tally.REJECT} rejected · 🚫 ${tally.SUPPRESS} blocked${tally.skip ? ' · ⏭ ' + tally.skip + ' skipped' : ''}.` +
      (b.basis === 'LEGITIMATE_INTEREST' ? '<br><small>Remember: B2B contacts are only emailed once ALLOW_LEGITIMATE_INTEREST is TRUE in Settings.</small>' : ''));
    return next(tally.APPROVE ? [{ label: '✍️ Write a campaign to them', value: 'campaign' }, { label: '✅ Review more', value: 'review' }] : [{ label: '✅ Review more', value: 'review' }]);
  }
  function card(c) {
    const conf = Number(c.confidence) || 0;
    return `<div class="contact-card"><div class="cc-top"><b>${esc(c.organization || 'Unknown organisation')}</b><span class="cc-score ${conf >= 70 ? 'hi' : conf >= 45 ? 'mid' : 'lo'}">${conf}</span></div>` +
      (c.email ? `<div>✉️ ${esc(c.email)}</div>` : '<div class="muted">No email address</div>') +
      (c.phone ? `<div>📞 ${esc(c.phone)}</div>` : '') +
      (c.person_name ? `<div>👤 ${esc(c.person_name)}${c.role ? ' · ' + esc(c.role) : ''}</div>` : '') +
      ([c.location, c.country].filter(Boolean).length ? `<div>📍 ${esc([c.location, c.country].filter(Boolean).join(', '))}</div>` : '') +
      ((c.source_urls || []).length ? `<div class="small">Found on <a href="${safeUrl(c.source_urls[0])}" target="_blank" rel="noopener noreferrer">${esc(short(c.source_urls[0], 40))}</a></div>` : '') + '</div>';
  }
  async function basisQuestions() {
    let node = 'start';
    while (!G.BASIS[node].basis) {
      await say(G.BASIS[node].q, { quick: true });
      node = (await yesNo()) ? G.BASIS[node].yes : G.BASIS[node].no;
    }
    const r = G.BASIS[node];
    await say(r.a);
    let source = '';
    if (r.basis === 'CONSENT') {
      await say('Where did they say yes? (This is kept as proof.)', { quick: true });
      source = String(await ask({ chips: [{ label: 'Website sign-up form' }, { label: 'Event sign-up sheet' }, { label: 'Email reply' }], placeholder: 'e.g. Expo 2026 sign-up sheet' }));
    }
    return { basis: r.basis, source };
  }

  /* ------------------------------------------------ campaign */
  async function campaignFlow() {
    const [d, segs] = await Promise.all([api('dashboard'), api('segments.list').catch(() => [])]);
    const eligible = d.contacts.eligible;
    if (!eligible) {
      await say('Right now <b>nobody</b> can be emailed: approve contacts with consent first (or import a list where people said yes). You can still write a draft.');
      const a = await ask({ input: false, chips: [{ label: '✍️ Write a draft anyway', value: 'go' }, { label: '✅ Review contacts', value: 'review' }, { label: '📥 Import a list', value: 'import' }] });
      if (a !== 'go') return route(a);
    }
    let segment = '';
    if (segs.length) {
      await say('Who should get it?');
      segment = await ask({ input: false, chips: [{ label: `Everyone I may email (${num(eligible)})`, value: '', primary: true }].concat(segs.slice(0, 6).map((s) => ({ label: '🎯 ' + s.segment_name, value: s.segment_id }))) });
    } else if (eligible) await say(`It'll go to everyone you may email: <b>${num(eligible)}</b> contact${eligible > 1 ? 's' : ''}.`);
    await say('What kind of email is it?');
    const kind = await ask({ input: false, chips: [{ label: '👋 Introduce my business', value: 'intro', primary: true }, { label: '📅 Invite to an event', value: 'event' }, { label: '🎁 Share an offer', value: 'offer' }, { label: '✍️ I\'ll write it myself', value: 'own' }] });
    const settings = await api('settings.get').catch(() => ({}));
    const sv = (k) => { const s = (settings.settings || settings || []); const row = Array.isArray(s) ? s.find((x) => x.key === k) : null; return row ? row.value : (s[k] || ''); };
    let fromName = sv('DEFAULT_FROM_NAME');
    if (!fromName) {
      await say('Whose name should the email come from?', { quick: true });
      fromName = String(await ask({ placeholder: 'e.g. Brian at Odoch Consulting' }));
    }
    let subject, body;
    if (kind === 'own') {
      await say('Type the subject line. Tip: <code>{{first_name|there}}</code> becomes each person\'s first name.');
      subject = String(await ask({ chips: [{ label: 'Quick question, {{first_name|there}}' }, { label: 'An idea for {{organization|your team}}' }], placeholder: 'Subject' }));
      await say('Now the message. Keep it short and friendly. (Line breaks are kept.)');
      const text = String(await ask({ placeholder: 'Write your message…' }));
      body = text.split(/\n{2,}|\n/).map((p) => `<p>${esc(p)}</p>`).join('') + `<p>${esc(fromName)}</p>`;
    } else {
      const q = { intro: 'In one sentence, what do you offer?', event: 'What\'s the event, and when? (e.g. "our free tax clinic on 5 December in Kampala")', offer: 'What\'s the offer? (e.g. "20% off audit fees until January")' }[kind];
      await say(q);
      const what = String(await ask({ placeholder: 'One sentence is enough' })).replace(/[.\s]+$/, '');
      const T = {
        intro: { s: 'An idea for {{organization|your team}}', b: `<p>Hi {{first_name|there}},</p><p>I'm reaching out to {{organization|your team}} because ${esc(what)}.</p><p>Would you be open to a short call next week to see if it's useful?</p><p>Best regards,<br>${esc(fromName)}</p>` },
        event: { s: 'You\'re invited, {{first_name|there}}', b: `<p>Hi {{first_name|there}},</p><p>We'd love to see you at ${esc(what)}.</p><p>Just reply to this email to save your place.</p><p>Warm regards,<br>${esc(fromName)}</p>` },
        offer: { s: 'Something for {{organization|you}}', b: `<p>Hi {{first_name|there}},</p><p>A quick note: ${esc(what)}.</p><p>Reply to this email and we'll take care of the rest.</p><p>Best,<br>${esc(fromName)}</p>` }
      }[kind];
      subject = T.s; body = T.b;
      await say(`Here's a draft subject: <b>${esc(subject)}</b>. Keep it?`, { quick: true });
      const keep = await ask({ chips: [{ label: '👍 Keep it', value: '', primary: true }], placeholder: 'Or type a better subject' });
      if (keep) subject = keep;
    }
    const c = await post('campaigns.save', { campaign: { name: subject.replace(/\{\{[^}]+\}\}/g, '').trim().slice(0, 60) + ' · ' + new Date().toLocaleDateString(), segment_id: segment, subject, body_html: body, from_name: fromName } });
    refresh();
    const p = await api('campaigns.preview', { campaign_id: c.campaign_id });
    const m = await say(`Here's how it looks for <b>${esc(p.sample_email || 'a contact')}</b> (${num(p.audience)} will get it):<iframe class="chat-preview" sandbox="" title="Email preview"></iframe>`, { card: true });
    m.querySelector('iframe').srcdoc = p.html;
    if ((c.problems || []).length) {
      await say('Before it can really send, a few things need setting up (one time only):<ul class="chat-list plain">' + c.problems.map((x) => `<li>⚙️ ${esc(friendlyProblem(x))}</li>`).join('') + '</ul><a href="help.html#golive-list" target="_blank">Open the go-live checklist ↗</a>');
    }
    const mode = d.delivery.mode;
    const choices = [{ label: '▶ Activate it', value: 'activate', primary: true }, { label: '✏️ Edit in Campaigns', value: 'edit' }];
    if (mode !== 'DRY_RUN') choices.splice(1, 0, { label: '📨 Send me a test', value: 'test' });
    for (;;) {
      const a = await ask({ input: false, chips: choices.concat([{ label: '⌂ Done for now', value: 'menu' }]) });
      if (a === 'menu') return mainMenu();
      if (a === 'edit') { show('campaigns'); await say('Opened <b>Campaigns</b>. Click <b>Edit</b> on your new campaign.'); continue; }
      if (a === 'test') {
        const r = await post('campaigns.send_test', { campaign_id: c.campaign_id });
        await say(r.sent ? `📨 Sent a test to ${esc(r.recipient)}. Check your inbox!` : 'The test failed: ' + esc((r.failed || []).join('; ')));
        continue;
      }
      await post('campaigns.status', { campaign_id: c.campaign_id, status: 'ACTIVE' });
      refresh();
      await say(mode === 'DRY_RUN'
        ? '✅ Activated in <b>practice mode</b>: I go through every step, but nothing leaves Google. You\'ll see "(sim)" counts in Campaigns. When you\'re ready for real sending, follow the go-live checklist.'
        : '✅ Activated! I send in small batches on weekdays, 09:00–17:00 Kampala time, within your daily limit. Every email has an unsubscribe link.');
      return next([{ label: '📊 How am I doing?', value: 'status' }]);
    }
  }
  function friendlyProblem(p) {
    if (/SENDER_POSTAL_ADDRESS/.test(p)) return 'Add your postal address (Settings → SENDER_POSTAL_ADDRESS). The law expects it in marketing emails.';
    if (/sender address|from_email/i.test(p)) return 'Add a sender email on your own domain (Settings → DEFAULT_FROM_EMAIL).';
    if (/Web app URL/i.test(p)) return 'Set PUBLIC_WEB_APP_URL in Settings so unsubscribe links work.';
    return p;
  }

  /* ------------------------------------------------ import */
  async function importFlow() {
    await say('Let\'s add people you already know. Save your Excel or Google Sheet as <b>CSV</b>, with a header row. I understand columns like <i>email, name, company, phone, country, consent</i>.');
    const file = await pickFile();
    if (!file) return mainMenu();
    if (file.size > 4 * 1024 * 1024) { await say('That file is over 4 MB. Please split it into smaller files.'); return mainMenu(); }
    let csv = await file.text();
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    const header = (lines[0] || '').toLowerCase();
    if (!/e-?mail/.test(header)) { await say('I couldn\'t find an <b>email</b> column in the first row. Add a header row with "email" and try again.'); return next([{ label: '📥 Try another file', value: 'import' }]); }
    await say(`📄 <b>${esc(file.name)}</b>: ${num(lines.length - 1)} rows.`);
    let source = '';
    if (!/\bconsent\b/.test(header)) {
      await say('Did <b>everyone</b> on this list agree to hear from you?');
      if (await yesNo('Yes, they all said yes', 'No / not sure')) {
        await say('Where did they say yes?', { quick: true });
        source = String(await ask({ chips: [{ label: 'Event sign-up sheet' }, { label: 'Website sign-up form' }, { label: 'Existing newsletter list' }], placeholder: 'e.g. Expo 2026 sign-up sheet' }));
        const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
        csv = lines.map((l, i) => l + ',' + (i === 0 ? 'consent,consent_source' : 'yes,' + q(source))).join('\n');
      } else {
        await say('No problem. I\'ll import them, but they won\'t be emailed until they agree.');
      }
    }
    await say('Want to tag this group so you can email just them later?', { quick: true });
    const tags = String(await ask({ chips: [{ label: 'No tag', value: '' }], placeholder: 'e.g. expo-2026' }));
    const r = await post('contacts.import', { csv, tags, source: 'CSV: ' + file.name });
    refresh();
    await say(`📥 Done: <b>${num(r.created)}</b> new, <b>${num(r.updated)}</b> updated${r.skipped ? `, ${num(r.skipped)} skipped (usually a missing or invalid email)` : ''}.`);
    return next([{ label: '✍️ Write a campaign', value: 'campaign' }]);
  }
  function pickFile() {
    return new Promise((resolve, reject) => {
      const seq = flowSeq;
      const box = document.createElement('div');
      box.className = 'msg bot card-msg';
      box.innerHTML = '<label class="chat-file">📎 Choose a CSV file<input type="file" accept=".csv,text/csv"></label>';
      log.appendChild(box); scroll();
      ask({ input: false, chips: [{ label: 'Cancel', value: null }] }).then((v) => { if (v === null) resolve(null); }, reject);
      box.querySelector('input').addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (!f || seq !== flowSeq) return;
        me('📎 ' + f.name);
        clearAsk();
        pending = null;
        resolve(f);
      });
    });
  }

  /* ------------------------------------------------ status */
  async function statusFlow() {
    const d = await api('dashboard');
    setConn(true, d);
    const lines = [
      `🎯 <b>${num(d.missions.total)}</b> mission${d.missions.total === 1 ? '' : 's'}${d.missions.running ? `, ${d.missions.running} running now` : ''}`,
      `🕸️ <b>${num(d.queue.completed)}</b> pages visited`,
      `📬 <b>${num(d.candidates.pending)}</b> contacts waiting for review`,
      `📇 <b>${num(d.contacts.total)}</b> in your list, <b>${num(d.contacts.eligible)}</b> can be emailed`,
      `✍️ <b>${num(d.campaigns.total)}</b> campaign${d.campaigns.total === 1 ? '' : 's'}${d.campaigns.active ? `, ${d.campaigns.active} active` : ''}`,
      `📨 Sending: <b>${d.delivery.mode === 'DRY_RUN' ? 'practice mode' : d.delivery.mode === 'TEST' ? 'test mode' : d.delivery.send_enabled ? 'live' : 'paused'}</b>${d.delivery.mode !== 'DRY_RUN' ? ` · ${num(d.delivery.sent_today)}/${num(d.delivery.daily_limit)} today` : ''}`
    ];
    await say('Here\'s where things stand:<ul class="chat-list plain">' + lines.map((l) => `<li>${l}</li>`).join('') + '</ul>', { card: true });
    const tips = [];
    if (d.candidates.pending) tips.push({ label: `✅ Review the ${num(d.candidates.pending)} waiting`, value: 'review' });
    if (!d.missions.total) tips.push({ label: '🔎 Start your first mission', value: 'find' });
    if (d.contacts.eligible && !d.campaigns.total) tips.push({ label: '✍️ Write your first campaign', value: 'campaign' });
    return next(tips);
  }

  /* ------------------------------------------------ questions */
  async function questionFlow(text) {
    if (!text) {
      await say('Ask me anything about OCE. For example: <i>"how do unsubscribes work?"</i> or <i>"why is my mission empty?"</i>');
      text = String(await ask({ placeholder: 'Your question' }));
    }
    const hits = G.answer(text, 2);
    if (!hits.length) {
      await say('I\'m not sure about that one. 🤔 The full guide may help: <a href="help.html" target="_blank">open the guide ↗</a>');
    } else {
      await say(hits.map((h, i) => `${i ? '<hr>' : ''}<b>${esc(h.title)}</b><br>${esc(h.text)} <a href="${h.link}" target="_blank">More ↗</a>`).join(''), { card: true });
    }
    return next([{ label: '❓ Another question', value: 'question' }]);
  }

  /* ------------------------------------------------ first visit: open by itself */
  let seen = false;
  try { seen = !!localStorage.getItem('oce.assistant.seen'); } catch (e) { seen = true; }
  if (!seen) setTimeout(open, 900);
  // "Let OCE guide you" buttons anywhere in the dashboard: <button data-assistant="find">
  document.querySelectorAll('[data-assistant]').forEach((b) => b.addEventListener('click', () => window.oceAssistant.start(b.dataset.assistant)));
})();
