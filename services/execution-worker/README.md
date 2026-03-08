# Execution-Worker Service

Initial worker implementation for deterministic execution action evaluation and heartbeat ownership.

## Current scope

- Read persisted `execution_intent` rows from current-state.
- Evaluate deterministic `execution_action` updates using `trade-core`.
- Persist `execution_action` changes to current-state and the decision ledger.
- Persist `health#execution-heartbeat` from the execution worker instead of the control plane.
- Run safely in `paper` mode without exchange writes.

## Commands

```bash
pnpm --filter @poly/execution-worker tick
pnpm --filter @poly/execution-worker loop
pnpm --filter @poly/execution-worker test
```

## Notes

- This worker does not place live orders yet.
- In `paper` mode, heartbeat health reflects worker liveness and deterministic action evaluation only.
- `openclaw-control` is expected to publish `execution_intent` rows into current-state for this worker to consume.
