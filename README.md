# poly-polymarket-agent

Specs, deployment assets, and workspace scaffolding for a Slack-controlled Polymarket orchestration system built around `openclaw/openclaw`.

Current focus:
- v1 build-readiness specs.
- AWS foundation scaffold for `nonprod` and `prod`.
- AWS-hosted control, state, and trade-core services.
- OpenAI model routing for orchestration and reporting.
- Slack control surface.
- Multi-sleeve Polymarket orchestration scaffold.

Current implementation status:
- `M0 Foundations`: complete in repo and provisioned in AWS.
- `M1 Market State`: market universe ingestion complete.
- `M1 Market State`: public market WebSocket normalization complete.
- `M1 Market State`: account-state polling, health checks, and persistence plumbing complete.
- `M1 Market State`: nonprod DynamoDB/S3 persistence verified for the public market-data path.
- `M1 Market State`: authenticated account-state persistence still needs live credential verification.
- `M2 Trade Core`: allocator, risk kernel, execution intent planning, heartbeat handling, and reconciliation started.
- `M3 Control Plane`: operator command core started.
- `M3 Control Plane`: cross-market consistency proposal generator started.
- `M3 Control Plane`: first integrated decision cycle started.

Checkpoint notes:
- Terraform foundation exists for separate `nonprod` and `prod` environments.
- GitHub milestones/issues are live and being used as the implementation backlog.
- `market-state` currently emits `market_universe_snapshot`, `market_snapshot`, `market_data_health`, `account_state_snapshot`, and `account_state_health` envelopes.
- Latest-state persistence uses DynamoDB for compact records and S3 for NDJSON archives.
- `market_universe_snapshot` is archived to S3 only because the full payload exceeds DynamoDB item-size limits.
- `trade-core` can now produce `allocator_decision`, `risk_decision`, `execution_intent`, and `execution_action` envelopes.
- `trade-core` can now hydrate risk and execution inputs from the canonical current-state table.
- `openclaw-control` can now persist operator mode / pause / flatten state and produce Slack-ready operator responses.
- `openclaw-control` can now scan canonical market snapshots and emit `strategy_proposal` envelopes for binary complement inconsistencies.
- `openclaw-control` can now run an in-process decision cycle from proposal generation through allocator, risk, and execution intent planning.
- Live trading remains disabled pending Polymarket US beta enablement and explicit production approval.

Specs:
- [docs/specs/README.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/docs/specs/README.md)
- [docs/executive-business-proposal.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/docs/executive-business-proposal.md)
- [docs/backlog/github-issues-v1.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/docs/backlog/github-issues-v1.md)

Infrastructure:
- [infra/terraform/README.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/infra/terraform/README.md)

Services:
- [services/market-state/README.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/services/market-state/README.md)
- [services/trade-core/README.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/services/trade-core/README.md)
- [services/openclaw-control/README.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/services/openclaw-control/README.md)

Legacy deployment reference:
- [deploy/lightsail/README.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/deploy/lightsail/README.md)
