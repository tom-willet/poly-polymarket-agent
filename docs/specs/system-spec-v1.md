# System Spec v1

Date: March 6, 2026

Status: Approved for implementation planning

## 1. Purpose

Define the first production-minded version of the Polymarket orchestrator system. This spec freezes the initial architecture, operating modes, service boundaries, and first strategy family so implementation can begin without redesigning the system mid-build.

## 2. Mission

Build an autonomous trading orchestration system that:

- Finds and ranks legal Polymarket opportunities.
- Allocates capital across multiple strategy sleeves.
- Enforces hard deterministic risk limits.
- Executes approved intents safely.
- Improves over time using replay, attribution, and scorecards.

## 3. Scope

Included in v1:

- Slack-controlled orchestrator built on OpenClaw.
- AWS-hosted services for market state, risk, execution, and storage.
- Three operating modes: `sim`, `paper`, `prod`.
- One live strategy family at launch: `cross-market consistency`.
- Multi-sleeve support at the allocator and risk level.
- Full decision/event ledger for audit and replay.

Explicitly excluded from v1:

- News/NLP alpha.
- Maker quoting as a live sleeve.
- Direct LLM order placement.
- Cross-exchange trading.
- Fully separate live wallet per sleeve in the bootstrap phase.

## 4. Non-Negotiable Decisions

1. The LLM is the orchestrator, not the execution engine.
2. OpenClaw does not hold unrestricted live trading authority.
3. `sim`, `paper`, and `prod` are separate environments with separate credentials.
4. Live trading stays disabled until Polymarket gives the greenlight and internal release gates are satisfied.
5. Cross-market consistency is the only strategy family allowed to trade in the first live release.
6. Production starts with one live execution wallet and virtual sleeve accounting. Separate live wallets are deferred until bankroll and operational complexity justify them.

## 5. Operating Modes

### `sim`

- Historical replay and forward simulation.
- No exchange writes.
- Uses archived and synthetic state.
- Used for research, regression tests, and backtest validation.

### `paper`

- Live market data and live account-style state machine.
- No exchange writes.
- Generates shadow orders, fills, and scorecards.
- Used to validate decision quality and execution logic before live release.

### `prod`

- Live market data and live exchange writes.
- Fully autonomous within hard limits.
- Only enabled after compliance approval and internal promotion gates are met.

## 6. v1 Strategy Model

### Primary family: `cross-market consistency`

Definition:

- The system looks for related Polymarket contracts whose implied pricing becomes inconsistent after estimated fees, slippage, and liquidity constraints.

Examples:

- Mutually exclusive outcomes that sum above or below fair aggregate value.
- Parent/child or nested contracts whose pricing conflicts.
- Closely linked event markets whose implied probabilities drift out of alignment.

Initial design requirements:

- Every tradable opportunity must map to a defined `market_complex_id`.
- Every opportunity must estimate `edge_after_costs`.
- Every opportunity must include invalidation logic and maximum holding horizon.
- The strategy must prefer auditable logic over opaque model output.

Deferred families:

- `maker_rebate`
- `event_repricing`
- `microstructure`

These may exist in research mode, but they are not allowed to trade in the first live release.

## 7. Architecture

### 7.1 Control Plane: `openclaw-control`

Responsibilities:

- Receive operator commands in Slack.
- Request proposals from strategy sub-agents.
- Rank proposals and explain decisions.
- Manage allocation policy at the portfolio level.
- Publish human-readable status, incidents, and daily summaries.

Allowed outputs:

- `strategy_request`
- `allocator_decision`
- `operator_notification`
- `execution_request`

Forbidden outputs:

- Raw direct order placement.
- Secret retrieval outside approved interfaces.

### 7.2 State Plane: `market-state`

Responsibilities:

- Ingest Polymarket market discovery data.
- Maintain normalized order book and market snapshots.
- Track balances, positions, open orders, and fills.
- Maintain canonical live state for the rest of the system.

Key rule:

- If canonical state cannot be trusted, the system must halt new execution.

### 7.3 Trade Core: `trade-core`

Responsibilities:

- Normalize strategy proposals.
- Apply deterministic risk checks.
- Convert approved intents into order plans.
- Manage order lifecycle, retries, heartbeats, cancels, and reconciliation.

Internal modules:

- `allocator`
- `risk-kernel`
- `execution-engine`
- `reconciler`

### 7.4 Data Plane

AWS services:

- `DynamoDB` for current state, control state, scorecards, and idempotency keys.
- `S3` for raw market archives, decision ledgers, replay input, and daily exports.
- `CloudWatch` for logs, metrics, alarms, and incident triggers.
- `Secrets Manager` for API keys and wallet secrets.

### 7.5 Analytics and Replay

Responsibilities:

- Produce daily scorecards.
- Support deterministic replays from archived market state and decisions.
- Attribute P&L by sleeve, market complex, and decision path.

## 8. Control Flow

1. `market-state` ingests and normalizes market and account data.
2. `openclaw-control` requests opportunities from enabled sub-agents.
3. Strategy proposals are normalized into a single schema.
4. `allocator` ranks proposals across sleeves.
5. `risk-kernel` approves, resizes, or rejects each candidate.
6. `execution-engine` converts approved intents into concrete orders.
7. Fills, cancels, and position changes flow back into canonical state.
8. All steps are written to the ledger for replay and review.

## 9. AWS Deployment Decision

Primary region:

- `us-west-2`

Compute model:

- `Amazon ECS Fargate (ARM)` for always-on services

Always-on services in v1:

- `openclaw-control`
- `market-state`
- `trade-core`

Support services:

- `EventBridge Scheduler` for daily summaries and replay jobs
- `CloudWatch Alarms` for health and risk alerts

## 10. Slack Control Surface

Required commands:

- `status`
- `why`
- `risk`
- `pause`
- `resume`
- `flatten`
- `mode`
- `sleeves`

Rules:

- Human commands can pause or flatten the system immediately.
- `prod` mode changes require explicit privileged operator authorization.
- Slack is an operator surface only; it is not part of the order path.

## 11. Promotion Gates

### Promotion from `sim` to `paper`

- Replay tests pass.
- Canonical market state is stable.
- Strategy proposals serialize to the approved contract.
- Risk engine blocks all known failure cases.

### Promotion from `paper` to `prod`

- Paper results show positive edge after modeled costs.
- Order simulation and reconciliation are stable.
- Incident response and kill switches are tested.
- Compliance and platform approval are confirmed.

## 12. Acceptance Criteria for Build Start

Implementation may begin once all of the following are treated as frozen:

1. Service boundaries in this document.
2. Risk limits in `risk-policy-v1.md`.
3. Schemas in `service-contracts-v1.md`.
4. Environment separation in `environment-matrix-v1.md`.

## 13. Source Notes

This spec reflects internal design decisions informed by current platform constraints and approved business assumptions. See the executive proposal for reference links and budget assumptions:

- [executive-business-proposal.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/docs/executive-business-proposal.md)
