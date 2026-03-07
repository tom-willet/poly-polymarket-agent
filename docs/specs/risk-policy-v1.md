# Risk Policy v1

Date: March 6, 2026

Status: Frozen for v1 implementation

## 1. Purpose

Define the deterministic risk limits for the orchestrator system. These limits apply regardless of strategy confidence, LLM output, or operator preference, unless the system is explicitly moved out of autonomous mode.

## 2. Risk Principles

1. Survive first. Optimize second.
2. No trade is mandatory.
3. If state is stale or reconciliation is broken, new execution stops.
4. Small bankroll means concentrated mistakes are unacceptable.
5. The risk kernel is authoritative over all strategy sleeves.

## 3. Mode Policy

### `sim`

- Unlimited synthetic runs.
- No exchange writes.
- Used for research and replay only.

### `paper`

- No exchange writes.
- Shadow notional tracks a `$1,000` bankroll.
- Risk rules mirror production as closely as possible.

### `prod`

Stage 1 bankroll:

- `$500` for the first 30 days of live R&D

Stage 2 bankroll:

- `$1,000` after successful 30-day review

Profit policy:

- Profits stay in bankroll by default.
- Additional capital above bankroll thresholds requires leadership review.

## 4. Capital and Exposure Limits

These limits apply in `prod`.

### Global

- Max gross exposure: `70%` of bankroll
- Max reserved capital including open orders: `85%` of bankroll
- Max daily realized plus unrealized loss before halt: `7.5%` of bankroll
- Max trailing 7-day drawdown before halt: `15%` of bankroll

### Sleeve

- Max capital at risk per sleeve: `35%` of bankroll
- Max active sleeves with live exposure in bootstrap production: `2`

### Market and contract

- Max capital at risk per market complex: `20%` of bankroll
- Max capital at risk per individual contract: `12%` of bankroll
- Max initial order slice: `5%` of bankroll

### Order book quality

- Do not trade if estimated spread per leg exceeds `4` cents unless the trade is part of an explicitly approved complex with larger modeled edge.
- Do not trade if combined estimated fees plus slippage consume more than `50%` of expected gross edge.
- Do not trade if visible top-of-book depth is less than `3x` intended initial slice size.

## 5. Eligibility Rules for v1 Trading

Every live opportunity must satisfy all of the following:

1. Belongs to a defined `market_complex_id`.
2. Has clear resolution rules.
3. Has positive `edge_after_costs`.
4. Meets minimum liquidity and spread thresholds.
5. Has an explicit invalidation condition.
6. Has a defined maximum holding horizon.

Default v1 filters:

- Minimum net edge after costs: `3` cents per share-equivalent or `1.5x` modeled costs, whichever is larger
- Minimum time to resolution: `4` hours
- Maximum time to resolution: `45` days

## 6. Operational Halt Conditions

New live execution must stop immediately if any of the following occurs:

1. Canonical market state is stale beyond configured tolerance.
2. Order/account reconciliation fails.
3. Execution heartbeat health is degraded.
4. Wallet balance does not match expected state.
5. Daily or weekly loss limit is breached.
6. An operator issues `pause` or `flatten`.
7. The environment is not explicitly set to `prod`.

When halted:

- No new orders may be placed.
- Existing open orders must be canceled unless cancel safety logic says otherwise.
- The system must notify Slack with cause and current exposure.

## 7. Staleness and Health Thresholds

These are initial v1 values and may be tuned only through a controlled config change:

- Market data stale threshold: `5` seconds
- Account/order state stale threshold: `15` seconds
- Risk evaluation timeout: `500` ms
- Strategy proposal TTL: `30` seconds
- Reconciliation mismatch tolerance: `0` for cash and positions

## 8. Human Control Policy

- `pause`: stop new execution, keep monitoring
- `resume`: allow new execution if all health checks pass
- `flatten`: cancel open orders and reduce all live exposure as quickly and safely as possible
- `mode`: changing into `prod` requires privileged operator authorization and all green checks

## 9. Promotion Rules

### To enable the first live R&D launch

All of the following must be true:

1. Compliance approval is documented.
2. Paper mode has run without unresolved control incidents.
3. Replay and reconciliation tests pass.
4. Slack pause and flatten commands are verified.
5. Risk limits are loaded from the approved production config.

### To increase bankroll from `$500` to `$1,000`

All of the following must be true:

1. First 30 days of live R&D completed.
2. Net realized P&L is positive after direct costs.
3. No unresolved risk-control failures occurred.
4. Leadership approves the step-up.

## 10. Governance

- Risk policy changes require a documented revision.
- Production risk parameters must be versioned and immutable by default.
- LLM prompts cannot override hard-coded risk checks.

## 11. Related Specs

- [system-spec-v1.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/docs/specs/system-spec-v1.md)
- [service-contracts-v1.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/docs/specs/service-contracts-v1.md)
- [environment-matrix-v1.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/docs/specs/environment-matrix-v1.md)
