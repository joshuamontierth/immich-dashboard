// Parses the per-install settings that the container writes to /config.json from its environment
// (see .env.example). Every value arrives as a string; anything missing or invalid falls back to a
// default so the dashboard still runs.

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => str(v).split(',').map((x) => x.trim()).filter(Boolean);

// "A=B,C=D" -> [['A', 'B'], ['C', 'D']]; entries missing either side are dropped.
const pairs = (v) => list(v).flatMap((x) => {
  const i = x.indexOf('=');
  const key = x.slice(0, i).trim(), value = x.slice(i + 1).trim();
  return i > 0 && key && value ? [[key, value]] : [];
});

function coordinate(v, limit) {
  const n = Number(str(v));
  return str(v) !== '' && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

// A valid IANA zone, otherwise the screen's own timezone.
function timezone(v) {
  const tz = str(v);
  if (tz) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { /* invalid, use the screen's */ }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// "9:00" or "09:00" -> "09:00"; anything else -> null.
function time(v) {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(v);
  return m && +m[1] < 24 ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

// Titles that keep a person's full name in captions ("Aunt Jo" rather than "Aunt").
const DEFAULT_TITLES = ['Dr', 'Mr', 'Mrs', 'Ms', 'Aunt', 'Uncle', 'Grandma', 'Grandpa'];
function titles(v) {
  if (str(v).toLowerCase() === 'none') return [];
  const given = list(v);
  return (given.length ? given : DEFAULT_TITLES).map((t) => t.replace(/\.$/, '').toLowerCase());
}

export function parseSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    location: {
      name: str(s.locationName),
      lat: coordinate(s.latitude, 90),
      lon: coordinate(s.longitude, 180),
      tz: timezone(s.timezone),
    },
    units: str(s.units).toLowerCase() === 'imperial' ? 'imperial' : 'metric',
    defaultAlbumId: UUID.test(str(s.albumId)) ? str(s.albumId) : '',
    nicknames: new Map(pairs(s.nicknames)),
    peopleFirst: list(s.peopleFirst),
    nameTitles: titles(s.nameTitles),
    schedule: pairs(s.schedule).flatMap(([from, preset]) => (time(from) ? [{ from: time(from), preset }] : [])),
  };
}
