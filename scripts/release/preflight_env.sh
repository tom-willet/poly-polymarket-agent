#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <service-name> <env-file> [approval-json]" >&2
  exit 1
fi

SERVICE_NAME="$1"
ENV_FILE="$2"
APPROVAL_FILE="${3:-${PROD_APPROVAL_FILE:-}}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

case "${APP_ENV:-}" in
  nonprod|prod) ;;
  *)
    echo "APP_ENV must be nonprod or prod" >&2
    exit 1
    ;;
esac

case "${RUNTIME_MODE:-}" in
  sim|paper|prod) ;;
  *)
    echo "RUNTIME_MODE must be sim, paper, or prod" >&2
    exit 1
    ;;
esac

case "${TRADING_ENABLED:-}" in
  true|false) ;;
  *)
    echo "TRADING_ENABLED must be true or false" >&2
    exit 1
    ;;
esac

if [[ -z "${RISK_POLICY_VERSION:-}" ]]; then
  echo "RISK_POLICY_VERSION must be set" >&2
  exit 1
fi

if [[ "$APP_ENV" == "nonprod" && "$TRADING_ENABLED" == "true" ]]; then
  echo "Nonprod deployments may not enable trading" >&2
  exit 1
fi

if [[ "$APP_ENV" == "prod" ]]; then
  if [[ "$RUNTIME_MODE" != "paper" && "$RUNTIME_MODE" != "prod" ]]; then
    echo "Prod APP_ENV must use paper or prod runtime mode" >&2
    exit 1
  fi

  if [[ "$TRADING_ENABLED" == "true" || "$RUNTIME_MODE" == "prod" ]]; then
    if [[ -z "$APPROVAL_FILE" || ! -f "$APPROVAL_FILE" ]]; then
      echo "Prod trading requires an approval JSON file" >&2
      exit 1
    fi

    jq -e '
      .status == "approved" and
      .polymarket_enablement == "approved" and
      .trading_enabled == true and
      (.risk_policy_version | length > 0)
    ' "$APPROVAL_FILE" >/dev/null

    APPROVAL_RISK_POLICY_VERSION="$(jq -r '.risk_policy_version' "$APPROVAL_FILE")"
    if [[ "$APPROVAL_RISK_POLICY_VERSION" != "$RISK_POLICY_VERSION" ]]; then
      echo "Approval risk policy version does not match env file" >&2
      exit 1
    fi
  fi
fi

echo "Preflight passed for $SERVICE_NAME ($APP_ENV/$RUNTIME_MODE)"
