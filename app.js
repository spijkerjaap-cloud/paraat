/* ===========================================================
   Paraat — offline spaced-repetition (vanilla JS, SM-2)
   =========================================================== */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const DAY = 86400000;
const NEW_PER_SESSION = 20;      // max nieuwe kaarten per sessie per set
const SET_COLORS = ['#22d3ee', '#2ee06a', '#ffb454', '#ff5d6c', '#a78bfa', '#f472b6', '#38bdf8', '#facc15'];

let CARDS = [];
let SETS = [];               // [{name, color, ids:[]}]
let PROG = {};               // id -> {ef, reps, ivl, due, lapses}
let state = { view: 'home', set: null };

/* ---------- persistence ---------- */
const PKEY = 'paraat-progress-v1';
function loadProg() {
  try { PROG = JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { PROG = {}; }
}
function saveProg() { localStorage.setItem(PKEY, JSON.stringify(PROG)); }

const SKEY = 'paraat-stats-v1';
function stats() {
  try { return JSON.parse(localStorage.getItem(SKEY)) || { days: {}, streak: 0, last: null }; }
  catch { return { days: {}, streak: 0, last: null }; }
}
function bumpReview() {
  const s = stats();
  const today = new Date().toISOString().slice(0, 10);
  s.days[today] = (s.days[today] || 0) + 1;
  if (s.last !== today) {
    const y = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    s.streak = (s.last === y) ? (s.streak || 0) + 1 : 1;
    s.last = today;
  }
  localStorage.setItem(SKEY, JSON.stringify(s));
}

/* ---------- SM-2 ---------- */
function sched(card, q) {
  // q: 0=again, 3=hard, 4=good, 5=easy
  let p = PROG[card.id] || { ef: 2.5, reps: 0, ivl: 0, due: 0, lapses: 0 };
  if (q < 3) {
    p.reps = 0; p.ivl = 0; p.lapses = (p.lapses || 0) + 1;
    p.due = Date.now() + 60 * 1000;            // ~1 min, terug in deze sessie
  } else {
    if (p.reps === 0) p.ivl = (q === 5 ? 3 : 1);
    else if (p.reps === 1) p.ivl = (q === 5 ? 8 : 6);
    else p.ivl = Math.round(p.ivl * p.ef * (q === 3 ? 0.8 : q === 5 ? 1.3 : 1));
    p.reps += 1;
    p.ef = Math.max(1.3, p.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    p.due = Date.now() + Math.max(1, p.ivl) * DAY;
  }
  PROG[card.id] = p; saveProg();
}

/* ---------- set/queue helpers ---------- */
function isNew(id) { return !PROG[id]; }
function isDue(id) { const p = PROG[id]; return p && p.due <= Date.now(); }
function setStats(set) {
  let due = 0, neu = 0, learned = 0;
  for (const id of set.ids) {
    if (isNew(id)) neu++;
    else { learned++; if (isDue(id)) due++; }
  }
  return { due, neu, learned, total: set.ids.length };
}
function totalDueNew() {
  let due = 0, neu = 0;
  for (const c of CARDS) { if (isNew(c.id)) neu++; else if (isDue(c.id)) due++; }
  return { due, neu };
}

/* build a study queue for a set (or all) */
function buildQueue(set) {
  const ids = set ? set.ids : CARDS.map(c => c.id);
  const due = [], neu = [];
  for (const id of ids) {
    if (isDue(id)) due.push(id);
    else if (isNew(id)) neu.push(id);
  }
  shuffle(due); shuffle(neu);
  return due.concat(neu.slice(0, NEW_PER_SESSION)).map(id => CARDS[id]);
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- rendering ---------- */
function ecgSvg() {
  // one heartbeat segment, tiled for a seamless sweep
  const beat = 'l8 0 q2 0 3 -3 t3 6 t2 -22 t2 24 t3 -5 q1 -1 3 -1 l10 0';
  return `<div class="ecg"><svg viewBox="0 0 240 34" preserveAspectRatio="none">
    <path class="trace" d="M-2 17 ${beat} ${beat} ${beat} ${beat} ${beat} l6 0"/></svg></div>`;
}

function topbar() {
  return `<div class="topbar"><div class="monitor">
    <div class="brand">PAR<b>AA</b>T</div>
    ${ecgSvg()}
    <div class="bpm">72<small>BPM</small></div>
  </div></div>`;
}

function home() {
  const t = totalDueNew();
  const st = stats();
  let html = topbar();
  html += `<div class="readout">
    <div class="cell due"><div class="lbl">Te herhalen</div><div class="val">${t.due}</div></div>
    <div class="cell new"><div class="lbl">Nieuw</div><div class="val">${t.neu}</div></div>
    <div class="cell streak"><div class="lbl">Streak</div><div class="val">${st.streak || 0}<span style="font-size:13px;color:var(--muted)"> d</span></div></div>
  </div>`;

  const can = t.due + t.neu;
  html += `<button class="btn primary" ${can ? '' : 'disabled style="opacity:.5"'} data-study="">
    ${can ? '▶  Start review — alles' : 'Niets te doen — goed bezig'}</button>`;

  html += `<div class="section-title">Sets</div>`;
  for (const set of SETS) {
    const s = setStats(set);
    const pct = s.total ? Math.round(s.learned / s.total * 100) : 0;
    html += `<button class="set" data-openset="${esc(set.name)}">
      <span class="dot" style="color:${set.color}"></span>
      <span class="meta">
        <div class="nm">${esc(set.name)}</div>
        <div class="sub">${s.total} kaarten · ${pct}% gezien</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </span>
      <span style="display:flex;flex-direction:column;gap:5px;align-items:flex-end">
        ${s.due ? `<span class="pill due">${s.due}</span>` : ''}
        ${s.neu ? `<span class="pill new">+${s.neu}</span>` : ''}
      </span>
    </button>`;
  }
  html += `<div class="footer">Paraat · ${CARDS.length} kaarten · 100% offline<br>spaced repetition (SM-2)</div>`;
  app.innerHTML = html;
}

function setView(set) {
  const s = setStats(set);
  const pct = s.total ? Math.round(s.learned / s.total * 100) : 0;
  // sub-decks breakdown
  const subs = {};
  for (const id of set.ids) {
    const d = CARDS[id].deck;
    const sub = d.includes('::') ? d.split('::').slice(1).join(' · ') : '(algemeen)';
    subs[sub] = (subs[sub] || 0) + 1;
  }
  let html = topbar();
  html += `<button class="btn ghost" style="width:auto;padding:8px 4px;justify-content:flex-start" data-go="home">‹ Terug</button>`;
  html += `<div class="section-title"><span class="dot" style="color:${set.color};width:10px;height:10px;border-radius:50%;box-shadow:0 0 10px ${set.color}"></span> ${esc(set.name)}</div>`;
  html += `<div class="readout">
    <div class="cell due"><div class="lbl">Te herhalen</div><div class="val">${s.due}</div></div>
    <div class="cell new"><div class="lbl">Nieuw</div><div class="val">${s.neu}</div></div>
    <div class="cell"><div class="lbl">Gezien</div><div class="val" style="color:var(--cyan)">${pct}<span style="font-size:14px">%</span></div></div>
  </div>`;
  const can = s.due + s.neu;
  html += `<button class="btn primary" ${can ? '' : 'disabled style="opacity:.5"'} data-study="${esc(set.name)}">
    ${can ? '▶  Start review' : 'Alles gezien voor nu'}</button>`;
  html += `<div class="section-title">Onderdelen</div>`;
  for (const [sub, n] of Object.entries(subs).sort((a, b) => b[1] - a[1])) {
    html += `<div class="set" style="cursor:default">
      <span class="dot" style="color:${set.color};opacity:.5"></span>
      <span class="meta"><div class="nm" style="font-size:14px;font-weight:500">${esc(sub)}</div></span>
      <span class="pill">${n}</span></div>`;
  }
  app.innerHTML = html;
}

/* ---------- study session ---------- */
let session = null;
function startStudy(setName) {
  const set = setName ? SETS.find(s => s.name === setName) : null;
  const queue = buildQueue(set);
  if (!queue.length) { toast('Niets te doen hier'); return; }
  session = { setName, queue, total: queue.length, done: 0, card: null, revealed: false };
  nextCard();
}
function nextCard() {
  if (!session.queue.length) { return finishSession(); }
  session.card = session.queue.shift();
  session.revealed = false;
  renderCard();
}
function renderCard() {
  const c = session.card;
  const pct = Math.round(session.done / session.total * 100);
  const newBadge = isNew(c.id) ? '<b style="color:var(--green-glow)">NIEUW</b>' : '<b>HERHALING</b>';
  const q = c.type === 'cloze'
    ? esc(c.q).replace(/\[…\]/g, '<span class="blank">[ … ]</span>').replace(/\[(.+?)\]/g, '<span class="blank">[$1]</span>')
    : esc(c.q);
  let html = topbar();
  html += `<div class="study">
    <div class="crumbs"><span>${newBadge} · ${esc(shortDeck(c.deck))}</span><span>${session.done + 1}/${session.total}</span></div>
    <div class="progress-line"><i style="width:${pct}%"></i></div>
    <div class="card">
      <div class="q">${q}</div>
      <div id="ansArea"></div>
      ${c.tags && c.tags.length ? `<div class="tags">${c.tags.slice(0, 6).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>`;
  if (!session.revealed) {
    html += `<button class="btn primary" style="margin-top:14px" data-reveal="1">Toon antwoord</button>
      <div class="hint">tik op de kaart of de knop</div>`;
  }
  html += `</div>`;
  app.innerHTML = html;
  if (!session.revealed) $('.card').onclick = reveal;
  if (session.revealed) renderAnswer();
}
function reveal() { session.revealed = true; renderAnswer(); }
function renderAnswer() {
  const c = session.card;
  const ans = $('#ansArea');
  ans.innerHTML = `<div class="divider"></div>
    <div class="a">${esc(c.a)}</div>
    ${c.extra ? `<div class="extra">${esc(c.extra)}</div>` : ''}`;
  // grade buttons under card
  if (!$('#gradeRow')) {
    const g = document.createElement('div');
    g.id = 'gradeRow';
    g.className = 'reveal-wrap';
    g.innerHTML = `<div class="grades">
      <button class="grade again" data-grade="0"><div class="g">Opnieuw</div><div class="t">&lt;1 min</div></button>
      <button class="grade hard" data-grade="3"><div class="g">Lastig</div><div class="t">${ivlPreview(3)}</div></button>
      <button class="grade good" data-grade="4"><div class="g">Goed</div><div class="t">${ivlPreview(4)}</div></button>
      <button class="grade easy" data-grade="5"><div class="g">Makkelijk</div><div class="t">${ivlPreview(5)}</div></button>
    </div>`;
    $('.study').appendChild(g);
  }
  const card = $('.card'); if (card) card.onclick = null;
}
function ivlPreview(q) {
  const c = session.card;
  let p = PROG[c.id] || { ef: 2.5, reps: 0, ivl: 0 };
  let ivl;
  if (p.reps === 0) ivl = (q === 5 ? 3 : q === 3 ? 1 : 1);
  else if (p.reps === 1) ivl = (q === 5 ? 8 : 6);
  else ivl = Math.round(p.ivl * p.ef * (q === 3 ? 0.8 : q === 5 ? 1.3 : 1));
  ivl = Math.max(1, ivl);
  return ivl >= 30 ? Math.round(ivl / 30) + ' mnd' : ivl + ' d';
}
function grade(q) {
  const c = session.card;
  sched(c, q);
  bumpReview();
  if (q < 3) { session.queue.push(c); }   // requeue this session
  else { session.done++; }
  nextCard();
}
function finishSession() {
  let html = topbar();
  html += `<div class="empty">
    <div class="big">✓</div>
    <div class="flatline"></div>
    <h3 style="margin:6px 0 2px">Sessie klaar</h3>
    <p>${session.done} kaarten herhaald${session.setName ? ' · ' + esc(session.setName) : ''}.<br>Streak: ${stats().streak} ${stats().streak === 1 ? 'dag' : 'dagen'}.</p>
  </div>
  <button class="btn primary" ${session.setName ? `data-openset="${esc(session.setName)}"` : `data-go="home"`}>Verder</button>
  <button class="btn ghost" style="margin-top:8px" data-go="home">Naar overzicht</button>`;
  app.innerHTML = html;
  session = null;
}

/* ---------- nav ---------- */
function go(v) { state.view = v; render(); }
function openSet(name) { state.view = 'set'; state.set = name; render(); }
function render() {
  window.scrollTo(0, 0);
  if (state.view === 'home') home();
  else if (state.view === 'set') setView(SETS.find(s => s.name === state.set));
}
// Single delegated handler — reliable on touch devices, no inline-onclick escaping
function wireDelegation() {
  app.addEventListener('click', (e) => {
    const t = e.target;
    const os = t.closest('[data-openset]'); if (os) { openSet(os.dataset.openset); return; }
    const su = t.closest('[data-study]'); if (su) { startStudy(su.dataset.study === '' ? null : su.dataset.study); return; }
    const gv = t.closest('[data-go]'); if (gv) { go(gv.dataset.go); return; }
    const rv = t.closest('[data-reveal]'); if (rv) { reveal(); return; }
    const gr = t.closest('[data-grade]'); if (gr) { grade(+gr.dataset.grade); return; }
  });
}

/* ---------- utils ---------- */
function esc(s) { return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
function shortDeck(d) { const p = d.split('::'); return p[p.length - 1]; }
let toastT;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------- boot ---------- */
async function boot() {
  wireDelegation();
  loadProg();
  const res = await fetch('cards.json');
  CARDS = await res.json();
  CARDS.forEach((c, i) => { c.id = i; });   // ensure stable index id
  // group into sets by top-level
  const map = new Map();
  for (const c of CARDS) {
    if (!map.has(c.set)) map.set(c.set, []);
    map.get(c.set).push(c.id);
  }
  SETS = [...map.entries()]
    .map(([name, ids], i) => ({ name, ids, color: SET_COLORS[i % SET_COLORS.length] }))
    .sort((a, b) => b.ids.length - a.ids.length);
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
}
boot();
