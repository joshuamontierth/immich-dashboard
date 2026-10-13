import { CONFIG, LITE } from './config.js';
import { isPrecip } from './weather.js';

const BATCH = 40;
// Longer than nginx's 30s upstream timeout, so a slow Immich shows up as an HTTP 504 rather than
// a client-side abort (which the ImmichFrame Android app may treat as a network error and reload).
const LOAD_TIMEOUT_MS = 35000;
const HISTORY = 20;

// All Immich calls go through the nginx allowlist at /immich/*, which adds the API key.
export async function api(path, init) {
  const r = await fetch(`/immich/${path}`, init);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const random = (filters) => post('search/random', { type: 'IMAGE', withExif: true, withPeople: true, size: BATCH, ...filters });
const smart = async (query) => (await post('search/smart', { query, type: 'IMAGE', withExif: true, size: 100 })).assets.items;

async function memories() {
  const now = Date.now();
  const list = await api('memories');
  return list
    .filter((m) => m.type === 'on_this_day' && Math.abs(new Date(m.showAt) - now) < 3.5 * 864e5)
    .flatMap((m) => m.assets);
}

// On this day within one album. Immich's memories cover the whole library, so instead search
// this week's date window in every past year the album spans.
async function albumOnThisDay(albumId) {
  const album = await api(`albums/${albumId}?withoutAssets=true`);
  const now = new Date();
  const span = 3.5 * 864e5;
  const years = [];
  for (let y = now.getFullYear() - 1; y >= new Date(album.startDate ?? now).getFullYear(); y--) years.push(y);
  const perYear = await Promise.all(years.map((y) => {
    const center = new Date(now);
    center.setFullYear(y);
    return post('search/metadata', {
      albumIds: [albumId], type: 'IMAGE', withExif: true, withPeople: true, size: 250,
      takenAfter: new Date(center - span).toISOString(), takenBefore: new Date(+center + span).toISOString(),
    }).then((r) => r.assets.items).catch(() => []);
  }));
  return perYear.flat();
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const usable = (a) => a.type === 'IMAGE' && !a.isTrashed && !['hidden', 'locked'].includes(a.visibility);

// CLIP query that matches what it looks like outside right now.
export function weatherQuery(w) {
  if (!w) return 'beautiful landscape outdoors';
  const { code, isDay } = w.current;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if (code >= 95) return 'dramatic storm clouds';
  if (isPrecip(code)) return 'rainy day';
  if (code === 45 || code === 48) return 'fog and mist';
  if (!isDay) return 'night lights evening';
  const month = new Date().getMonth();
  const season = month >= 8 && month <= 10 ? 'autumn ' : month <= 1 || month === 11 ? 'winter ' : '';
  return code <= 1 ? `sunny ${season}day outdoors blue sky` : `${season}cloudy sky outdoors`;
}

// -> { items, finite, detail }. Smart/memory results are fixed lists we loop through;
// random-backed sources are refilled with fresh batches forever.
async function fetchSource(source, ctx) {
  switch (source.type) {
    case 'album': return { items: await random(source.albumId ? { albumIds: [source.albumId] } : {}) };
    case 'favorites': return { items: await random({ isFavorite: true }) };
    case 'people': return { items: await random(source.personIds?.length ? { personIds: source.personIds } : {}) };
    case 'everything': return { items: await random({}) };
    case 'smart': return { items: shuffle(await smart(source.query || 'beautiful landscape')), finite: true, detail: true };
    case 'weather': return { items: shuffle(await smart(weatherQuery(ctx.weather))), finite: true, detail: true };
    case 'memories': return source.albumId
      ? { items: shuffle(await albumOnThisDay(source.albumId)), finite: true }
      : { items: shuffle(await memories()), finite: true, detail: true };
    default: return { items: [] };
  }
}
const sourceKey = (source, ctx) => JSON.stringify(source) + (source.type === 'weather' ? weatherQuery(ctx.weather) : '');

// ---------- image analysis ----------

function toHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

// Dominant vivid hue (for UI accent) + a tiny JPEG for the blurred ambient backdrop.
function analyze(img) {
  const W = 48, H = Math.max(1, Math.round((48 * img.naturalHeight) / img.naturalWidth));
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const bins = Array.from({ length: 12 }, () => ({ w: 0, h: 0, s: 0 }));
  for (let i = 0; i < px.length; i += 4) {
    const [h, s, l] = toHsl(px[i], px[i + 1], px[i + 2]);
    const wt = s * (1 - Math.abs(2 * l - 1));
    if (wt < 0.12) continue;
    const b = bins[Math.floor(h * 12) % 12];
    b.w += wt; b.h += h * wt; b.s += s * wt;
  }
  const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
  const accent = best.w < 4
    ? 'hsl(215 30% 80%)'
    : `hsl(${Math.round((best.h / best.w) * 360)} ${Math.round(Math.min(85, Math.max(45, (best.s / best.w) * 100)))}% 74%)`;
  return { accent, tiny: c.toDataURL('image/jpeg', 0.7), soft: LITE ? softBackdrop(c) : null };
}

// Lite mode: blur and darken once on a tiny canvas, so the full-screen backdrop needs no live CSS filter.
function softBackdrop(src) {
  const w = 32, h = Math.max(1, Math.round((32 * src.height) / src.width));
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = c.getContext('2d');
  g.filter = 'blur(2px) saturate(1.4) brightness(0.5)';
  g.drawImage(src, -3, -3, w + 6, h + 6); // overdraw so the blur doesn't pull in dark edges
  return c.toDataURL('image/jpeg', 0.8);
}

// Centre of all detected faces, as object-position percentages.
function focusOf(faces) {
  if (!faces?.length) return { fx: 50, fy: 42, faces: null };
  let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
  for (const f of faces) {
    x1 = Math.min(x1, f.boundingBoxX1 / f.imageWidth); x2 = Math.max(x2, f.boundingBoxX2 / f.imageWidth);
    y1 = Math.min(y1, f.boundingBoxY1 / f.imageHeight); y2 = Math.max(y2, f.boundingBoxY2 / f.imageHeight);
  }
  return { fx: Math.round(((x1 + x2) / 2) * 100), fy: Math.round(((y1 + y2) / 2) * 100), faces: { x1, y1, x2, y2 } };
}

async function prepare(asset) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOAD_TIMEOUT_MS);
  try {
    const [blob, faces, full] = await Promise.all([
      fetch(`/immich/assets/${asset.id}/thumbnail?size=preview`, { signal: ctrl.signal })
        .then((r) => { if (!r.ok) throw new Error(`thumbnail ${r.status}`); return r.blob(); }),
      api(`faces?id=${asset.id}`).catch(() => []),
      asset._detail ? api(`assets/${asset.id}`).catch(() => asset) : asset,
    ]);
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw e; }
    return { asset: full, url, w: img.naturalWidth, h: img.naturalHeight, focus: focusOf(faces), ...analyze(img) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- caption text ----------

const fmtDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
const fmtWeekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function today() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.location.tz, year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date()).map(({ type, value }) => [type, +value]));
  return Date.UTC(p.year, p.month - 1, p.day);
}

// First names read naturally ("Alex & Sam"), but names that start with a configured title stay
// whole ("Aunt Jo", "Dr. Lee"). Titles come from DASHBOARD_NAME_TITLES.
function shortName(name) {
  const lower = name.toLowerCase();
  const titled = CONFIG.nameTitles.some((t) => lower.startsWith(`${t} `) || lower.startsWith(`${t}. `));
  return titled ? name : name.split(' ')[0];
}

export function photoStory(asset) {
  // localDateTime is the wall-clock time where the photo was taken, encoded as UTC.
  const when = new Date((asset.localDateTime ?? asset.fileCreatedAt).slice(0, 19) + 'Z');
  const t0 = today(), now = new Date(t0);
  const day = Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate());
  const days = Math.round((t0 - day) / 864e5);
  const anniv = Math.abs(Date.UTC(2000, now.getUTCMonth(), now.getUTCDate()) - Date.UTC(2000, when.getUTCMonth(), when.getUTCDate())) / 864e5;
  const years = Math.round(days / 365.25);
  let kicker;
  if (days < 1) kicker = 'Today';
  else if (days < 7) kicker = 'This week';
  else if (years >= 1 && anniv === 0) kicker = `On this day · ${plural(years, 'year')} ago`;
  else if (years >= 1 && anniv <= 3) kicker = `This week · ${plural(years, 'year')} ago`;
  else if (days < 45) kicker = `${plural(Math.round(days / 7), 'week')} ago`;
  else if (days < 350) kicker = `${plural(Math.round(days / 30.4), 'month')} ago`;
  else kicker = `${plural(Math.max(1, Math.floor(days / 365.25)), 'year')} ago`;

  const e = asset.exifInfo ?? {};
  const usa = /^(United States|USA)/.test(e.country ?? '');
  const place = (e.city ? [e.city, usa ? e.state : e.country] : [e.state, e.country]).filter(Boolean).join(', ');
  const rank = (p) => { const i = CONFIG.peopleFirst.indexOf(p.name); return i < 0 ? Infinity : i; };
  const ordered = (asset.people ?? []).filter((p) => p.name).sort((a, b) => rank(a) - rank(b)); // stable: others keep Immich's order
  const names = [...new Set(ordered.map((p) => CONFIG.nicknames.get(p.name) ?? shortName(p.name)))];
  return { kicker, place, weekday: fmtWeekday.format(when), date: fmtDate.format(when), names };
}

// "Alex & Sam", "Alex, Sam & Jo", or with only `shown` names: "Alex, Sam, Jo +2".
export function nameList(names, shown = names.length) {
  if (shown < names.length) return `${names.slice(0, shown).join(', ')} +${names.length - shown}`;
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}` : names[0] ?? '';
}

// ---------- slideshow ----------

export class Slideshow {
  constructor({ stage, ambient, onShow, onNotice }) {
    this.stage = stage;
    this.slides = [...stage.querySelectorAll('.slide')];
    this.ambs = [...ambient.querySelectorAll('.amb')];
    this.onShow = onShow;
    this.onNotice = onNotice;
    this.front = -1;
    this.queue = [];
    this.history = [];
    this.pos = -1;
    this.gen = 0;
    this.interval = 15;
    this.kenBurns = true;
    this.paused = false;
    new ResizeObserver(() => this.refit()).observe(stage);
  }

  get current() { return this.history[this.pos]; }

  configure({ interval, kenBurns }) {
    const changed = interval !== this.interval || kenBurns !== this.kenBurns;
    Object.assign(this, { interval, kenBurns });
    if (changed && this.current) this.schedule();
  }

  async setSource(source, ctx) {
    const gen = ++this.gen;
    Object.assign(this, { source, ctx, key: sourceKey(source, ctx), queue: [], pool: [], finite: false, upcoming: null, busy: false });
    this.history.splice(this.pos + 1);
    await this.refill(gen);
    if (gen === this.gen) await this.advance();
  }

  // Weather-matched sources re-query when the sky changes.
  setContext(ctx) {
    if (this.source && sourceKey(this.source, ctx) !== this.key) this.setSource(this.source, ctx);
    else this.ctx = ctx;
  }

  async refill(gen) {
    let res;
    try { res = await fetchSource(this.source, this.ctx); } catch (e) { console.warn(e); res = { items: [] }; }
    if (gen !== this.gen) return;
    let items = res.items.filter(usable);
    if (!items.length) {
      this.onNotice(`Nothing matched this preset — showing ${CONFIG.defaultAlbumId ? 'the default album' : 'the whole library'}`);
      this.source = CONFIG.defaultAlbumId ? { type: 'album', albumId: CONFIG.defaultAlbumId } : { type: 'everything' };
      res = await fetchSource(this.source, this.ctx).catch(() => ({ items: [] }));
      items = res.items.filter(usable);
    }
    if (res.detail) items.forEach((a) => { a._detail = true; });
    this.finite = !!res.finite;
    if (this.finite) this.pool = items.slice();
    const recent = new Set(this.history.map((f) => f.asset.id));
    const fresh = items.filter((a) => !recent.has(a.id));
    this.queue.push(...(fresh.length ? fresh : items));
  }

  async take(gen) {
    if (this.queue.length < 4) {
      if (this.finite) this.queue.push(...shuffle(this.pool.slice()));
      else { const p = this.refill(gen); if (!this.queue.length) await p; }
    }
    return this.queue.shift();
  }

  prefetch(gen) {
    this.upcoming = (async () => {
      for (let tries = 0; tries < 6; tries++) {
        const asset = await this.take(gen);
        if (!asset || gen !== this.gen) return null;
        try { return await prepare(asset); } catch (e) { console.warn('skipping photo', asset.id, e.message); }
      }
      return null;
    })();
  }

  async advance() {
    if (this.busy) return;
    clearTimeout(this.timer);
    if (this.pos < this.history.length - 1) { this.pos++; this.paint(this.current); return; }
    const gen = this.gen;
    this.busy = true;
    if (!this.upcoming) this.prefetch(gen);
    const frame = await this.upcoming;
    this.busy = false;
    this.upcoming = null;
    if (gen !== this.gen) return;
    if (!frame) {
      this.onNotice('Couldn’t reach Immich — retrying');
      this.timer = setTimeout(() => this.advance(), 15000);
      return;
    }
    this.history.push(frame);
    while (this.history.length > HISTORY) URL.revokeObjectURL(this.history.shift().url);
    this.pos = this.history.length - 1;
    this.paint(frame);
    this.prefetch(gen);
  }

  next() { this.advance(); }
  prev() { if (this.pos > 0) { this.pos--; this.paint(this.current); } }

  setPaused(paused) {
    this.paused = paused;
    this.stage.classList.toggle('paused', paused);
    if (paused) clearTimeout(this.timer); else this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    if (!this.paused) this.timer = setTimeout(() => this.advance(), this.interval * 1000);
  }

  paint(frame) {
    const n = (this.front + 1) % 2;
    const el = this.slides[n], img = el.querySelector('.photo');
    img.src = frame.url;
    const backdrop = `url(${frame.soft ?? frame.tiny})`;
    el.querySelector('.fill').style.backgroundImage = backdrop;
    this.fit(el, frame);
    this.motion(img, frame);
    el.classList.add('in');
    this.slides[1 - n].classList.remove('in');
    this.ambs[n].style.backgroundImage = backdrop;
    this.ambs[n].classList.add('in');
    this.ambs[1 - n].classList.remove('in');
    this.front = n;
    this.onShow(frame);
    this.schedule();
  }

  // Fill the frame when the crop is modest (e.g. 4:3 on 16:9) and wouldn't cut off a face;
  // otherwise letterbox over a blurred copy of the photo.
  fit(el, frame) {
    const { width, height } = this.stage.getBoundingClientRect();
    if (!width || !height) return;
    const sa = width / height, ia = frame.w / frame.h;
    let contain = Math.max(sa / ia, ia / sa) > 1.36;
    const box = frame.focus.faces;
    if (!contain && box) {
      const visible = Math.min(ia / sa, sa / ia);
      const [lo, hi, pos] = ia < sa ? [box.y1, box.y2, frame.focus.fy / 100] : [box.x1, box.x2, frame.focus.fx / 100];
      const start = pos * (1 - visible);
      contain = lo < start - 0.01 || hi > start + visible + 0.01;
    }
    el.classList.toggle('contain', contain);
  }

  refit() {
    if (this.front >= 0 && this.current) this.fit(this.slides[this.front], this.current);
  }

  // Ken Burns: zoom toward faces when Immich found any, otherwise a slow drift.
  motion(img, frame) {
    const { fx, fy, faces } = frame.focus;
    let s0 = 1, s1 = 1, x = 0, y = 0;
    if (this.kenBurns) {
      if (faces) { s1 = 1.1; }
      else { s0 = 1.1; s1 = 1.02; x = (Math.random() < 0.5 ? -1 : 1) * 1.6; y = (Math.random() - 0.5) * 1.6; }
    }
    Object.assign(img.style, { objectPosition: `${fx}% ${fy}%`, transformOrigin: `${fx}% ${fy}%`, animation: 'none' });
    if (!this.kenBurns) return; // leave the animation off entirely rather than running a no-op
    for (const [k, v] of Object.entries({ '--s0': s0, '--s1': s1, '--x': `${x}%`, '--y': `${y}%`, '--kb-dur': `${this.interval + 3}s` })) img.style.setProperty(k, v);
    void img.offsetWidth; // restart the animation
    img.style.animation = '';
  }
}
