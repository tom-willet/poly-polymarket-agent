#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST_PATH="${1:-$ROOT_DIR/ops/github/backlog-v1.json}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Manifest not found: $MANIFEST_PATH" >&2
  exit 1
fi

TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "Set GITHUB_TOKEN or GH_TOKEN before running this script." >&2
  exit 1
fi

REMOTE_URL="$(git -C "$ROOT_DIR" remote get-url origin)"
OWNER_REPO="$(printf '%s' "$REMOTE_URL" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
OWNER="${OWNER_REPO%%/*}"
REPO="${OWNER_REPO##*/}"
API_BASE="https://api.github.com/repos/$OWNER/$REPO"

auth_header=("Authorization: Bearer $TOKEN")
accept_header=("Accept: application/vnd.github+json")
api_version_header=("X-GitHub-Api-Version: 2022-11-28")

github_api() {
  local method="$1"
  local url="$2"
  local data="${3:-}"

  if [[ -n "$data" ]]; then
    curl -fsS -X "$method" \
      -H "${auth_header[0]}" \
      -H "${accept_header[0]}" \
      -H "${api_version_header[0]}" \
      "$url" \
      -d "$data"
  else
    curl -fsS -X "$method" \
      -H "${auth_header[0]}" \
      -H "${accept_header[0]}" \
      -H "${api_version_header[0]}" \
      "$url"
  fi
}

label_exists() {
  local label_name="$1"
  local encoded
  encoded="$(jq -rn --arg value "$label_name" '$value|@uri')"
  github_api GET "$API_BASE/labels/$encoded" >/dev/null 2>&1
}

milestone_number() {
  local title="$1"
  github_api GET "$API_BASE/milestones?state=all&per_page=100" |
    jq -r --arg title "$title" '.[] | select(.title == $title) | .number' |
    head -n 1
}

issue_exists() {
  local title="$1"
  github_api GET "$API_BASE/issues?state=all&per_page=100" |
    jq -r --arg title "$title" '.[] | select(.pull_request | not) | select(.title == $title) | .number' |
    head -n 1
}

echo "Creating labels from $MANIFEST_PATH"
jq -c '.labels[]' "$MANIFEST_PATH" | while read -r label; do
  name="$(jq -r '.name' <<<"$label")"
  if label_exists "$name"; then
    echo "  label exists: $name"
    continue
  fi
  payload="$(jq -c '{name, color, description}' <<<"$label")"
  github_api POST "$API_BASE/labels" "$payload" >/dev/null
  echo "  created label: $name"
done

echo "Creating milestones from $MANIFEST_PATH"
jq -c '.milestones[]' "$MANIFEST_PATH" | while read -r milestone; do
  title="$(jq -r '.title' <<<"$milestone")"
  if [[ -n "$(milestone_number "$title")" ]]; then
    echo "  milestone exists: $title"
    continue
  fi
  payload="$(jq -c '{title, description}' <<<"$milestone")"
  github_api POST "$API_BASE/milestones" "$payload" >/dev/null
  echo "  created milestone: $title"
done

echo "Creating issues from $MANIFEST_PATH"
jq -c '.issues[]' "$MANIFEST_PATH" | while read -r issue; do
  title="$(jq -r '.title' <<<"$issue")"
  if [[ -n "$(issue_exists "$title")" ]]; then
    echo "  issue exists: $title"
    continue
  fi

  milestone_title="$(jq -r '.milestone' <<<"$issue")"
  milestone_id="$(milestone_number "$milestone_title")"
  if [[ -z "$milestone_id" ]]; then
    echo "Missing milestone for issue: $title" >&2
    exit 1
  fi

  payload="$(jq -c --argjson milestone "$milestone_id" '{title, body, labels, milestone: $milestone}' <<<"$issue")"
  github_api POST "$API_BASE/issues" "$payload" >/dev/null
  echo "  created issue: $title"
done

echo "Backlog creation complete for $OWNER_REPO"
