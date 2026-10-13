import { CONFIG, LITE, SLOTS, DEFAULT_PRESETS, DEFAULT_SCHEDULE } from './config.js';
import { loadWeather, renderWeather, esc } from './weather.js';
import { Slideshow, photoStory, nameList } from './photos.js';
import { Editor } from './editor.js';

window.dashboardStarted = true;
document.documentElement.classList.toggle('lite', LITE);

const $ = (s) => document.querySelector(s);
const body = document.body;
const widgets = Object.fromEntries([...document.querySelectorAll('[data-w]')].map((el) => [el.dataset.w, el]));

// ---------- persisted state (per-screen for now; server-side in v1) ----------

const store = {
  get(k, fallback) { try { const v = localStorage.getItem(`frame.${k}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(`frame.${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};
const clone = (o) => JSON.parse(JSON.stringify(o));

const state = {
  presets: store.get('presets', clone(DEFAULT_PRESETS)),
  schedule: store.get('schedule', clone(DEFAULT_SCHEDULE)),
  activeId: store.get('active', DEFAULT_PRESETS[0].id),
  auto: store.get('auto', true),
  weather: null,
  paused: false,
};
const params = new URLSearchParams(location.search);
if (params.get('preset')) { state.activeId = params.get('preset'); state.auto = false; }
let applied = null;

const active = () => state.presets.find((p) => p.id === state.activeId) ?? state.presets[0];
const ctx = () => ({ weather: state.weather });

// ---------- toast ----------

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---------- slideshow ----------

const show = new Slideshow({
  stage: $('#stage'),
  ambient: $('#ambient'),
  onNotice: toast,
  onShow(frame) {
    document.documentElement.style.setProperty('--accent', frame.accent);
    const s = photoStory(frame.asset);
    // Stack, top to bottom: location and people (each only when known), then the time-ago label and
    // the date, which are always there. The block is bottom-anchored, so a missing optional line
    // just leaves nothing above the date and never moves it.
    widgets.caption.innerHTML = `
      ${s.place ? `<div class="cap-place">${esc(s.place)}</div>` : ''}
      ${s.names.length ? '<div class="cap-people"></div>' : ''}
      <div class="cap-kicker">${esc(s.kicker)}</div>
      <div class="cap-title"><span class="cap-wd">${esc(s.weekday)}, </span>${esc(s.date)}</div>`;
    captionNames = s.names;
    fitCaption();
  },
});

// Keep the caption on single lines: shrink the date if it is too wide (down to 60%), then show as
// many names as fit and collapse the rest into "+N". Re-runs when the caption moves or resizes.
let captionNames = [];
function fitCaption() {
  const cap = widgets.caption;
  const title = cap.querySelector('.cap-title'), people = cap.querySelector('.cap-people');
  if (!title) return;
  const fits = (el) => !el.clientWidth || el.scrollWidth <= el.clientWidth; // clientWidth 0: not placed yet
  for (let k = 1; k >= 0.6; k -= 0.05) {
    cap.style.setProperty('--tk', k.toFixed(2));
    if (fits(title)) break;
  }
  if (!people) return;
  for (let n = captionNames.length; n >= 1; n--) {
    people.textContent = nameList(captionNames, n);
    if (fits(people)) return;
  }
}
new ResizeObserver(fitCaption).observe(widgets.caption);

// ---------- presets ----------

function placeWidgets(p) {
  const pool = $('#pool');
  for (const el of Object.values(widgets)) pool.append(el);
  for (const slot of document.querySelectorAll('.slot')) slot.hidden = !(slot.id in SLOTS[p.layout]);
  for (const [slotId, list] of Object.entries(SLOTS[p.layout])) {
    const slot = document.getElementById(slotId);
    for (const w of list) if (p.widgets[w]) slot.append(widgets[w]);
  }
  body.classList.toggle('no-photo', p.layout === 'night' && !p.widgets.photo);
}

function applyPreset(id, note) {
  state.activeId = id;
  store.set('active', id);
  const p = active();
  const sourceChanged = !applied || JSON.stringify(applied.source) !== JSON.stringify(p.source);
  body.dataset.layout = p.layout;
  placeWidgets(p);
  show.configure({ interval: p.interval, kenBurns: p.kenBurns });
  if (sourceChanged) show.setSource(p.source, ctx());
  applied = clone(p);
  renderDock();
  if (note) toast(`${p.name}${note}`);
}

function choosePreset(id) {
  if (state.auto) { state.auto = false; store.set('auto', false); applyPreset(id, ' · auto schedule paused'); }
  else applyPreset(id, '');
}

function nowHM() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: CONFIG.location.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

function scheduledPreset() {
  const rows = [...state.schedule].sort((a, b) => a.from.localeCompare(b.from));
  const hm = nowHM();
  return (rows.filter((r) => r.from <= hm).pop() ?? rows[rows.length - 1])?.preset;
}

function checkSchedule() {
  if (!state.auto || !applied) return;
  const id = scheduledPreset();
  if (id && id !== state.activeId && state.presets.some((p) => p.id === id)) applyPreset(id, ' · scheduled');
}

function setAuto(on) {
  state.auto = on;
  store.set('auto', on);
  if (on) { const id = scheduledPreset(); if (id && id !== state.activeId) applyPreset(id, ' · auto schedule'); else { renderDock(); toast('Auto schedule on'); } }
  else { renderDock(); toast('Auto schedule off'); }
}

// ---------- clock ----------

const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.location.tz, hour: 'numeric', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.location.tz, weekday: 'long', month: 'long', day: 'numeric' });
let lastMinute = '';
function tick() {
  const now = new Date();
  const parts = fmtTime.formatToParts(now);
  const t = parts.filter((p) => ['hour', 'literal', 'minute'].includes(p.type) && p.value.trim() !== '').map((p) => p.value).join('');
  const ap = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
  if (t === lastMinute) return;
  lastMinute = t;
  widgets.clock.innerHTML = `<div class="time num"><span>${t}</span><span class="ap">${ap}</span></div><div class="date">${fmtDay.format(now)}</div>`;
  checkSchedule();
  // Night mode: nudge the clock a little every minute to spare the panel.
  body.style.setProperty('--drift-x', `${(Math.random() - 0.5) * 3}vw`);
  body.style.setProperty('--drift-y', `${(Math.random() - 0.5) * 3}vh`);
}

// ---------- weather ----------

async function refreshWeather() {
  try {
    state.weather = await loadWeather();
    renderWeather(widgets, state.weather);
    show.setContext(ctx());
  } catch (e) {
    console.warn('weather', e);
    if (!state.weather) toast(CONFIG.location.lat == null ? 'Weather is off: set DASHBOARD_LATITUDE and DASHBOARD_LONGITUDE' : 'Weather unavailable — retrying');
  }
}

// ---------- dock + input ----------

const ICON = {
  prev: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  auto: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
};

function renderDock() {
  $('#dock').innerHTML = `
    <div class="dock-group">
      ${state.presets.map((p, i) => `<button class="preset ${p.id === state.activeId ? 'active' : ''}" data-act="preset" data-id="${esc(p.id)}" title="${i + 1}">${esc(p.name)}</button>`).join('')}
    </div>
    <i class="dock-sep"></i>
    <button class="icon auto ${state.auto ? 'active' : ''}" data-act="auto" title="Auto schedule (A)">${ICON.auto}<span>Auto</span></button>
    <i class="dock-sep"></i>
    <button class="icon" data-act="prev" title="Previous (←)">${ICON.prev}</button>
    <button class="icon" data-act="pause" title="Pause (Space)">${state.paused ? ICON.play : ICON.pause}</button>
    <button class="icon" data-act="next" title="Next (→)">${ICON.next}</button>
    <button class="icon" data-act="edit" title="Customize (E)">${ICON.edit}</button>`;
}

function togglePause() {
  state.paused = !state.paused;
  show.setPaused(state.paused);
  renderDock();
  toast(state.paused ? 'Paused' : 'Playing');
}

const editor = new Editor($('#editor'), {
  state,
  save() { store.set('presets', state.presets); store.set('schedule', state.schedule); renderDock(); },
  changed(id) { if (id === state.activeId) applyPreset(id); },
  apply: choosePreset,
  setAuto,
  reset() {
    state.presets = clone(DEFAULT_PRESETS);
    state.schedule = clone(DEFAULT_SCHEDULE);
    store.set('presets', state.presets); store.set('schedule', state.schedule);
    applied = null;
    applyPreset(state.presets[0].id, ' · presets reset');
  },
});

$('#dock').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  ({
    preset: () => choosePreset(b.dataset.id),
    auto: () => setAuto(!state.auto),
    prev: () => show.prev(),
    next: () => show.next(),
    pause: togglePause,
    edit: () => editor.toggle(),
  })[b.dataset.act]?.();
});

let idleTimer;
function wake() {
  body.classList.add('show-dock');
  body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!editor.isOpen) { body.classList.remove('show-dock'); body.classList.add('idle'); } }, CONFIG.dockHideMs);
}
addEventListener('pointermove', wake);

let swipeX = null;
addEventListener('pointerdown', (e) => { wake(); swipeX = e.target.closest('#dock, #editor') ? null : e.clientX; });
addEventListener('pointerup', (e) => {
  if (swipeX == null) return;
  const dx = e.clientX - swipeX;
  swipeX = null;
  if (Math.abs(dx) > 80) dx < 0 ? show.next() : show.prev();
});

addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey) return;
  if (/^[1-9]$/.test(e.key)) { const p = state.presets[+e.key - 1]; if (p) choosePreset(p.id); return; }
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const actions = {
    ArrowRight: () => show.next(),
    ArrowLeft: () => show.prev(),
    ' ': togglePause,
    a: () => setAuto(!state.auto),
    e: () => editor.toggle(),
    f: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
    Escape: () => editor.close(),
  };
  if (actions[k]) { e.preventDefault(); actions[k](); wake(); }
});

// ---------- boot ----------

(async () => {
  renderDock();
  tick();
  setInterval(tick, 1000);
  const first = refreshWeather();
  if (state.auto) state.activeId = scheduledPreset() ?? state.activeId;
  // Only a weather-matched preset needs to wait (briefly) for the forecast before picking photos.
  if (active().source.type === 'weather') await Promise.race([first, new Promise((r) => setTimeout(r, 4000))]);
  applyPreset(state.activeId);
  setInterval(refreshWeather, CONFIG.weatherRefreshMin * 60 * 1000);
  // ?ui=dock or ?ui=edit pins the controls open (handy for setup and screenshots).
  if (params.has('ui')) body.classList.add('show-dock'); else body.classList.add('idle');
  if (params.get('ui') === 'edit') editor.open();
})();
