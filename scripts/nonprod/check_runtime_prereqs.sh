#!/usr/bin/env bash

set -euo pipefail

AWS_PROFILE="${AWS_PROFILE:-mullet-dev}"
AWS_REGION="${AWS_REGION:-us-west-2}"
CURRENT_STATE_TABLE="${CURRENT_STATE_TABLE:-poly-orchestrator-nonprod-current-state}"

required_secrets=(
  "/poly/nonprod/slack-bot-token"
  "/poly/nonprod/slack-app-token"
  "/poly/nonprod/openai-api-key"
)

echo "Checking nonprod runtime prerequisites"
echo "AWS_PROFILE=${AWS_PROFILE}"
echo "AWS_REGION=${AWS_REGION}"
echo

missing_versions=0
for secret_id in "${required_secrets[@]}"; do
  version_count="$(
    AWS_PROFILE="${AWS_PROFILE}" AWS_REGION="${AWS_REGION}" \
      aws secretsmanager list-secret-version-ids \
      --secret-id "${secret_id}" \
      --query 'length(Versions)' \
      --output text
  )"

  if [[ "${version_count}" == "0" ]]; then
    echo "MISSING VALUE  ${secret_id}"
    missing_versions=$((missing_versions + 1))
  else
    echo "READY          ${secret_id}"
  fi
done

echo
AWS_PROFILE="${AWS_PROFILE}" AWS_REGION="${AWS_REGION}" \
  aws dynamodb get-item \
  --table-name "${CURRENT_STATE_TABLE}" \
  --key '{"pk":{"S":"health#execution-heartbeat"},"sk":{"S":"latest"}}' \
  --output json || true

echo
if [[ "${missing_versions}" -gt 0 ]]; then
  echo "Nonprod runtime is blocked: ${missing_versions} required secret(s) have no stored value."
  exit 1
fi

echo "Nonprod runtime prerequisites look ready."
