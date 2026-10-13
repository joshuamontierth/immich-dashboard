import { parseSettings } from './settings.js';

const query = new URLSearchParams(location.search);
// Android WebViews (e.g. the ImmichFrame app on a Frameo tablet) get a lighter render path:
// pre-blurred backdrops, static icons, no colour tweening. Force with ?lite=1 / ?lite=0.
export const LITE = query.has('lite') ? query.get('lite') !== '0' : /; wv\)/.test(navigator.userAgent);

// Per-install settings come from the container's environment (.env) via /config.json, which
// docker-entrypoint.d/40-dashboard-config.sh writes at startup. Missing or unreadable: defaults.
const settings = parseSettings(await fetch('config.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})));

// Presets and the schedule are also editable on-screen (press E).
export const CONFIG = {
  location: settings.location,
  units: settings.units,
  // Album for the Gallery and Dashboard presets, and the fallback when a preset finds nothing.
  // Empty means the whole library.
  defaultAlbumId: settings.defaultAlbumId,
  // Captions: display names for Immich people (by full name), and who is always listed first.
  nicknames: settings.nicknames,
  peopleFirst: settings.peopleFirst,
  nameTitles: settings.nameTitles,
  weatherRefreshMin: 10,
  dockHideMs: 3500,
};

export const LAYOUTS = {
  ambient:  { label: 'Ambient',   widgets: ['clock', 'now', 'caption', 'alerts'] },
  split:    { label: 'Dashboard', widgets: ['clock', 'now', 'headline', 'hourly', 'daily', 'stats', 'caption'] },
  forecast: { label: 'Forecast',  widgets: ['clock', 'alerts', 'now', 'headline', 'stats', 'hourly', 'daily', 'caption'] },
  night:    { label: 'Night',     widgets: ['clock', 'nowMini', 'photo'] },
};

// Where each widget lives in each layout (slot id -> widgets, in order).
export const SLOTS = {
  ambient:  { 'slot-tr': ['alerts'], 'slot-bl': ['caption'], 'slot-br': ['clock', 'now'] },
  split:    { 'slot-photo': ['clock', 'caption'], 'slot-panel': ['now', 'headline', 'hourly', 'daily', 'stats'] },
  forecast: { 'slot-tl': ['clock'], 'slot-hero': ['alerts', 'now', 'headline', 'stats'], 'slot-card': ['caption'], 'slot-bottom': ['hourly', 'daily'] },
  night:    { 'slot-center': ['clock', 'nowMini'] },
};

export const WIDGET_LABELS = {
  clock: 'Clock', now: 'Current weather', headline: 'Forecast headline', hourly: 'Next 24 hours',
  daily: '7-day forecast', stats: 'Conditions', caption: 'Photo caption', alerts: 'Weather alerts',
  nowMini: 'Weather line', photo: 'Dimmed photo',
};

export const SOURCE_TYPES = {
  album: 'Album',
  favorites: 'Favorites',
  people: 'People',
  smart: 'Smart search',
  weather: 'Match the weather',
  memories: 'On this day',
  everything: 'Whole library',
};

// Photo motion (Ken Burns) defaults off on the tablet to spare its GPU; it can be turned on per preset.
const all = (layout) => Object.fromEntries(LAYOUTS[layout].widgets.map((w) => [w, true]));
const mainSource = () => (CONFIG.defaultAlbumId ? { type: 'album', albumId: CONFIG.defaultAlbumId } : { type: 'everything' });

export const DEFAULT_PRESETS = [
  { id: 'gallery', name: 'Gallery', layout: 'ambient', interval: 15, kenBurns: !LITE,
    source: mainSource(), widgets: all('ambient') },
  { id: 'dashboard', name: 'Dashboard', layout: 'split', interval: 12, kenBurns: !LITE,
    source: mainSource(), widgets: all('split') },
  { id: 'forecast', name: 'Forecast', layout: 'forecast', interval: 20, kenBurns: !LITE,
    source: { type: 'weather' }, widgets: all('forecast') },
  { id: 'memories', name: 'On This Day', layout: 'ambient', interval: 10, kenBurns: !LITE,
    source: { type: 'memories' }, widgets: all('ambient') },
  { id: 'night', name: 'Night', layout: 'night', interval: 60, kenBurns: false,
    source: { type: 'favorites' }, widgets: all('night') },
];

export const DEFAULT_SCHEDULE = settings.schedule.length ? settings.schedule : [
  { from: '06:00', preset: 'forecast' },
  { from: '09:00', preset: 'gallery' },
  { from: '17:00', preset: 'dashboard' },
  { from: '22:00', preset: 'night' },
];
