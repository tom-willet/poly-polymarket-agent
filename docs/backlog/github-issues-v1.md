# GitHub Issues Backlog v1

Date: March 9, 2026

This is the recommended initial GitHub Issues backlog derived from the v1 spec pack.

## Milestones

### `M0 Foundations`

- `[Epic] M0 Foundations and environment separation`
- `Provision AWS foundation for nonprod and prod`
- `Implement environment config, secrets boundaries, and release gates`

### `M1 Market State`

- `[Epic] M1 Market-state service`
- `Implement Polymarket market discovery and tradable universe ingestion`
- `Implement real-time book, order, and account state normalization`
- `Persist canonical snapshots and publish state events`

### `M2 Trade Core`

- `[Epic] M2 Trade-core service`
- `Implement proposal normalization and portfolio allocator`
- `Implement deterministic risk kernel and halt logic`
- `Implement execution engine, heartbeat handling, and reconciliation`

### `M3 Control Plane`

- `[Epic] M3 OpenClaw control plane`
- `Implement Slack operator commands and control workflows`
- `Implement cross-market consistency proposal generator`

### `M4 Paper Readiness`

- `[Epic] M4 Replay, ledger, and paper-trading readiness`
- `Implement decision ledger, scorecards, and daily summaries`
- `Build replay harness and promotion test suite`
- `Prepare production release runbook and beta enablement gate`

## Recommended Build Order

1. `M0 Foundations`
2. `M1 Market State`
3. `M2 Trade Core`
4. `M3 Control Plane`
5. `M4 Paper Readiness`

## Notes

- `cross-market consistency` is the only live-trading strategy family in v1.
- `prod` remains disabled until Polymarket provides the greenlight and internal release gates are complete.
- The GitHub-creation manifest for this backlog lives in `ops/github/backlog-v1.json`.

## Checkpoint

- `[Epic] M0 Foundations and environment separation`: completed
- `Provision AWS foundation for nonprod and prod`: completed
- `Implement environment config, secrets boundaries, and release gates`: completed
- `Implement Polymarket market discovery and tradable universe ingestion`: completed
- `Implement real-time book, order, and account state normalization`: in progress
- `Persist canonical snapshots and publish state events`: in progress
- `Implement proposal normalization and portfolio allocator`: completed
- `Implement deterministic risk kernel and halt logic`: completed
- `Implement execution engine, heartbeat handling, and reconciliation`: in progress
- `[Epic] M3 OpenClaw control plane`: completed
- `Implement Slack operator commands and control workflows`: completed
- `Implement cross-market consistency proposal generator`: completed
- `Implement decision ledger, scorecards, and daily summaries`: in progress

Checkpoint notes:

- nonprod IAM for `market-state` current-state and archive writes has been applied
- public market-data persistence path has been verified end to end against nonprod DynamoDB and S3
- `execution-worker` now persists `health#execution-heartbeat` into current-state and this path has been verified in nonprod DynamoDB
- authenticated nonprod `account_state_snapshot` / `account_state_health` persistence is now verified with real Polymarket credentials
- `position_snapshot` publication remains unverified in a live non-empty account because the verified wallet currently has zero positions
- `trade-core` now has a deterministic allocator with proposal validation, ranking, and bankroll-aware sizing
- `trade-core` now has a deterministic risk kernel with halt, reject, approve, and resize outcomes
- `trade-core` now has deterministic execution intent planning, lifecycle action evaluation, heartbeat health tracking, and user-channel reconciliation modules
- `execution-worker` now owns `health#execution-heartbeat`, consumes `execution_intent` rows, and persists `execution_action` updates
- `trade-core` now has a read-side bridge from DynamoDB current-state records into risk and execution planning inputs
- `openclaw-control` now has an operator command core with persisted mode / pause / flatten state and ledger logging
- `openclaw-control` now has a deterministic proposal generator for binary complement consistency checks
- `openclaw-control` now has an integrated decision-cycle command that runs proposal generation through allocator, risk, and execution intent planning, then persists `execution_intent` rows for downstream execution
- `openclaw-control` now derives cycle exposure and performance from persisted sources when available, with controlled fallbacks where live position data is not yet present
- `openclaw-runtime` now provides a Slack Socket Mode adapter over the command core and is deployed as the nonprod ECS service `poly-orchestrator-nonprod-openclaw-runtime`
- the Slack runtime now ignores bot/subtype events and executes one command per non-empty Slack message line
- nonprod Slack/OpenAI secrets are populated and real Slack `status` / `risk` validation has completed through ECS

## Live GitHub Status

- Closed: `#1`, `#2`, `#3`, `#5`, `#9`, `#10`, `#12`, `#13`, `#14`
- Open: `#4`, `#6`, `#7`, `#8`, `#11`, `#15`, `#16`, `#17`, `#18`

Reason the remaining issues stay open:

- `#6`: authenticated order/account normalization is now verified for an empty live account, but user-channel coverage and position-bearing validation still remain
- `#7`: authenticated persistence path is now verified for account snapshots, but position-bearing runs and the remaining persistence paths still remain
- `#11`: dedicated execution worker now exists, but the live exchange write path and Polymarket heartbeat ack loop do not
- `#15`-`#18`: replay, scorecards, daily summaries, promotion testing, and runbook work are still ahead
