#!/bin/sh
# Writes the per-install settings (DASHBOARD_* and TZ from the container's environment) to
# /run/dashboard/config.json, which nginx serves to the page as /config.json. The nginx image runs
# this before nginx starts. Values pass through as JSON strings; web/settings.js validates them.
set -eu

dir=/run/dashboard
mkdir -p "$dir"

# A JSON string: drop control characters, escape backslashes and double quotes.
json() { printf '"%s"' "$(printf '%s' "$1" | tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"; }

{
  printf '{'
  sep=''
  for pair in \
    timezone=TZ units=DASHBOARD_UNITS latitude=DASHBOARD_LATITUDE longitude=DASHBOARD_LONGITUDE \
    locationName=DASHBOARD_LOCATION_NAME albumId=DASHBOARD_ALBUM_ID nicknames=DASHBOARD_NICKNAMES \
    peopleFirst=DASHBOARD_PEOPLE_FIRST nameTitles=DASHBOARD_NAME_TITLES schedule=DASHBOARD_SCHEDULE
  do
    key=${pair%%=*}
    var=${pair#*=}
    eval "value=\${$var:-}"
    printf '%s"%s":%s' "$sep" "$key" "$(json "$value")"
    sep=','
  done
  printf '}\n'
} > "$dir/config.json.tmp"
mv "$dir/config.json.tmp" "$dir/config.json"
echo "$0: wrote $dir/config.json"
