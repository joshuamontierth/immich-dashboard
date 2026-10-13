import { CONFIG, LAYOUTS, SOURCE_TYPES, WIDGET_LABELS } from './config.js';
import { api } from './photos.js';
import { esc } from './weather.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = () => `p-${Date.now().toString(36)}`;

// Little wireframes so the layout choice is visual.
const THUMBS = {
  ambient: '<rect width="64" height="36" rx="3" class="ph"/><rect x="5" y="25" width="20" height="3" rx="1" class="ln"/><rect x="5" y="30" width="12" height="2" rx="1" class="ln2"/><rect x="45" y="21" width="14" height="6" rx="1" class="ln"/><rect x="48" y="29" width="11" height="3" rx="1" class="ln2"/>',
  split: '<rect x="2" y="2" width="40" height="32" rx="2" class="ph"/><rect x="46" y="4" width="13" height="5" rx="1" class="ln"/><rect x="46" y="11" width="16" height="6" rx="1" class="ln2"/><rect x="46" y="19" width="16" height="6" rx="1" class="ln2"/><rect x="46" y="27" width="16" height="6" rx="1" class="ln2"/>',
  forecast: '<rect x="4" y="4" width="10" height="2" rx="1" class="ln2"/><rect x="4" y="8" width="22" height="11" rx="1" class="ln"/><rect x="36" y="3" width="25" height="18" rx="2" class="ph"/><rect x="4" y="24" width="34" height="9" rx="1" class="ln2"/><rect x="41" y="24" width="20" height="9" rx="1" class="ln2"/>',
  night: '<rect width="64" height="36" rx="3" class="nt"/><rect x="17" y="12" width="30" height="9" rx="1" class="ln"/><rect x="23" y="24" width="18" height="2" rx="1" class="ln2"/>',
};
const SOURCE_NOTES = {
  favorites: 'Everything you’ve starred in Immich.',
  weather: 'Photos that look like it does outside — snow when it snows, blue skies when it’s clear. Re-picks when the weather changes.',
  everything: 'A random walk through the whole library.',
};
const SOURCE_DEFAULTS = { album: { albumId: CONFIG.defaultAlbumId }, people: { personIds: [] }, smart: { query: '' }, memories: { albumId: '' } };

export class Editor {
  constructor(root, hooks) {
    this.root = root;
    this.h = hooks;
    this.s = hooks.state;
    this.sel = null;
    this.albums = null;
    this.people = null;
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('input', (e) => this.onInput(e, false));
    root.addEventListener('change', (e) => this.onInput(e, true));
  }

  get isOpen() { return this.root.classList.contains('open'); }
  get preset() { return this.s.presets.find((p) => p.id === this.sel) ?? this.s.presets[0]; }

  toggle() { if (this.isOpen) this.close(); else this.open(); }
  open() {
    this.sel = this.s.activeId;
    this.root.classList.add('open');
    this.render();
    this.loadLibrary();
  }
  close() { this.root.classList.remove('open'); }

  async loadLibrary() {
    if (this.albums) return;
    const [albums, people] = await Promise.all([
      api('albums').catch(() => []),
      api('people?withHidden=false').catch(() => ({ people: [] })),
    ]);
    this.albums = albums.sort((a, b) => b.assetCount - a.assetCount);
    this.people = (people.people ?? []).filter((p) => p.name && !p.isHidden).slice(0, 48);
    if (this.isOpen) this.render();
  }

  commit(p) { this.h.save(); this.h.changed(p.id); }

  sourceFields(p) {
    const src = p.source;
    const loading = '<p class="fld sub note">Loading from Immich…</p>';
    const albumOptions = () => this.albums
      .map((a) => `<option value="${a.id}" ${a.id === src.albumId ? 'selected' : ''}>${esc(a.albumName.trim())} · ${a.assetCount.toLocaleString()}</option>`).join('');
    if (src.type === 'album') {
      if (!this.albums) return loading;
      return `<label class="fld sub"><span>Album</span><select data-f="source.albumId">
        ${src.albumId ? '' : '<option value="" selected disabled>Choose an album</option>'}${albumOptions()}
      </select></label>`;
    }
    if (src.type === 'memories') {
      if (!this.albums) return loading;
      return `<label class="fld sub"><span>From <small>Photos taken this week in past years</small></span><select data-f="source.albumId">
        <option value="" ${src.albumId ? '' : 'selected'}>Whole library</option>${albumOptions()}
      </select></label>`;
    }
    if (src.type === 'people') {
      if (!this.people) return loading;
      const on = new Set(src.personIds ?? []);
      return `<div class="fld sub"><span>People <small>Photos where everyone selected appears</small></span><div class="faces">
        ${this.people.map((x) => `<button class="face ${on.has(x.id) ? 'on' : ''}" data-ed="person" data-v="${x.id}">
          <img src="/immich/people/${x.id}/thumbnail" loading="lazy" alt=""><span>${esc(x.name.split(' ')[0])}</span></button>`).join('')}
      </div></div>`;
    }
    if (src.type === 'smart') {
      return `<label class="fld sub"><span>Search for <small>Immich smart search, e.g. “sunsets”, “hiking”, “dog at the beach”</small></span>
        <input type="text" data-f="source.query" value="${esc(src.query ?? '')}" placeholder="mountains in the snow"></label>`;
    }
    return `<p class="fld sub note">${SOURCE_NOTES[src.type] ?? ''}</p>`;
  }

  render() {
    const p = this.preset, s = this.s;
    const scroll = this.root.querySelector('.ed-scroll')?.scrollTop ?? 0;
    this.root.innerHTML = `
      <header><h2>Customize</h2><button class="x" data-ed="close" aria-label="Close">×</button></header>
      <div class="ed-scroll">
        <section>
          <div class="ed-label">Presets</div>
          <div class="tabs">
            ${s.presets.map((q) => `<button class="tab ${q.id === p.id ? 'on' : ''}" data-ed="select" data-id="${esc(q.id)}">${q.id === s.activeId ? '<i class="live"></i>' : ''}<span>${esc(q.name)}</span></button>`).join('')}
            <button class="tab add" data-ed="new">+ New</button>
          </div>
        </section>
        <section class="card-ed">
          <label class="fld"><span>Name</span><input type="text" data-f="name" value="${esc(p.name)}" maxlength="24"></label>
          <div class="fld"><span>Layout</span>
            <div class="layouts">${Object.entries(LAYOUTS).map(([k, l]) => `
              <button class="${p.layout === k ? 'on' : ''}" data-ed="layout" data-v="${k}"><svg viewBox="0 0 64 36">${THUMBS[k]}</svg><b>${l.label}</b></button>`).join('')}
            </div>
          </div>
          <label class="fld"><span>Photos</span>
            <select data-f="source.type">${Object.entries(SOURCE_TYPES).map(([k, v]) => `<option value="${k}" ${p.source.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          </label>
          ${this.sourceFields(p)}
          <label class="fld"><span>Seconds per photo <b class="val">${p.interval}s</b></span>
            <input type="range" min="5" max="120" step="1" data-f="interval" value="${p.interval}"></label>
          <label class="fld row"><span>Ken Burns motion<small>Slow zoom toward faces</small></span>
            <input type="checkbox" class="switch" data-f="kenBurns" ${p.kenBurns ? 'checked' : ''}></label>
          <div class="fld"><span>Widgets</span>
            <div class="chips">${LAYOUTS[p.layout].widgets.map((w) => `<button class="chip ${p.widgets[w] ? 'on' : ''}" data-ed="widget" data-v="${w}">${WIDGET_LABELS[w]}</button>`).join('')}</div>
          </div>
          <div class="actions">
            <button class="primary" data-ed="apply" ${p.id === s.activeId ? 'disabled' : ''}>${p.id === s.activeId ? 'On screen now' : 'Show now'}</button>
            <button data-ed="dup">Duplicate</button>
            <button class="danger" data-ed="del" ${s.presets.length < 2 ? 'disabled' : ''}>Delete</button>
          </div>
        </section>
        <section>
          <div class="ed-label row"><span>Schedule</span><label class="inline">Auto-switch <input type="checkbox" class="switch" data-ed="auto" ${s.auto ? 'checked' : ''}></label></div>
          <div class="sched">
            ${[...s.schedule].map((r, i) => ({ r, i })).sort((a, b) => a.r.from.localeCompare(b.r.from)).map(({ r, i }) => `
              <div class="srow">
                <input type="time" data-s="${i}" data-k="from" value="${esc(r.from)}">
                <select data-s="${i}" data-k="preset">${s.presets.map((q) => `<option value="${esc(q.id)}" ${q.id === r.preset ? 'selected' : ''}>${esc(q.name)}</option>`).join('')}</select>
                <button class="x sm" data-ed="unsched" data-i="${i}" aria-label="Remove">×</button>
              </div>`).join('')}
            <button class="add-row" data-ed="sched">+ Add a time</button>
          </div>
        </section>
        <section class="foot">
          <p class="hint"><kbd>1</kbd>–<kbd>${Math.min(9, s.presets.length)}</kbd> presets · <kbd>←</kbd> <kbd>→</kbd> photos · <kbd>Space</kbd> pause · <kbd>A</kbd> auto · <kbd>F</kbd> fullscreen · <kbd>E</kbd> this panel</p>
          <button class="link" data-ed="reset">Reset everything to defaults</button>
        </section>
      </div>`;
    this.root.querySelector('.ed-scroll').scrollTop = scroll;
  }

  onClick(e) {
    const b = e.target.closest('button[data-ed]');
    if (!b) return;
    const p = this.preset, s = this.s, v = b.dataset.v;
    switch (b.dataset.ed) {
      case 'close': this.close(); return;
      case 'select': this.sel = b.dataset.id; break;
      case 'new':
      case 'dup': {
        const q = { ...clone(p), id: uid(), name: b.dataset.ed === 'new' ? 'New preset' : `${p.name} copy` };
        s.presets.splice(s.presets.indexOf(p) + 1, 0, q);
        this.sel = q.id;
        this.h.save();
        break;
      }
      case 'del': {
        if (s.presets.length < 2) return;
        s.presets.splice(s.presets.indexOf(p), 1);
        s.schedule = s.schedule.filter((r) => r.preset !== p.id);
        this.sel = s.presets[0].id;
        this.h.save();
        if (p.id === s.activeId) this.h.apply(s.presets[0].id);
        break;
      }
      case 'apply': this.h.apply(p.id); break;
      case 'layout':
        p.layout = v;
        p.widgets = Object.fromEntries(LAYOUTS[v].widgets.map((w) => [w, p.widgets[w] ?? true]));
        this.commit(p);
        break;
      case 'widget': p.widgets[v] = !p.widgets[v]; this.commit(p); break;
      case 'person': {
        const ids = new Set(p.source.personIds ?? []);
        if (ids.has(v)) ids.delete(v); else ids.add(v);
        p.source = { ...p.source, personIds: [...ids] };
        this.commit(p);
        break;
      }
      case 'sched': s.schedule.push({ from: '12:00', preset: p.id }); this.h.save(); break;
      case 'unsched': s.schedule.splice(+b.dataset.i, 1); this.h.save(); break;
      case 'reset':
        // Two taps instead of confirm(): the ImmichFrame Android app's WebView has no dialog support.
        if (!b.dataset.armed) {
          b.dataset.armed = '1';
          b.textContent = 'Tap again to reset all presets and the schedule';
          setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Reset everything to defaults'; } }, 4000);
          return;
        }
        this.h.reset();
        this.sel = this.s.presets[0].id;
        break;
      default: return;
    }
    this.render();
  }

  onInput(e, committed) {
    const t = e.target, p = this.preset, s = this.s;
    if (t.dataset.ed === 'auto') { if (committed) this.h.setAuto(t.checked); return; }
    if (t.dataset.s != null) {
      if (committed) { s.schedule[+t.dataset.s][t.dataset.k] = t.value; this.h.save(); }
      return;
    }
    const f = t.dataset.f;
    if (!f) return;
    const val = t.type === 'checkbox' ? t.checked : t.type === 'range' ? +t.value : t.value;
    if (!committed) {
      if (f === 'interval') t.closest('.fld').querySelector('.val').textContent = `${val}s`;
      if (f === 'name') { p.name = val; this.root.querySelector('.tab.on span').textContent = val; this.h.save(); }
      return;
    }
    if (f === 'name') return;
    if (f === 'source.type') p.source = { type: val, ...clone(SOURCE_DEFAULTS[val] ?? {}) };
    else if (f.startsWith('source.')) p.source = { ...p.source, [f.slice(7)]: val };
    else p[f] = val;
    this.commit(p);
    if (f === 'source.type') this.render();
  }
}
