#!/usr/bin/env bash
set -Eeuo pipefail

STACK_ROOT="${STACK_ROOT:-/opt/openclaw-stack}"
CONFIG_FILE="${STACK_ROOT}/config/openclaw.json"

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <slack_user_id>\n' "$0" >&2
  exit 1
fi

USER_ID="$1"
if [[ ! "$USER_ID" =~ ^[UW][A-Z0-9]+$ ]]; then
  printf 'slack_user_id must look like U... or W... (example: U0123ABCDEF)\n' >&2
  exit 1
fi

command -v jq >/dev/null 2>&1 || {
  printf 'Missing jq\n' >&2
  exit 1
}

[[ -f "$CONFIG_FILE" ]] || {
  printf 'Missing config file: %s\n' "$CONFIG_FILE" >&2
  exit 1
}

tmp_file="$(mktemp)"
jq --arg user "$USER_ID" '
  .channels.slack.allowFrom = ((.channels.slack.allowFrom // []) + [$user] | unique)
' "$CONFIG_FILE" > "$tmp_file"

install -m 600 "$tmp_file" "$CONFIG_FILE"
rm -f "$tmp_file"

docker compose --env-file "${STACK_ROOT}/.env" -f "${STACK_ROOT}/docker-compose.yml" restart openclaw-gateway >/dev/null
printf 'Added Slack user %s to allowlist and restarted gateway.\n' "$USER_ID"
