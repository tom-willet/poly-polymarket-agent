#!/usr/bin/env bash
set -Eeuo pipefail

APP_ID="${APP_ID:-template_app}"
NOW_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

cmd="${1:-}"

case "$cmd" in
  status)
    cat <<EOF
{"app_id":"${APP_ID}","timestamp_utc":"${NOW_UTC}","ok":true,"summary":"adapter reachable","data":{"mode":"dry-run"}}
EOF
    ;;
  edge_report)
    cat <<EOF
{"app_id":"${APP_ID}","timestamp_utc":"${NOW_UTC}","ok":true,"summary":"no edge data yet","data":{"opportunities":[]}}
EOF
    ;;
  simulate)
    cat <<EOF
{"app_id":"${APP_ID}","timestamp_utc":"${NOW_UTC}","ok":true,"summary":"simulation placeholder","data":{"orders":[]}}
EOF
    ;;
  *)
    printf 'Usage: %s {status|edge_report|simulate}\n' "$0" >&2
    exit 1
    ;;
esac
