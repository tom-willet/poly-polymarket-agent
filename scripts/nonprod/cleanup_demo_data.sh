#!/usr/bin/env bash

set -euo pipefail

PROFILE="${AWS_PROFILE:-mullet-dev}"
CURRENT_STATE_TABLE="${CURRENT_STATE_TABLE:-poly-orchestrator-nonprod-current-state}"
DECISION_LEDGER_TABLE="${DECISION_LEDGER_TABLE:-poly-orchestrator-nonprod-decision-ledger}"

delete_current_state_item() {
  local pk="$1"
  local sk="$2"
  aws dynamodb delete-item \
    --profile "$PROFILE" \
    --table-name "$CURRENT_STATE_TABLE" \
    --key "{\"pk\":{\"S\":\"$pk\"},\"sk\":{\"S\":\"$sk\"}}" \
    >/dev/null
  echo "deleted current-state item: $pk | $sk"
}

delete_ledger_prefix() {
  local prefix="$1"
  local values_file
  values_file="$(mktemp)"
  trap 'rm -f "$values_file"' RETURN

  cat >"$values_file" <<EOF
{":prefix":{"S":"$prefix"}}
EOF

  local items
  items="$(aws dynamodb scan \
    --profile "$PROFILE" \
    --table-name "$DECISION_LEDGER_TABLE" \
    --filter-expression 'begins_with(pk, :prefix)' \
    --expression-attribute-values "file://$values_file" \
    --query 'Items[].{pk:pk.S,sk:sk.S}' \
    --output text)"

  if [[ -z "$items" ]]; then
    echo "no ledger items found for prefix: $prefix"
    return
  fi

  while IFS=$'\t' read -r pk sk; do
    [[ -z "${pk:-}" || -z "${sk:-}" ]] && continue
    aws dynamodb delete-item \
      --profile "$PROFILE" \
      --table-name "$DECISION_LEDGER_TABLE" \
      --key "{\"pk\":{\"S\":\"$pk\"},\"sk\":{\"S\":\"$sk\"}}" \
      >/dev/null
    echo "deleted ledger item: $pk | $sk"
  done <<<"$items"
}

delete_current_state_item "market#demo-ct-yes" "snapshot"
delete_current_state_item "market#demo-ct-no" "snapshot"

delete_ledger_prefix "strategy_proposal#cfbc4032-fa5a-4a26-84bf-c499f7aa6af9"
delete_ledger_prefix "strategy_proposal#0fddeb04-8f0a-4eea-ae44-444f7908833b"
delete_ledger_prefix "strategy_proposal#d4588dd5-099e-44a0-a3d3-380596eefadb"
delete_ledger_prefix "allocator_decision#d99ac34f-f1eb-40ba-8434-7c12d454faee"
delete_ledger_prefix "allocator_decision#dccd9765-821c-474f-92ee-23c406642fe5"
delete_ledger_prefix "risk_decision#d99ac34f-f1eb-40ba-8434-7c12d454faee"
delete_ledger_prefix "risk_decision#dccd9765-821c-474f-92ee-23c406642fe5"
delete_ledger_prefix "execution_intent#30f4aebf-737f-4c29-8cfa-56b5ff2549da"
delete_ledger_prefix "execution_intent#93aa97d6-368c-4ae0-b1c5-b1f70925130a"
delete_ledger_prefix "decision_cycle#0a6d1db8-2f02-4b38-b5f2-7a6420a723ac"
delete_ledger_prefix "decision_cycle#3e7be167-77f6-4026-8205-5a064a3571ed"
