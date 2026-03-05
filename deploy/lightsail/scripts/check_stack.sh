#!/usr/bin/env bash
set -Eeuo pipefail

STACK_ROOT="${STACK_ROOT:-/opt/openclaw-stack}"
ENV_FILE="${STACK_ROOT}/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  printf 'Missing env file: %s\n' "$ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

printf '\n== systemd status ==\n'
systemctl --no-pager --full status openclaw-gateway.service | sed -n '1,25p'
printf '\n== budget timer ==\n'
systemctl --no-pager --full status openclaw-budget-guard.timer | sed -n '1,20p'

printf '\n== compose ps ==\n'
docker compose --env-file "$ENV_FILE" -f "${STACK_ROOT}/docker-compose.yml" ps

printf '\n== gateway health ==\n'
cid="$(docker compose --env-file "$ENV_FILE" -f "${STACK_ROOT}/docker-compose.yml" ps -q openclaw-gateway)"
if [[ -z "${cid:-}" ]]; then
  printf 'gateway container not found\n' >&2
  exit 1
fi
docker inspect --format 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restart={{.RestartCount}}' "$cid"

printf '\n== recent gateway logs ==\n'
docker compose --env-file "$ENV_FILE" -f "${STACK_ROOT}/docker-compose.yml" logs --tail=50 openclaw-gateway
