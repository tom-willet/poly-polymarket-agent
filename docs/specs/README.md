# Spec Pack v1

Date: March 10, 2026

This directory contains the build-readiness specs for the Polymarket orchestrator system.

Read in this order:

1. `system-spec-v1.md`
2. `risk-policy-v1.md`
3. `service-contracts-v1.md`
4. `environment-matrix-v1.md`

Scope of this pack:

- Defines the v1 architecture and operating model.
- Freezes the initial strategy family as cross-market consistency.
- Separates LLM orchestration from deterministic risk and execution.
- Keeps live trading disabled until Polymarket gives the greenlight and internal release gates are met.

This pack is intended to be stable enough to start implementation.

Implementation checkpoint:

- `M0 Foundations` has been provisioned for `nonprod` and `prod`.
- `market-state` implements public market discovery, public book-stream normalization, authenticated account polling, and `position_snapshot` derivation.
- `market-state` also implements a long-running `loop` entrypoint for continuous ECS deployment.
- `market-state` persists compact current-state records to DynamoDB and archives NDJSON event streams to S3.
- Public market-data persistence has been verified in nonprod AWS.
- Authenticated account-state persistence has been verified in nonprod AWS with real Polymarket credentials.
- `trade-core` implements allocator, risk, execution planning, lifecycle action policy, and current-state hydration.
- `execution-worker` implements heartbeat ownership and deterministic execution-action evaluation from persisted intents.
- `openclaw-control` implements operator commands, proposal generation, decision-cycle orchestration, and ledger persistence.
- `openclaw-runtime` implements a Slack Socket Mode adapter over the control-plane command core.
- Live trading remains disabled until Polymarket gives the greenlight and internal promotion gates are satisfied.
