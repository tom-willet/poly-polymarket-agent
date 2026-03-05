#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LIGHTSAIL_DIR="${ROOT_DIR}/deploy/lightsail"
TEMPLATES_DIR="${LIGHTSAIL_DIR}/templates"
ASSETS_SCRIPTS_DIR="${LIGHTSAIL_DIR}/scripts"

STACK_ROOT="${STACK_ROOT:-/opt/openclaw-stack}"
ENV_FILE="${ENV_FILE:-${LIGHTSAIL_DIR}/.env}"
OPENCLAW_REPO_URL="${OPENCLAW_REPO_URL:-https://github.com/openclaw/openclaw.git}"
OPENCLAW_REF="${OPENCLAW_REF:-main}"
OPENCLAW_IMAGE="${OPENCLAW_IMAGE:-ghcr.io/openclaw/openclaw:latest}"

log() {
  printf '[install] %s\n' "$1"
}

fail() {
  printf '[install] ERROR: %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

require_cmd sudo
require_cmd git
require_cmd jq
require_cmd docker
require_cmd systemctl

[[ -f "$ENV_FILE" ]] || fail "Missing env file at $ENV_FILE"
[[ -f "${TEMPLATES_DIR}/docker-compose.yml" ]] || fail "Missing compose template"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required_vars=(
  OPENAI_API_KEY
  OPENAI_MODEL
  SLACK_APP_TOKEN
  SLACK_BOT_TOKEN
  OPENCLAW_GATEWAY_TOKEN
)
for name in "${required_vars[@]}"; do
  [[ -n "${!name:-}" ]] || fail "Required env var is empty: $name"
done

SLACK_ALLOWED_USER_IDS_JSON="${SLACK_ALLOWED_USER_IDS_JSON:-[]}"
if ! printf '%s' "$SLACK_ALLOWED_USER_IDS_JSON" | jq -e 'type == "array"' >/dev/null; then
  fail "SLACK_ALLOWED_USER_IDS_JSON must be a JSON array (example: [\"U0123ABCDEF\"])"
fi
SLACK_DM_POLICY="${SLACK_DM_POLICY:-open}"
case "$SLACK_DM_POLICY" in
  open|allowlist|pairing|disabled) ;;
  *)
    fail "SLACK_DM_POLICY must be one of: open, allowlist, pairing, disabled"
    ;;
esac

log "Creating stack directories at ${STACK_ROOT}"
sudo install -d -m 755 \
  "${STACK_ROOT}" \
  "${STACK_ROOT}/config" \
  "${STACK_ROOT}/workspace" \
  "${STACK_ROOT}/runtime" \
  "${STACK_ROOT}/scripts"
sudo chown -R "$USER":"$USER" "${STACK_ROOT}"

if [[ ! -d "${STACK_ROOT}/openclaw/.git" ]]; then
  log "Cloning OpenClaw"
  git clone "$OPENCLAW_REPO_URL" "${STACK_ROOT}/openclaw"
fi

log "Updating OpenClaw repository"
git -C "${STACK_ROOT}/openclaw" fetch --tags origin
git -C "${STACK_ROOT}/openclaw" checkout "$OPENCLAW_REF"
if git -C "${STACK_ROOT}/openclaw" show-ref --verify --quiet "refs/remotes/origin/${OPENCLAW_REF}"; then
  git -C "${STACK_ROOT}/openclaw" pull --ff-only origin "$OPENCLAW_REF"
fi

if [[ "$OPENCLAW_IMAGE" == "openclaw:local" ]]; then
  log "Building OpenClaw Docker image (openclaw:local)"
  docker build -t openclaw:local "${STACK_ROOT}/openclaw"
else
  log "Pulling prebuilt OpenClaw image (${OPENCLAW_IMAGE})"
  docker pull "$OPENCLAW_IMAGE"
fi

log "Installing stack files"
install -m 640 "$ENV_FILE" "${STACK_ROOT}/.env"
install -m 644 "${TEMPLATES_DIR}/docker-compose.yml" "${STACK_ROOT}/docker-compose.yml"
install -m 755 "${ASSETS_SCRIPTS_DIR}/openai_budget_guard.py" "${STACK_ROOT}/scripts/openai_budget_guard.py"
install -m 755 "${ASSETS_SCRIPTS_DIR}/set_slack_allow_user.sh" "${STACK_ROOT}/scripts/set_slack_allow_user.sh"
install -m 755 "${ASSETS_SCRIPTS_DIR}/check_stack.sh" "${STACK_ROOT}/scripts/check_stack.sh"

if [[ -d "${ROOT_DIR}/workspace" ]]; then
  log "Copying workspace scaffold (non-destructive)"
  cp -Rn "${ROOT_DIR}/workspace/." "${STACK_ROOT}/workspace/"
fi

log "Rendering OpenClaw config"
jq -n \
  --arg model "$OPENAI_MODEL" \
  --arg gatewayToken "$OPENCLAW_GATEWAY_TOKEN" \
  --arg slackAppToken "$SLACK_APP_TOKEN" \
  --arg slackBotToken "$SLACK_BOT_TOKEN" \
  --arg slackDmPolicy "$SLACK_DM_POLICY" \
  --argjson allowFrom "$SLACK_ALLOWED_USER_IDS_JSON" \
  '{
    gateway: {
      mode: "local",
      auth: { token: $gatewayToken }
    },
    agents: {
      defaults: {
        workspace: "~/.openclaw/workspace",
        model: {
          primary: $model,
          fallbacks: ["openai/gpt-5.2-mini"]
        },
        thinkingDefault: "low",
        maxConcurrent: 1
      }
    },
    channels: {
      slack: {
        enabled: true,
        mode: "socket",
        appToken: $slackAppToken,
        botToken: $slackBotToken,
        dmPolicy: $slackDmPolicy,
        allowFrom: (($allowFrom + (if $slackDmPolicy == "open" then ["*"] else [] end)) | unique)
      }
    }
  }' > "${STACK_ROOT}/config/openclaw.json"
chmod 700 "${STACK_ROOT}/config"
chmod 600 "${STACK_ROOT}/config/openclaw.json"

log "Installing systemd units"
for unit in openclaw-gateway.service openclaw-budget-guard.service openclaw-budget-guard.timer; do
  sed "s|__STACK_ROOT__|${STACK_ROOT}|g" "${TEMPLATES_DIR}/${unit}" | sudo tee "/etc/systemd/system/${unit}" >/dev/null
done

sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-gateway.service
sudo systemctl enable --now openclaw-budget-guard.timer
sudo systemctl start openclaw-budget-guard.service

log "Stack installed."
log "Run: sudo ${STACK_ROOT}/scripts/check_stack.sh"
