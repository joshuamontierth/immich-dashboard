import { CONFIG, LITE } from './config.js';

// Meteocons by Bas Milius (MIT), vendored. Lite mode uses the static versions.
const ICONS = `vendor/icons/${LITE ? 'static' : 'anim'}/`;

// WMO weather code -> [label, day icon, night icon]
const WMO = {
  0: ['Clear', 'clear-day', 'clear-night'],
  1: ['Mostly clear', 'clear-day', 'clear-night'],
  2: ['Partly cloudy', 'partly-cloudy-day', 'partly-cloudy-night'],
  3: ['Overcast', 'overcast-day', 'overcast-night'],
  45: ['Fog', 'fog-day', 'fog-night'],
  48: ['Freezing fog', 'fog-day', 'fog-night'],
  51: ['Light drizzle', 'drizzle'], 53: ['Drizzle', 'drizzle'], 55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'sleet'], 57: ['Freezing drizzle', 'sleet'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'sleet'], 67: ['Freezing rain', 'sleet'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Showers', 'partly-cloudy-day-rain', 'partly-cloudy-night-rain'], 81: ['Showers', 'rain'], 82: ['Heavy showers', 'rain'],
  85: ['Snow showers', 'partly-cloudy-day-snow', 'partly-cloudy-night-snow'], 86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorms', 'thunderstorms-day', 'thunderstorms-night'],
  96: ['Storms with hail', 'thunderstorms-day-rain', 'thunderstorms-night-rain'],
  99: ['Storms with hail', 'thunderstorms-day-rain', 'thunderstorms-night-rain'],
};
const SNOW = new Set([71, 73, 75, 77, 85, 86]);
const STORM = new Set([95, 96, 99]);
export const isPrecip = (c) => c >= 51;

export function describe(code, isDay = true) {
  const [label, day, night] = WMO[code] ?? WMO[3];
  return { label, icon: `${ICONS}${isDay ? day : night ?? day}.svg` };
}

async function getJSON(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

export async function loadWeather() {
  const { lat, lon, tz } = CONFIG.location;
  if (lat == null || lon == null) throw new Error('Set DASHBOARD_LATITUDE and DASHBOARD_LONGITUDE for weather');
  const q = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: tz, forecast_days: 8,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_gusts_10m,wind_direction_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max',
    ...(CONFIG.units === 'imperial' ? { temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch' } : {}),
  });
  // Same-origin via nginx (/wx/*), which caches and serves stale data through network blips.
  const [fc, aq, nws] = await Promise.allSettled([
    getJSON(`/wx/forecast?${q}`),
    getJSON(`/wx/air?latitude=${lat}&longitude=${lon}&current=us_aqi&timezone=${encodeURIComponent(tz)}`),
    getJSON(`/wx/alerts?point=${lat},${lon}`),
  ]);
  if (fc.status !== 'fulfilled') throw fc.reason;
  const f = fc.value;
  const hourNow = f.current.time.slice(0, 13) + ':00';
  const i0 = Math.max(0, f.hourly.time.indexOf(hourNow));
  return {
    now: f.current.time, // local wall clock, 'YYYY-MM-DDTHH:MM'
    current: {
      temp: f.current.temperature_2m, feels: f.current.apparent_temperature, humidity: f.current.relative_humidity_2m,
      code: f.current.weather_code, isDay: !!f.current.is_day,
      wind: f.current.wind_speed_10m, gusts: f.current.wind_gusts_10m, windDir: f.current.wind_direction_10m,
    },
    hours: f.hourly.time.slice(i0, i0 + 25).map((t, k) => ({
      t, temp: f.hourly.temperature_2m[i0 + k], pp: f.hourly.precipitation_probability[i0 + k] ?? 0,
      code: f.hourly.weather_code[i0 + k], isDay: !!f.hourly.is_day[i0 + k],
    })),
    days: f.daily.time.map((d, k) => ({
      d, code: f.daily.weather_code[k], hi: f.daily.temperature_2m_max[k], lo: f.daily.temperature_2m_min[k],
      pp: f.daily.precipitation_probability_max[k] ?? 0, sunrise: f.daily.sunrise[k], sunset: f.daily.sunset[k], uv: f.daily.uv_index_max[k],
    })),
    aqi: aq.status === 'fulfilled' ? aq.value.current?.us_aqi : null,
    alerts: nws.status === 'fulfilled'
      ? nws.value.features.map(({ properties: p }) => ({ event: p.event, severity: p.severity ?? 'Unknown', ends: p.ends ?? p.expires }))
      : [],
  };
}

// ---------- formatting ----------

const r = Math.round;
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hourLabel = (t) => { const h = +t.slice(11, 13); return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`; };
const timeLabel = (t) => { const h = +t.slice(11, 13); return `${h % 12 || 12}:${t.slice(14, 16)} ${h < 12 ? 'AM' : 'PM'}`; };
const minutes = (t) => +t.slice(11, 13) * 60 + +t.slice(14, 16);
const dayName = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const compass = (deg) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][r(deg / 22.5) % 16];
const deg = (t) => `${r(t)}°`;

const TEMP_STOPS = [[5, [165, 180, 252]], [32, [125, 211, 252]], [50, [94, 234, 212]], [65, [190, 242, 100]], [76, [253, 224, 71]], [88, [251, 146, 60]], [100, [244, 63, 94]]];
function tempColor(t) {
  const f = CONFIG.units === 'imperial' ? t : t * 9 / 5 + 32;
  let i = TEMP_STOPS.findIndex(([s]) => s >= f);
  if (i <= 0) return `rgb(${TEMP_STOPS[i === 0 ? 0 : TEMP_STOPS.length - 1][1]})`;
  const [s0, c0] = TEMP_STOPS[i - 1], [s1, c1] = TEMP_STOPS[i], k = (f - s0) / (s1 - s0);
  return `rgb(${c0.map((v, j) => r(v + (c1[j] - v) * k))})`;
}

const AQI = [[50, 'Good', '#4ade80'], [100, 'Moderate', '#facc15'], [150, 'Sensitive groups', '#fb923c'], [200, 'Unhealthy', '#f87171'], [300, 'Very unhealthy', '#c084fc'], [Infinity, 'Hazardous', '#be123c']];
const UV = [[2, 'Low'], [5, 'Moderate'], [7, 'High'], [10, 'Very high'], [Infinity, 'Extreme']];
const band = (table, v) => table.find(([max]) => v <= max);

// One plain-language line about what's coming, with the key fact emphasised.
export function headline(w) {
  const { current: c, hours, days } = w;
  const next12 = hours.slice(1, 13);
  const kind = (code) => (SNOW.has(code) ? 'Snow' : STORM.has(code) ? 'Storms' : 'Rain');
  const [today, tomorrow] = days;
  if (isPrecip(c.code)) {
    const stop = next12.find((h) => h.pp < 25);
    return `${kind(c.code)} now${stop ? `, easing by <em>${hourLabel(stop.t)}</em>` : ', <em>continuing for hours</em>'}`;
  }
  const wet = next12.find((h) => h.pp >= 50);
  if (wet) return `${kind(wet.code)} likely around <em>${hourLabel(wet.t)}</em>&nbsp;· ${wet.pp}% chance`;
  const hour = +w.now.slice(11, 13);
  if (hour < 14 && today.hi - c.temp >= 5) return `Warming to <em>${deg(today.hi)}</em> this afternoon`;
  if (hour >= 16 || !c.isDay) {
    const low = Math.min(...next12.map((h) => h.temp));
    const swing = r(tomorrow.hi - today.hi);
    const trend = Math.abs(swing) >= 8 ? `<em>${Math.abs(swing)}° ${swing > 0 ? 'warmer' : 'cooler'}</em> tomorrow` : `${describe(tomorrow.code).label.toLowerCase()} tomorrow, ${deg(tomorrow.hi)}`;
    return `Down to ${deg(low)} tonight&nbsp;· ${trend}`;
  }
  return `${describe(c.code).label} through the day, high of <em>${deg(today.hi)}</em>`;
}

// ---------- widgets ----------

function renderNow(el, w) {
  const { current: c, days } = w;
  const d = describe(c.code, c.isDay);
  el.innerHTML = `
    <div class="now">
      <img class="now-icon" src="${d.icon}" alt="">
      <div class="now-temp num">${r(c.temp)}<sup>°</sup></div>
      <div class="now-info">
        <div class="now-cond">${d.label}</div>
        <div class="now-sub num">H ${deg(days[0].hi)} · L ${deg(days[0].lo)}</div>
        <div class="now-sub num">Feels ${deg(c.feels)}<span class="dot"> · </span><span class="hum">${r(c.humidity)}% humidity</span></div>
        ${CONFIG.location.name ? `<div class="now-loc">${esc(CONFIG.location.name)}</div>` : ''}
      </div>
    </div>`;
}

function renderNowMini(el, w) {
  const { current: c, days } = w;
  const d = describe(c.code, c.isDay), t = describe(days[1].code);
  el.innerHTML = `
    <img src="${d.icon}" alt=""><span class="num">${deg(c.temp)}</span><span class="dim">${d.label}</span>
    <span class="sep"></span>
    <span class="dim">Tomorrow</span><img src="${t.icon}" alt=""><span class="num">${deg(days[1].hi)} / ${deg(days[1].lo)}</span>`;
}

function smoothPath(pts) {
  const f = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  let d = `M${f(pts[0])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    d += ` C${f([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${f([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${f(p2)}`;
  }
  return d;
}

function renderHourly(el, w) {
  const hs = w.hours;
  const temps = hs.map((h) => h.temp);
  const mid = (Math.max(...temps) + Math.min(...temps)) / 2;
  const span = Math.max(Math.max(...temps) - Math.min(...temps), 6);
  const X = (k) => 4 + (92 * k) / (hs.length - 1);
  const Y = (t) => 58 - (50 * (t - mid)) / span;
  const pts = hs.map((h, k) => [X(k), Y(h.temp)]);
  const line = smoothPath(pts);
  const marks = hs.map((h, k) => ({ h, k })).filter(({ k }) => k % 3 === 0);
  const wettest = hs.reduce((a, h) => (h.pp > a.pp ? h : a), hs[0]);
  el.innerHTML = `
    <div class="w-title"><span>Next 24 hours</span>${wettest.pp >= 20 ? `<span class="rainy">${wettest.pp}% at ${hourLabel(wettest.t)}</span>` : ''}</div>
    <div class="hplot">
      ${hs.map((h, k) => (h.pp >= 15 ? `<i class="hbar" style="left:${X(k)}%;height:${h.pp * 0.34}%"></i>` : '')).join('')}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="hgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="stop-a"/><stop offset="1" class="stop-b"/>
        </linearGradient></defs>
        <path class="area" d="${line} L${X(hs.length - 1)},100 L${X(0)},100 Z"/>
        <path class="line" d="${line}"/>
      </svg>
      ${marks.map(({ h, k }) => `<span class="hpt${k % 6 ? ' odd' : ''}" style="left:${X(k)}%;top:${Y(h.temp)}%"><b class="num">${deg(h.temp)}</b><i></i></span>`).join('')}
    </div>
    <div class="hlabels">
      ${marks.map(({ h, k }) => `
        <span class="hl${k % 6 ? ' odd' : ''}" style="left:${X(k)}%">
          <img src="${describe(h.code, h.isDay).icon}" alt="">
          <span>${k === 0 ? 'Now' : hourLabel(h.t)}</span>
          <em>${h.pp >= 20 ? `${h.pp}%` : ''}</em>
        </span>`).join('')}
    </div>`;
}

function renderDaily(el, w) {
  const days = w.days.slice(0, 7);
  const lo = Math.min(...days.map((d) => d.lo)), hi = Math.max(...days.map((d) => d.hi));
  const pct = (t) => (100 * (t - lo)) / Math.max(hi - lo, 1);
  const nowPct = pct(Math.min(Math.max(w.current.temp, lo), hi));
  el.innerHTML = `
    <div class="w-title"><span>7-day forecast</span></div>
    <div class="drows">
      ${days.map((d, i) => `
        <div class="drow">
          <span class="dname">${i === 0 ? 'Today' : dayName(d.d)}</span>
          <img class="dicon" src="${describe(d.code).icon}" alt="">
          <span class="dpp num">${d.pp >= 20 ? `${d.pp}%` : ''}</span>
          <span class="dlo num">${deg(d.lo)}</span>
          <span class="dbar">
            <i style="left:${pct(d.lo)}%;right:${100 - pct(d.hi)}%;background:linear-gradient(90deg,${tempColor(d.lo)},${tempColor(d.hi)})"></i>
            ${i === 0 ? `<b style="left:${nowPct}%"></b>` : ''}
          </span>
          <span class="dhi num">${deg(d.hi)}</span>
        </div>`).join('')}
    </div>`;
}

function sunTile(w) {
  const [today, tomorrow] = w.days;
  const now = minutes(w.now), rise = minutes(today.sunrise), set = minutes(today.sunset);
  const up = w.now >= today.sunrise && w.now < today.sunset;
  const p = up ? (now - rise) / (set - rise) : 0;
  const a = Math.PI * (1 - p);
  const next = up ? ['Sunset', today.sunset] : ['Sunrise', w.now < today.sunrise ? today.sunrise : tomorrow.sunrise];
  return `
    <div class="stat sun">
      <div class="k">${next[0]}</div>
      <div class="v num">${timeLabel(next[1]).replace(/ (AM|PM)/, '')}</div>
      <svg class="sunarc" viewBox="0 0 100 34" aria-hidden="true">
        <path d="M6 32 A44 44 0 0 1 94 32" class="arc-track"/>
        <line x1="0" y1="32" x2="100" y2="32" class="arc-horizon"/>
        ${up ? `<circle cx="${50 + 44 * Math.cos(a)}" cy="${32 - 28 * Math.sin(a)}" r="4" class="arc-sun"/>` : ''}
      </svg>
    </div>`;
}

function renderStats(el, w) {
  const { current: c, days } = w;
  const aq = w.aqi != null ? band(AQI, w.aqi) : null;
  const uv = band(UV, days[0].uv ?? 0);
  const windUnit = CONFIG.units === 'imperial' ? 'mph' : 'km/h';
  el.innerHTML = `
    <div class="stat">
      <div class="k">Wind <svg class="arrow" viewBox="0 0 24 24" style="transform:rotate(${c.windDir + 180}deg)"><path d="M12 3l6 16-6-4-6 4z"/></svg></div>
      <div class="v num">${r(c.wind)}<small>${windUnit}</small></div>
      <div class="s"><span class="nw">${compass(c.windDir)} ·</span> <span class="nw">gusts ${r(c.gusts)}</span></div>
    </div>
    <div class="stat">
      <div class="k">Air</div>
      <div class="v num">${aq ? w.aqi : '—'}${aq ? `<i class="dot" style="background:${aq[2]}"></i>` : ''}</div>
      <div class="s">${aq ? aq[1] : 'Unavailable'}</div>
    </div>
    <div class="stat">
      <div class="k">UV</div>
      <div class="v num">${r(days[0].uv ?? 0)}</div>
      <div class="s">${uv[1]}</div>
    </div>
    ${sunTile(w)}`;
}

function renderAlerts(el, w) {
  el.classList.toggle('empty', !w.alerts.length);
  if (!w.alerts.length) { el.innerHTML = ''; return; }
  const a = w.alerts[0];
  const until = a.ends ? new Date(a.ends).toLocaleString('en-US', { timeZone: CONFIG.location.tz, weekday: 'short', hour: 'numeric' }) : '';
  el.innerHTML = `
    <div class="alert sev-${esc(a.severity.toLowerCase())}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3zm0 6v5m0 3v.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <b>${esc(a.event)}</b>${until ? `<span>until ${until}</span>` : ''}${w.alerts.length > 1 ? `<em>+${w.alerts.length - 1}</em>` : ''}
    </div>`;
}

export function renderWeather(widgets, w) {
  renderNow(widgets.now, w);
  renderNowMini(widgets.nowMini, w);
  widgets.headline.innerHTML = headline(w);
  renderHourly(widgets.hourly, w);
  renderDaily(widgets.daily, w);
  renderStats(widgets.stats, w);
  renderAlerts(widgets.alerts, w);
}
