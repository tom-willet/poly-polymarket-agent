# Execution-Worker Service

Initial worker implementation for deterministic execution action evaluation and heartbeat ownership.

## Current scope

- Read persisted `execution_intent` rows from current-state.
- Evaluate deterministic `execution_action` updates using `trade-core`.
- Persist `execution_action` changes to current-state and the decision ledger.
- Persist `health#execution-heartbeat` from the execution worker instead of the control plane.
- Run safely in `paper` mode without exchange writes.
- Simulate passive resting, cancel escalation, and cross fills in a deterministic paper broker.
- Persist paper portfolio state:
  - `paper_order`
  - `paper_fill`
  - `paper_cash_snapshot`
  - `paper_position_state`
  - aggregated `position_snapshot`

## Commands

```bash
pnpm --filter @poly/execution-worker tick
pnpm --filter @poly/execution-worker loop
pnpm --filter @poly/execution-worker test
```

## Notes

- This worker does not place live orders yet.
- In `paper` mode, heartbeat health reflects worker liveness and deterministic paper-broker execution only.
- `openclaw-control` is expected to publish `execution_intent` rows into current-state for this worker to consume.
- `PAPER_STARTING_CASH_USD` controls the starting virtual bankroll for paper runs.
