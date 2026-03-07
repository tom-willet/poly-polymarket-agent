# GitHub Issues Backlog v1

Date: March 6, 2026

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

- `Provision AWS foundation for nonprod and prod`: completed
- `Implement environment config, secrets boundaries, and release gates`: completed
- `Implement Polymarket market discovery and tradable universe ingestion`: completed
- `Implement real-time book, order, and account state normalization`: in progress
- `Persist canonical snapshots and publish state events`: in progress

Checkpoint notes:

- nonprod IAM for `market-state` current-state and archive writes has been applied
- public market-data persistence path has been verified end to end against nonprod DynamoDB and S3
- authenticated account-state persistence remains unverified until nonprod Polymarket credentials are available
