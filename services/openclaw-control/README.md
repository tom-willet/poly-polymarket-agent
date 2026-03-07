# OpenClaw Control Service

Initial `M3` control-plane implementation for operator commands and persisted control state.

## Current scope

- Parse operator commands into deterministic control actions.
- Persist operator mode / pause / flatten state in DynamoDB current state.
- Log operator actions into the decision ledger.
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
```

## Notes

- This is the operator command core, not the full OpenClaw runtime integration yet.
- The service reads canonical state from `STATE_CURRENT_TABLE`.
- Operator actions are written to both current state and the decision ledger.
- Trade execution authority remains outside the control plane.
