/* OCE interactive guide. Renders web/manual.js (window.OCE_MANUAL). No data leaves the page. */
(function () {
  'use strict';
  const M = window.OCE_MANUAL;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- remembered progress (per browser; storage can be unavailable) */
  const KEY = 'oce-guide-v1';
  let saved = { done: {}, golive: {} };
  try { saved = Object.assign(saved, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* private mode */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* ignore */ } };

  /* ---------- header + what's new */
  $('ver').textContent = 'v' + M.version;
  $('ver2').textContent = 'v' + M.version;
  $('upd').textContent = M.updated;
  const versions = Object.keys(M.whatsNew);
  const latest = M.whatsNew[M.version] || [];
  $('newBox').innerHTML = `<b>Version ${esc(M.version)}</b><ul class="new" style="margin-top:10px">${latest.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` +
    (versions.length > 1 ? `<details class="older"><summary>Earlier versions</summary>${versions.filter((v) => v !== M.version).map((v) =>
      `<p><b>${esc(v)}</b></p><ul>${M.whatsNew[v].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}</details>` : '');

  /* ---------- journey */
  $('journey').insertAdjacentHTML('beforeend', M.journey.map((j, i) =>
    `<button class="stop" data-go="${esc(j.id)}"><span class="n">${i + 1}</span><span class="ic">${j.icon}</span><b>${esc(j.title)}</b><small>${esc(j.blurb)}</small></button>`).join(''));
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

  /* ---------- chapter cards + sections */
  const chapters = M.chapters;
  $('chips').innerHTML = chapters.map((c) =>
    `<button class="chip" data-go="${esc(c.id)}" data-ch="${esc(c.id)}"><span class="done">✓</span><span class="e">${c.icon}</span><b>${esc(c.title)}</b><span>${esc(c.tagline)}</span></button>`).join('');
  $('chips').querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

  $('chapterList').innerHTML = chapters.map((c) => {
    const hasWalk = c.steps && c.steps.length;
    const searchText = [c.title, c.tagline].concat((c.steps || []).map((s) => s.title + ' ' + s.text), c.tips || []).join(' ');
    return `<section class="chapter" id="${esc(c.id)}" data-search="${esc(searchText)}">
      <div class="ch-head"><span class="e">${c.icon}</span><div><h3>${esc(c.title)}</h3><p>${esc(c.tagline)}</p></div>
        <a class="btn open" href="index.html#${esc(c.open)}">Open ${esc(c.open)} ↗</a></div>
      ${hasWalk ? `<div class="card walk">
        <div><div class="steps">${c.steps.map((s, i) => `<button class="step" data-i="${i}"><span class="num">${i + 1}</span><span><b>${esc(s.title)}</b><small>${esc(s.text)}</small></span></button>`).join('')}</div>
          <div class="walk-ctrl"><button class="btn primary play">▶ Play</button><button class="btn prev" aria-label="Previous step">←</button><button class="btn next" aria-label="Next step">→</button><span class="dots"></span></div></div>
        <div class="mock" aria-hidden="true"></div></div>` : (c.id === 'golive' ? `<div class="card"><p style="margin:0">Use the <a href="#golive-list">go-live checklist</a> below. It walks you through free sending with Resend, one tick at a time.</p></div>` : '')}
      ${(c.tips || []).length ? `<ul class="tips">${c.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <label class="mark"><input type="checkbox" data-done="${esc(c.id)}"> I've got this chapter</label>
    </section>`;
  }).join('');

  document.querySelectorAll('[data-done]').forEach((box) => {
    box.checked = !!saved.done[box.dataset.done];
    box.addEventListener('change', () => { saved.done[box.dataset.done] = box.checked; persist(); refreshProgress(box.checked); });
  });
  function refreshProgress(justTicked) {
    const n = chapters.filter((c) => saved.done[c.id]).length;
    $('pbar').style.width = Math.round((n / chapters.length) * 100) + '%';
    document.querySelectorAll('.chip').forEach((ch) => ch.classList.toggle('is-done', !!saved.done[ch.dataset.ch]));
    if (justTicked && n === chapters.length) confetti();
  }
  refreshProgress(false);

  /* ---------- animated walkthroughs */
  const CURSOR = '<svg class="cursor" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.5L9 20z" fill="#0f172a" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const FAKE = {
    review: { head: ['Contact', 'Organisation', 'Score'], rows: [['info@sunrise-lodge.example', 'Sunrise Lodge', '82'], ['hello@example-bank.example', 'Example Bank', '74'], ['sales@acme.example', 'Acme Traders', '41']] },
    contacts: { head: ['E-mail', 'Name', 'Eligible'], rows: [['info@sunrise-lodge.example', 'Sunrise Lodge', 'yes'], ['hello@example-bank.example', 'Example Bank', 'yes'], ['old@acme.example', 'Acme Traders', 'no']] }
  };
  function renderScreen(name) {
    const sc = M.mockScreens[name];
    const items = sc.items.map((it) => {
      const t = esc(it.label);
      if (it.kind === 'input') return `<div class="m-input" data-t="${t}">${t}<div><span class="val"></span></div></div>`;
      if (it.kind === 'button') return `<span class="m-btn${it.primary ? ' primary' : ''}" data-t="${t}">${t}</span>`;
      if (it.kind === 'select') return `<span class="m-select" data-t="${t}">${t} ▾</span>`;
      if (it.kind === 'progress') return `<div class="m-progress" data-t="${t}">Banks in Uganda · ${t}<div class="track"><div class="fill"></div></div></div>`;
      if (it.kind === 'rows') {
        const f = FAKE[name] || FAKE.review;
        return `<div class="m-rows" data-t="${t}"><div><span></span>${f.head.map((h) => `<span>${esc(h)}</span>`).join('')}</div>${f.rows.map((r) =>
          `<div><span class="box"></span><span>${esc(r[0])}</span><span>${esc(r[1])}</span><span class="${r[2] === 'yes' ? 'tag-yes' : r[2] === 'no' ? 'tag-no' : ''}">${esc(r[2])}</span></div>`).join('')}</div>`;
      }
      return '';
    }).join('');
    return `<div class="bar"><i></i><i></i><i></i><b>OCE · ${esc(sc.title)}</b></div><div class="body">${items}</div>${CURSOR}`;
  }
  function find(mock, label) { return mock.querySelector(`[data-t="${CSS.escape(label)}"]`); }
  async function moveTo(mock, el, token) {
    const cur = mock.querySelector('.cursor');
    const a = mock.getBoundingClientRect(), b = el.getBoundingClientRect();
    cur.style.left = (b.left - a.left + Math.min(b.width * 0.6, b.width - 8)) + 'px';
    cur.style.top = (b.top - a.top + b.height * 0.55) + 'px';
    await sleep(reduced ? 0 : 850);
    return token.alive;
  }
  function ripple(mock, el) {
    const a = mock.getBoundingClientRect(), b = el.getBoundingClientRect();
    const r = document.createElement('span');
    r.className = 'ripple';
    r.style.left = (b.left - a.left + Math.min(b.width * 0.6, b.width - 8)) + 'px';
    r.style.top = (b.top - a.top + b.height * 0.55) + 'px';
    mock.appendChild(r);
    el.classList.add('press');
    setTimeout(() => { el.classList.remove('press'); r.remove(); }, 600);
  }
  async function playStep(walk, chapter, i, token) {
    const step = chapter.steps[i];
    const mock = walk.querySelector('.mock');
    walk.querySelectorAll('.step').forEach((s, k) => s.classList.toggle('on', k === i));
    walk.querySelector('.dots').textContent = `Step ${i + 1} of ${chapter.steps.length}`;
    mock.innerHTML = renderScreen(step.mock.screen);
    await sleep(reduced ? 0 : 350);
    if (!token.alive) return false;
    if (step.mock.tick) {
      const boxes = mock.querySelectorAll('.m-rows .box');
      for (let k = 0; k < Math.min(2, boxes.length); k++) {
        if (!(await moveTo(mock, boxes[k], token))) return false;
        ripple(mock, boxes[k]); boxes[k].classList.add('on');
      }
    }
    if (step.mock.type) {
      const field = find(mock, step.mock.type.into);
      if (field) {
        if (!(await moveTo(mock, field, token))) return false;
        ripple(mock, field); field.classList.add('focus');
        const val = field.querySelector('.val');
        val.insertAdjacentHTML('afterend', '<span class="caret"></span>');
        for (const ch of step.mock.type.text) {
          if (!token.alive) return false;
          val.textContent += ch;
          await sleep(reduced ? 0 : 45);
        }
      }
    }
    if (step.mock.click) {
      const btn = find(mock, step.mock.click);
      if (btn) { if (!(await moveTo(mock, btn, token))) return false; ripple(mock, btn); }
    }
    if (step.mock.progress) {
      const fill = mock.querySelector('.m-progress .fill');
      if (fill) { await sleep(150); fill.style.width = '100%'; await sleep(reduced ? 0 : 2400); }
    }
    return token.alive;
  }
  const players = {};
  chapters.filter((c) => c.steps && c.steps.length).forEach((c) => {
    const walk = document.querySelector(`#${CSS.escape(c.id)} .walk`);
    const p = players[c.id] = { i: 0, token: { alive: false }, playing: false, seen: false };
    const playBtn = walk.querySelector('.play');
    const stop = () => { p.token.alive = false; p.playing = false; playBtn.textContent = '▶ Play'; };
    const show = async (i, auto) => {
      p.token.alive = false;
      const token = p.token = { alive: true };
      p.i = i;
      const ok = await playStep(walk, c, i, token);
      if (!ok || !auto || !p.playing) return;
      await sleep(reduced ? 600 : 1500);
      if (!token.alive || !p.playing) return;
      if (i + 1 < c.steps.length) show(i + 1, true); else stop();
    };
    p.start = () => { p.playing = true; playBtn.textContent = '⏸ Pause'; show(p.i >= c.steps.length - 1 ? 0 : p.i, true); };
    playBtn.addEventListener('click', () => (p.playing ? stop() : p.start()));
    walk.querySelector('.prev').addEventListener('click', () => { stop(); show(Math.max(0, p.i - 1), false); });
    walk.querySelector('.next').addEventListener('click', () => { stop(); show(Math.min(c.steps.length - 1, p.i + 1), false); });
    walk.querySelectorAll('.step').forEach((s) => s.addEventListener('click', () => { stop(); show(Number(s.dataset.i), false); }));
    walk.querySelector('.mock').innerHTML = renderScreen(c.steps[0].mock.screen);
    walk.querySelector('.steps .step').classList.add('on');
    walk.querySelector('.dots').textContent = `Step 1 of ${c.steps.length}`;
  });
  // Play a walkthrough the first time it scrolls into view.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      const p = players[e.target.id];
      if (e.isIntersecting && p && !p.seen) { p.seen = true; p.start(); }
    }), { threshold: 0.45 });
    Object.keys(players).forEach((id) => io.observe($(id)));
  }

  function go(id) {
    const el = $(id) || $(id + '-list');
    if (!el) return;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', '#' + id);
  }

  /* ---------- objective checker (mirrors the engine's discovery rules) */
  const COUNTRIES = ['uganda', 'ugandan', 'kampala', 'entebbe', 'jinja', 'gulu', 'mbarara', 'mbale', 'kenya', 'kenyan', 'nairobi', 'mombasa', 'tanzania', 'dar es salaam', 'rwanda', 'kigali', 'burundi', 'nigeria', 'lagos', 'ghana', 'accra', 'zambia', 'ethiopia', 'south africa', 'united kingdom', 'usa', 'united states'];
  const OPEN_DATA = ['bank', 'hotel', 'resort', 'lodge', 'university', 'college', 'school', 'hospital', 'insurance', 'ngo', 'non-profit', 'charity', 'telecom', 'airline', 'newspaper', 'radio', 'television', 'museum', 'embassy', 'ministry', 'agency', 'authority', 'manufactur', 'sacco', 'microfinance', 'church', 'football club', 'stadium'];
  const REGISTERS = { audit: 'ICPAU\'s register of licensed firms', accountan: 'ICPAU\'s register of licensed firms', lawyer: 'the Uganda Law Society', advocate: 'the Uganda Law Society', 'law firm': 'the Uganda Law Society', doctor: 'the medical council', clinic: 'the medical council', startup: 'the Startup Uganda directory', tour: 'the Uganda Tourism Board' };
  const GENERIC = ['company', 'companies', 'business', 'businesses', 'firm', 'firms', 'organisation', 'organisations', 'organization', 'organizations', 'people', 'contacts', 'leads', 'everyone'];
  function judge(text) {
    const t = ' ' + text.toLowerCase().replace(/[^a-z\- ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
    if (text.trim().length < 3) return ['idle', 'Start typing…'];
    const place = COUNTRIES.find((c) => t.includes(' ' + c + ' '));
    const words = t.trim().split(' ').filter((w) => w.length > 2 && !['in', 'the', 'and', 'for', 'with', 'list', 'all'].includes(w) && !COUNTRIES.some((c) => c.split(' ').includes(w)));
    const specific = words.filter((w) => !GENERIC.includes(w));
    const open = OPEN_DATA.find((k) => t.includes(k));
    const regKey = Object.keys(REGISTERS).find((k) => t.includes(k));
    if (!specific.length) return ['bad', '🤔 Too broad. Say what kind: "Hotels in Uganda", "NGOs in Kenya", "Insurance companies in Uganda".'];
    if (!place) return ['meh', '📍 Add a country, e.g. "' + text.trim() + ' in Uganda". OCE uses it to pick the right sources and phone format.'];
    if (open) return ['good', '🎉 Great objective. Wikipedia and Wikidata list these with their official websites, so expect plenty of starting points.'];
    if (regKey) return ['good', '👍 Good. These are rarely on Wikipedia, but OCE goes straight to ' + REGISTERS[regKey] + '.'];
    return ['meh', '🙂 OCE will try, but this group is niche. For best results, paste a directory or association member page under Options → Extra starting URLs.'];
  }
  const objIn = $('obj'), objOut = $('objOut');
  const runJudge = () => { const [cls, msg] = judge(objIn.value); objOut.className = 'verdict ' + cls; objOut.textContent = msg; };
  objIn.addEventListener('input', runJudge);
  $('objEx').innerHTML = ['Banks in Uganda', 'Audit firms in Kampala, Uganda', 'Hair salons', 'Companies in Uganda', 'Hotels in Kenya'].map((x) => `<button type="button">${esc(x)}</button>`).join('');
  $('objEx').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { objIn.value = b.textContent; runJudge(); }));

  /* ---------- basis helper */
  const TREE = {
    start: { q: 'Did this person or organisation say yes to hearing from you? (a form, a sign-up sheet, a written yes)', yes: 'consent', no: 'b2b' },
    b2b: { q: 'Is it a business contact at a work address, and does your offer clearly fit their job?', yes: 'li', no: 'customer' },
    customer: { q: 'Are they already your customer?', yes: 'contract', no: 'none' },
    consent: { a: '✅ Pick "Basis: consent obtained" and type where the yes came from (e.g. "Expo 2026 sign-up sheet"). OCE can email them.', cls: 'good' },
    li: { a: '🟡 Pick "Basis: legitimate interest (B2B)". OCE only emails these after you switch ALLOW_LEGITIMATE_INTEREST to TRUE in Settings. Keep emails short, relevant, and easy to opt out of.', cls: 'meh' },
    contract: { a: '🟡 Pick "Basis: existing customer/contract" to keep the record, but OCE won\'t email on that alone. Ask them to opt in, then record consent.', cls: 'meh' },
    none: { a: '⛔ Don\'t email them. Choose "Basis: none yet" or Reject. You need a yes first.', cls: 'bad' }
  };
  function basis(node) {
    const n = TREE[node];
    const box = $('basisBox');
    if (n.a) {
      box.innerHTML = `<div class="verdict ${n.cls}">${esc(n.a)}</div><div><button class="btn" type="button" id="bAgain">↺ Start again</button></div>`;
      $('bAgain').addEventListener('click', () => basis('start'));
      return;
    }
    box.innerHTML = `<div>${esc(n.q)}</div><div class="opts"><button type="button" data-n="${n.yes}">Yes</button><button type="button" data-n="${n.no}">No</button></div>`;
    box.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => basis(b.dataset.n)));
  }
  basis('start');

  /* ---------- go-live checklist */
  $('goLive').innerHTML = M.goLive.map((s, i) => `<li><label><input type="checkbox" data-gl="${i}"><span>${esc(s)}</span></label></li>`).join('');
  const glBoxes = document.querySelectorAll('[data-gl]');
  const glRefresh = (celebrate) => {
    const n = [...glBoxes].filter((b) => b.checked).length;
    $('glCount').textContent = `${n}/${glBoxes.length} done`;
    $('glFill').style.width = (n / glBoxes.length * 100) + '%';
    if (celebrate && n === glBoxes.length) confetti();
  };
  glBoxes.forEach((b) => {
    b.checked = !!saved.golive[b.dataset.gl];
    b.addEventListener('change', () => { saved.golive[b.dataset.gl] = b.checked; persist(); glRefresh(b.checked); });
  });
  glRefresh(false);

  /* ---------- settings reference */
  const groups = ['All'].concat([...new Set(M.settings.map((s) => s.group))]);
  let group = 'All';
  const drawSettings = () => {
    $('setSeg').innerHTML = groups.map((g) => `<button type="button" class="${g === group ? 'on' : ''}">${esc(g)}</button>`).join('');
    $('setSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { group = b.textContent; drawSettings(); }));
    $('setRows').innerHTML = M.settings.filter((s) => group === 'All' || s.group === group)
      .map((s) => `<tr><td>${esc(s.key)}</td><td>${s.def === '' ? '<span style="color:var(--muted)">empty</span>' : esc(s.def)}</td><td>${esc(s.plain)}</td></tr>`).join('');
  };
  drawSettings();
  $('settings-ref').dataset.search += ' ' + M.settings.map((s) => s.key + ' ' + s.plain).join(' ');

  /* ---------- troubleshooting */
  $('faq').innerHTML = M.troubles.map((t) => `<details data-search="${esc(t.q + ' ' + t.fix)}"><summary>${esc(t.q)}</summary><p>${esc(t.fix)}</p></details>`).join('');

  /* ---------- search */
  $('q').addEventListener('input', () => {
    const q = $('q').value.trim().toLowerCase();
    let hits = 0;
    document.querySelectorAll('.chapter').forEach((sec) => {
      const own = (sec.dataset.search || '') + ' ' + sec.textContent;
      const match = !q || own.toLowerCase().includes(q);
      sec.classList.toggle('hide', !match);
      if (match) hits++;
    });
    document.querySelectorAll('.chip').forEach((ch) => {
      const sec = $(ch.dataset.ch);
      ch.style.display = sec && sec.classList.contains('hide') ? 'none' : '';
    });
    document.querySelectorAll('.faq details').forEach((d) => {
      const m = !q || d.dataset.search.toLowerCase().includes(q);
      d.style.display = m ? '' : 'none';
      if (q && m) d.open = true;
    });
    $('noHits').classList.toggle('hidden', !!hits || !q);
  });

  /* ---------- confetti */
  function confetti() {
    if (reduced) return;
    const cv = $('confetti'), ctx = cv.getContext('2d');
    cv.width = innerWidth; cv.height = innerHeight;
    const colors = ['#99f6e4', '#0f766e', '#fbbf24', '#f472b6', '#60a5fa'];
    const bits = Array.from({ length: 140 }, () => ({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5, r: 4 + Math.random() * 5,
      vx: -2 + Math.random() * 4, vy: 2 + Math.random() * 4, a: Math.random() * 6, c: colors[Math.floor(Math.random() * colors.length)] }));
    let frames = 0;
    (function tick() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      bits.forEach((b) => { b.x += b.vx; b.y += b.vy; b.a += 0.1; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = b.c; ctx.fillRect(-b.r, -b.r / 2, b.r * 2, b.r); ctx.restore(); });
      if (++frames < 220) requestAnimationFrame(tick); else ctx.clearRect(0, 0, cv.width, cv.height);
    })();
  }

  /* ---------- deep link (help.html#review) */
  if (location.hash) setTimeout(() => go(location.hash.slice(1)), 200);
})();
