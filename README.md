# Immich Dashboard

A photo-frame dashboard for [Immich](https://immich.app): a slideshow of your photos with a clock and
a weather forecast, built for TVs, monitors and wall tablets. It runs as one small nginx container next to
your Immich server. There is no build step and no database.

- **Presets** you can switch between or schedule by time of day, each with its own layout, photo source,
  timing and widgets:
  - **Gallery:** full-screen photos with the clock and weather in the corners.
  - **Dashboard:** the photo beside a weather panel.
  - **Forecast:** weather first, with the photo as a framed print.
  - **Night:** a dim clock over a faint photo.
  - **On This Day:** photos from this week in past years.
- **Photo sources:** an album, favorites, chosen people, Immich smart search ("beach", "snow"),
  photos that match the current weather, this week in past years, or the whole library.
- **Captions:** the date, how long ago, the location, and who's in the photo, with nicknames and a set
  order for names.
- **Weather:** current conditions, a 24-hour chart, a 7-day forecast, wind, air quality, UV,
  sunrise/sunset, and US weather alerts. No weather API key is needed.
- **Photo display:** face-aware cropping, slow zoom toward faces, a backdrop and accent color taken from
  each photo, and a lighter mode for low-power Android tablets.

## Requirements

- Docker with Docker Compose v2.
- An Immich server (tested with v3.1) and an API key for it.
- Internet access from the machine running the dashboard, for the weather.

## Install

1. **Get the code.**

   ```bash
   git clone https://github.com/joshuamontierth/immich-dashboard.git
   cd immich-dashboard
   ```

2. **Create an Immich API key.** In Immich, open **Account Settings → API Keys → New API Key**. The
   dashboard only reads, so you can limit the key to these permissions:
   `asset.read`, `asset.view`, `album.read`, `person.read`, `face.read`, `memory.read`.

3. **Configure.** Copy the example settings and edit them. At minimum, set `IMMICH_URL`,
   `IMMICH_API_KEY`, and your coordinates for the weather.

   ```bash
   cp .env.example .env
   nano .env
   ```

   `IMMICH_URL` must be reachable from inside the container. Use your server's LAN address or hostname,
   for example `http://192.168.1.10:2283`. `localhost` won't work, because it points at the container
   itself.

4. **Start it.**

   ```bash
   docker compose up -d
   ```

5. **Open it** at `http://<your-server>:8090` on the screen you want to use.

### Updating

```bash
git pull
docker compose up -d --force-recreate
```

Settings in `.env` are read when the container starts, so recreate it after changing them.

## Configuration

Everything specific to your install lives in `.env`, which git ignores. `.env.example` documents each
setting.

| Setting | Default | What it does |
|---|---|---|
| `IMMICH_URL` | *required* | Your Immich server, e.g. `http://192.168.1.10:2283` (no `/api`). |
| `IMMICH_API_KEY` | *required* | The API key from step 2. It stays on the server and is never sent to the browser. |
| `IMMICH_TLS_VERIFY` | `on` | Set to `off` only if Immich uses a self-signed HTTPS certificate. |
| `DASHBOARD_LATITUDE`, `DASHBOARD_LONGITUDE` | *empty* | Location for the forecast. Leave empty to turn weather off. |
| `DASHBOARD_LOCATION_NAME` | *empty* | Short label shown with the current conditions. |
| `DASHBOARD_UNITS` | `metric` | `metric` or `imperial`. |
| `TZ` | the screen's timezone | IANA timezone for the clock and schedule, e.g. `Europe/London`. |
| `DASHBOARD_ALBUM_ID` | whole library | Album for the Gallery and Dashboard presets: the UUID at the end of the album's URL in Immich. |
| `DASHBOARD_NICKNAMES` | *none* | Display names keyed by full name in Immich: `Alexander Smith=Alex,Samantha Lee=Sam`. |
| `DASHBOARD_PEOPLE_FIRST` | *none* | People always listed first in captions, in order: `Samantha Lee,Alexander Smith`. |
| `DASHBOARD_NAME_TITLES` | `Dr,Mr,Mrs,Ms,Aunt,Uncle,Grandma,Grandpa` | Names starting with one of these keep their full name ("Aunt Jo", not "Aunt"). `none` turns this off. |
| `DASHBOARD_SCHEDULE` | `06:00=forecast,09:00=gallery,17:00=dashboard,22:00=night` | When the auto schedule switches presets. |
| `DASHBOARD_PORT` | `8090` | Port the dashboard is served on. |

Captions show first names. Names with a comma or `=` can't be used in `DASHBOARD_NICKNAMES` or
`DASHBOARD_PEOPLE_FIRST`.

## Using it

Move the mouse or tap the screen to show the control dock. It has the presets, the auto schedule,
previous/pause/next, and a button that opens the editor. You can also use the keyboard:

| Key | Action |
|---|---|
| `1`–`9` | Switch preset (turns the auto schedule off) |
| `A` | Auto schedule on/off |
| `←` `→` | Previous / next photo (swipe on touch screens) |
| `Space` | Pause |
| `E` | Edit presets, photo sources, widgets and the schedule |
| `F` | Fullscreen |

The editor lets you create, duplicate and change presets on the screen itself. Edits are saved in that
screen's browser. Each screen keeps its own presets; the defaults come from `.env`.

URL options, handy for kiosks: `?preset=night` pins a preset; `?ui=dock` or `?ui=edit` keeps the controls
open; `?lite=1` or `?lite=0` forces lite mode on or off.

## Displays

**A TV, monitor or computer:** open the URL in a browser in fullscreen or kiosk mode. It's developed and
tested in Firefox; current Chrome and Edge should work too.

**An Android tablet or digital frame:** the [ImmichFrame Android app](https://github.com/immichFrame/ImmichFrame_Android)
can show the dashboard. In the app's settings, turn **Use WebView** on and set the URL to the dashboard.

- It needs Android System WebView 106 or newer. Some photo frames ship an older one; the ImmichFrame docs
  explain how to update it. On an engine that's too old, the page says so after 10 seconds instead of
  staying black.
- Android WebViews automatically get **lite mode**. Smaller text is 20% larger, backdrops are blurred once
  instead of continuously, weather icons are static, and photo motion is off by default.
- The app's remote commands (`next`, `previous`, `pause`) arrive as key presses, which the dashboard
  handles. Brightness and screen on/off are handled by the app itself.

## Security

- The API key stays in the container. The browser can only reach an allowlist of read-only Immich
  endpoints through the dashboard; any other path or method is refused.
- Anyone who can open the dashboard's URL can view your photos. Keep it on your home network or a VPN
  such as Tailscale. Don't expose it to the internet without authentication in front of it.

## Troubleshooting

- **"Couldn't reach Immich":** check that `IMMICH_URL` works from the Docker host, for example
  `curl $IMMICH_URL/api/server/ping`. Run the dashboard with `docker compose` rather than plain
  `docker run`; compose's network provides the DNS that nginx uses to look up hostnames.
- **No weather:** set `DASHBOARD_LATITUDE` and `DASHBOARD_LONGITUDE`, then recreate the container.
  Weather alerts only cover the US.
- **Changes to `.env` don't show up:** run `docker compose up -d --force-recreate`. `http://<server>:8090/config.json`
  shows the settings the page receives.

## How it works

- `web/` is the whole app: plain ES modules and CSS. The repository is mounted into the container, so
  edits take effect on reload.
- `nginx.conf.template` serves `web/` and proxies the Immich allowlist under `/immich/*`, adding the API
  key. Thumbnails are cached for 14 days.
- Weather requests go through `/wx/*` and are cached. If the internet drops, cached data keeps being
  served for up to a day.
- At startup, `docker-entrypoint.d/40-dashboard-config.sh` turns the `DASHBOARD_*` settings into
  `/config.json`, which `web/settings.js` reads.
- Everything the page loads is same-origin, with the font and icons stored in `web/vendor/`. This keeps
  it working inside the ImmichFrame app, which reloads the page when any request fails to connect.
- All text follows one type system (one typeface, four weights, two colors), documented at the top of
  the widgets section in `web/styles.css`.

## Credits

- Photos from [Immich](https://immich.app). This project isn't affiliated with Immich or ImmichFrame.
- Weather data by [Open-Meteo.com](https://open-meteo.com) (CC BY 4.0), with alerts from the US
  [National Weather Service](https://www.weather.gov).
- [Inter Tight](https://github.com/rsms/inter) typeface, SIL Open Font License 1.1 (`web/vendor/fonts/OFL.txt`).
- [Meteocons](https://github.com/basmilius/weather-icons) weather icons by Bas Milius, MIT License
  (`web/vendor/icons/LICENSE`).
