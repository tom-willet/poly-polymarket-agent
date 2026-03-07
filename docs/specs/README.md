# Spec Pack v1

Date: March 6, 2026

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
- `market-state` is the first active service under implementation.
- Public market discovery and public book-stream normalization are implemented.
- Private account/order reconciliation and downstream persistence are not implemented yet.
