# Trade-Core Service

Initial `M2` implementation for deterministic allocation, risk, and execution policy.

## Current scope

- Validate incoming `strategy_proposal` payloads.
- Rank proposals across sleeves using a deterministic score.
- Size proposals under the v1 bankroll and sleeve limits.
- Emit `allocator_decision` envelopes.
- Evaluate hard risk checks and emit `risk_decision` envelopes.
- Build execution intents and reconcile order/trade lifecycle events.
- Evaluate deterministic execution actions for placement, cancel, cross, wait, and halt flows.

## Commands

```bash
pnpm --filter @poly/trade-core allocate -- --input runtime/proposals.json
pnpm --filter @poly/trade-core risk -- --input runtime/risk-input.json
pnpm --filter @poly/trade-core hydrate-risk -- --input runtime/hydrate-risk.json
pnpm --filter @poly/trade-core hydrate-plan -- --input runtime/hydrate-plan.json
pnpm --filter @poly/trade-core plan -- --input runtime/execution-input.json
pnpm --filter @poly/trade-core act -- --input runtime/execution-action-input.json
pnpm --filter @poly/trade-core test
```

## Notes

- This service now includes allocator, risk, and execution-planning layers.
- Heartbeat, lifecycle policy, and reconciliation logic exist as deterministic local modules.
- Current-state hydration can read canonical market/account snapshots from `STATE_CURRENT_TABLE`.
- Live order placement is still a separate backlog item.
- Invalid proposals are rejected before ranking.
