# OpenClaw Control Service

Initial `M3` control-plane implementation for operator commands and persisted control state.

## Current scope

- Parse operator commands into deterministic control actions.
- Persist operator mode / pause / flatten state in DynamoDB current state.
- Log operator actions into the decision ledger.
- Generate deterministic `cross_market_core` strategy proposals from canonical market snapshots.
- Run the first integrated decision cycle from proposal generation into `trade-core`.
- Build Slack-ready response payloads for:
  - `status`
  - `why`
  - `risk`
  - `pause`
  - `resume`
  - `flatten`
  - `mode`
  - `sleeves`

## Commands

```bash
AWS_PROFILE=mullet-dev \
STATE_CURRENT_TABLE=poly-orchestrator-nonprod-current-state \
DECISION_LEDGER_TABLE=poly-orchestrator-nonprod-decision-ledger \
pnpm --filter @poly/openclaw-control handle -- --input runtime/operator-command.json

AWS_PROFILE=mullet-dev \
STATE_CURRENT_TABLE=poly-orchestrator-nonprod-current-state \
DECISION_LEDGER_TABLE=poly-orchestrator-nonprod-decision-ledger \
pnpm --filter @poly/openclaw-control propose

AWS_PROFILE=mullet-dev \
STATE_CURRENT_TABLE=poly-orchestrator-nonprod-current-state \
DECISION_LEDGER_TABLE=poly-orchestrator-nonprod-decision-ledger \
pnpm --filter @poly/openclaw-control cycle
```

## Notes

- This is the operator command core, not the full OpenClaw runtime integration yet.
- The service reads canonical state from `STATE_CURRENT_TABLE`.
- Operator actions are written to both current state and the decision ledger.
- Proposal generation is currently limited to binary complement consistency checks inside one market.
- `cycle` now derives exposure from `position_snapshot` rows when available, otherwise falls back to account state.
- `cycle` now derives performance from `position_snapshot` rows when available, otherwise falls back to zero.
- `cycle` now derives execution heartbeat from current-state health when available, with a non-prod fallback policy.
- `cycle` now persists `execution_intent` rows into current-state for the execution worker to consume.
- Trade execution authority remains outside the control plane.
