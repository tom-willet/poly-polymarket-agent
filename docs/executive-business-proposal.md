# Executive Business Proposal: Polymarket Quant Orchestrator v1

Date: March 6, 2026

Status: Draft for executive leadership and finance review

## 1. Executive Summary

We propose building a production-grade, autonomous "quant" orchestration system that aims to identify and execute profitable, legal trading strategies on Polymarket through a multi-agent architecture. The system will use OpenClaw as the control plane, AWS as the operating platform, deterministic execution and risk services for trade safety, and OpenAI models for orchestration, reasoning, and reporting.

The recommended initial strategy family is cross-market consistency. This is the lowest-complexity, most auditable starting point because it relies on measurable pricing inconsistencies across related markets rather than opaque narratives or ultra-low-latency reactions.

This proposal requests approval for:

- Up to `$150/month` for AWS infrastructure.
- Up to `$250/month` for OpenAI API usage.
- A phased rollout: simulation, paper trading, then a small-capital live launch.
- A first-30-days live R&D bankroll of `$500`, followed by an operating bankroll of `$1,000` if initial validation is successful.
- A reinvestment model in which realized profits are retained in bankroll and used to widen strategy coverage over time.

Important gating item: as of March 6, 2026, Polymarket documentation lists the United States as a restricted jurisdiction. This means live trading must not begin until legal/compliance confirms an eligible operating entity and eligible operators in a permitted jurisdiction. This proposal therefore recommends immediate approval for the production-grade build and paper-trading environment, with live deployment gated behind legal sign-off.

## 2. Business Objective

The objective is to build a system that can:

- Run multiple independent strategy sleeves at the same time.
- Allocate capital dynamically across those sleeves.
- Improve over time using feedback from realized P&L, calibration, and execution quality.
- Operate within strict, deterministic risk controls.

The economic target is not "high win rate." The target is positive risk-adjusted net P&L after slippage, fees, rebates, and model costs.

## 3. Why This Opportunity Is Attractive

Prediction markets are fragmented, event-driven, and often inefficient across related contracts. That creates three attractive conditions for a systematic strategy platform:

- Related contracts can become temporarily inconsistent.
- Liquidity is uneven, creating measurable execution edge for disciplined systems.
- Market participants are heterogeneous, which increases the chance of repeatable pricing errors.
- Small bankrolls can be deployed nimbly, reducing market impact and improving the odds that intended trades are actually filled at target prices.

Our recommendation is to start with cross-market consistency because:

- It is easier to audit and explain to finance and leadership.
- It requires less dependence on external news latency.
- It is less likely to overfit than narrative-heavy strategies.
- It creates a strong foundation for later layers such as maker quoting and event repricing.

## 4. High-Level System Design

The proposed system has six layers:

1. Control plane
OpenClaw runs as the operator-facing orchestrator in Slack. It gathers opportunities from sub-agents, ranks them, explains decisions, and handles human controls such as `status`, `risk`, `pause`, `resume`, and `flatten`.

2. State plane
A deterministic market/account service ingests Polymarket market data, order book updates, fills, balances, and open orders. This service maintains the canonical system state used by all strategy sleeves.

3. Decision plane
The orchestrator requests standardized proposals from multiple sub-agents. Each proposal contains thesis, expected edge after costs, confidence, holding period, invalidation logic, and risk impact.

4. Risk plane
A deterministic risk kernel enforces hard limits on position size, concentration, sleeve exposure, loss limits, stale data, and trading mode. This layer can veto any proposal.

5. Execution plane
A deterministic execution service translates approved intents into actual orders, manages heartbeats, performs cancels/retries, reconciles fills, and isolates trading credentials from the LLM layer.

6. Data and replay plane
Decision logs, fills, market snapshots, and scorecards are stored for replay, analysis, and continuous improvement.

### Design Principles

- The LLM never directly places orders or holds unrestricted trading credentials.
- OpenClaw is the allocator and coordinator, not the raw order entry system.
- Simulation, paper, and production are separate operating modes.
- Multiple sleeves share a common allocator but maintain isolated limits.
- Every decision is logged in an immutable ledger for audit and post-trade review.

## 5. Recommended AWS Architecture

We recommend AWS because the budget is sufficient and the managed services reduce operational risk.

### Core services

- `Amazon ECS Fargate (ARM)` for always-on services.
- `DynamoDB` for current state, scorecards, risk state, and control metadata.
- `S3` for market-data archives, decision ledgers, and replay inputs.
- `CloudWatch` for logs, metrics, and alarms.
- `Secrets Manager` for API keys and wallet-related secrets.
- `EventBridge Scheduler` for nightly replay jobs and reports.

### Always-on services

- `openclaw-control`: Slack-facing control plane and orchestrator.
- `market-state`: data ingestion, book normalization, account state, and strategy input prep.
- `trade-core`: deterministic allocator, risk kernel, and execution service.

### Why Fargate

- Lower operational burden than managing EC2 instances.
- Clean separation between services.
- Easier recovery, deployment, and scaling.
- Good fit for a production-grade system at the current budget.

## 6. Operating Model

### Modes

- `Simulation`: historical replay and forward simulation only.
- `Paper`: live data, no capital at risk.
- `Production`: live capital, fully autonomous within hard limits.

### Strategy sleeves

Initial sleeve:

- `Cross-market consistency`: identifies logically related markets whose prices become inconsistent after accounting for costs and liquidity.

Deferred sleeves:

- `Maker/rebate quoting`
- `Event-driven repricing`
- `Microstructure/short-horizon execution alpha`

### Control model

- The orchestrator allocates capital across sleeves.
- The risk kernel approves or rejects every proposed action.
- The execution service manages order mechanics.
- Slack is the operator interface, not the execution engine.

## 7. Rollout Plan

### Phase 1: Build and simulation

Duration: 4 to 6 weeks

Deliverables:

- Production-grade AWS environment
- Slack-controlled orchestrator
- Deterministic risk and execution services
- Historical and live-data ledger
- Cross-market consistency sleeve in simulation

Exit criteria:

- Stable service uptime
- Correct reconciliation of market/account state
- Successful replay and audit trail

### Phase 2: Paper trading

Duration: 2 to 4 weeks

Deliverables:

- Live market scanning
- Live proposal generation
- Risk gating and execution logic in paper mode
- Daily scorecards for opportunity quality and operational stability

Exit criteria:

- Positive paper-trade expectancy
- No material execution defects
- Strategy calibration and reject logic behaving as expected

### Phase 3: Live R&D launch

Duration: 30 days

Purpose:

- Validate live system behavior with minimal capital at risk.
- Confirm integrations, reconciliation, execution quality, and operator controls.
- Begin collecting real fill, slippage, and decision-quality data.

Capital:

- `$500` maximum deployed bankroll
- Cross-market consistency remains the primary sleeve

Hard pilot limits:

- Max capital at risk per sleeve: `35%` of bankroll
- Max capital at risk per market complex/theme: `20%`
- Daily loss limit: `7.5%` of bankroll
- Weekly drawdown stop: `15%` of bankroll
- Immediate kill switch on stale state, reconciliation mismatch, or execution heartbeat failure

Exit criteria:

- Stable live operations for 30 days
- Correct reconciliation of orders, positions, and balances
- No unresolved control failures
- Evidence that realized edge remains positive after costs

### Phase 4: Early production and bootstrap growth

Capital:

- Increase live bankroll to `$1,000`
- Retain realized profits in bankroll by default
- Expand strategy width gradually through controlled experimentation

Operating posture:

- Small and nimble rather than size-heavy
- Aggressive within hard limits
- Target at least `$200` in average daily profit as a stretch operating goal, not a guaranteed forecast

Hard early-production limits:

- Max capital at risk per sleeve: `35%` of bankroll
- Max capital at risk per market complex/theme: `20%`
- Daily loss limit: `7.5%` of bankroll
- Weekly drawdown stop: `15%` of bankroll

Future scale through retained earnings or additional capital only if the system meets all of the following:

- Positive net P&L after all direct costs
- Max drawdown within approved threshold
- Operational uptime above `99%`
- No unresolved control failures
- Finance and leadership sign-off based on the 30-day live R&D review

## 8. Budget Request

### Monthly AWS infrastructure estimate

This estimate assumes three always-on ARM Fargate services at `0.5 vCPU / 1 GB`, each with a public IPv4 address, plus modest shared-service usage.

| Item | Monthly estimate |
| --- | ---: |
| 3 x always-on ECS Fargate ARM services | `$54.20` |
| DynamoDB on-demand reads/writes and storage | `$8.75` |
| S3 archive storage (100 GB) | `$2.30` |
| CloudWatch log ingestion and storage | `$10.60` |
| Secrets Manager (10 secrets) | `$4.00` |
| CloudWatch alarms and metrics | `$1.70` |
| Contingency for replay jobs, ECR storage, traffic variance | `$18.45` |
| **Modeled monthly AWS run-rate** | **`$100.00`** |

Recommendation: finance should approve a recurring AWS ceiling of `$150/month` to allow for temporary bursts, backfills, and replay jobs without repeated approval cycles.

### Monthly LLM estimate

Recommendation:

- Default to `GPT-5 mini` for routine routing, status generation, and low-stakes classification.
- Use `GPT-5.2` for higher-value orchestration, allocation synthesis, and incident reasoning.
- Use caching and batch processing for overnight reports and low-urgency analysis.

Recommended approval ceiling:

- `OpenAI API budget cap: $250/month`

### Total recurring third-party budget

- Base planned run-rate: approximately `$350/month`
- Recommended approval ceiling: `$400/month`

Note: this proposal excludes internal staff cost. If finance wants a fully loaded investment model, engineering and oversight labor should be added separately.

### Trading capital request

- Initial live R&D bankroll: `$500` for the first 30 days of real-money operation
- Step-up operating bankroll: `$1,000` after successful initial validation
- Reinvestment policy: retain realized profits in trading capital unless leadership or finance directs otherwise
- Additional capital request: deferred until the system demonstrates repeatable net profitability

## 9. ROI Projection

These projections are scenario-based and should be treated as planning assumptions, not promises. We do not yet have live trading results, so the correct way to evaluate this investment is by staged capital deployment with strict go/no-go gates.

### Key ROI assumptions

- Monthly third-party opex is capped at `$400`.
- The first 30 days of live trading use a `$500` bankroll.
- The standard operating bankroll after successful validation is `$1,000`.
- Realized profits are reinvested to grow bankroll and support additional strategy sleeves.
- Daily P&L will be lumpy; the figures below are directional planning cases, not guarantees.

### Early-stage daily profit sensitivity

| Average daily net trading profit | Monthly trading P&L (30 days) | Monthly result after `$400` opex | Simple monthly return on `$1,000` bankroll |
| --- | ---: | ---: | ---: |
| `-$25` | `-$750` | `-$1,150` | `-75%` |
| `$25` | `$750` | `$350` | `75%` |
| `$100` | `$3,000` | `$2,600` | `300%` |
| `$200` stretch target | `$6,000` | `$5,600` | `600%` |

### Interpretation

- The first 30 days are an R&D phase, not a scale phase.
- The business case is intentionally capital-light at the start: limited balance-sheet risk, high learning value.
- At approximately `$14` in average daily net trading profit, the system covers the modeled `$400` monthly third-party opex.
- The `$200` daily target should be treated as an aggressive operating objective that depends on high turnover, repeatable edge, and successful reinvestment of profits.

## 10. Key Risks and Mitigations

| Risk | Severity | Why it matters | Mitigation |
| --- | --- | --- | --- |
| Regulatory and jurisdiction risk | High | Polymarket documentation currently lists the US as restricted. | No live trading until legal confirms an eligible operator and operating entity in a permitted jurisdiction. No VPN or proxy circumvention. |
| Strategy/model risk | High | The system may not have durable edge, especially at the aggressive profit targets contemplated here. | Start with cross-market consistency, use staged rollout, require positive paper results before live, and keep hard drawdown limits. |
| Market and liquidity risk | High | Thin books and correlated markets can produce fast losses. | Enforce concentration caps, per-sleeve limits, and liquidity filters. |
| Operational risk | Medium | Heartbeat failure, stale state, or reconciliation errors can cause unintended exposure. | Deterministic execution service, continuous monitoring, automatic pauses, and kill switches. |
| Security risk | Medium | LLM tooling can expand blast radius if misconfigured. | Keep wallet/order privileges outside OpenClaw, use AWS Secrets Manager, sandbox OpenClaw, and restrict tool surface. |
| Platform dependency risk | Medium | Polymarket APIs, fee rules, or market structure may change. | Versioned adapters, replayable logs, strict monitoring, and rapid rollback. |
| Financial control risk | Medium | Autonomous systems can drift outside mandate if not governed. | Hard mode separation, spend caps, exposure caps, immutable ledgers, and executive review gates. |

## 11. Governance and Controls

The following controls should be mandatory:

- Production access only after legal/compliance approval.
- Separate credentials for simulation, paper, and production.
- Monthly LLM spend cap enforced both in OpenAI and in the local budget guard.
- Daily and weekly loss limits enforced by the deterministic risk kernel.
- Slack commands for `pause`, `resume`, `flatten`, `status`, and `why`.
- Daily finance-facing summary of P&L, exposure, and rejected trades.
- Weekly post-trade review covering strategy performance, model calibration, and execution quality.

## 12. Recommendation

Approve the project with the following conditions:

1. Approve immediate buildout of the production-grade AWS environment and paper-trading stack.
2. Approve a recurring third-party spend ceiling of `$400/month`, split as `$150/month` AWS and `$250/month` OpenAI.
3. Approve a live R&D bankroll of `$500` for the first 30 days of real-money operation only after legal/compliance clearance and successful paper-trading exit criteria.
4. Pre-approve an increase to a `$1,000` operating bankroll if the 30-day live R&D phase validates system stability and positive net edge after costs.
5. Require executive review before any capital increase above the `$1,000` operating bankroll.

This is a disciplined way to buy an option on a potentially attractive automated trading capability while keeping initial spend and capital-at-risk tightly controlled.

## 13. Source Notes

The cost and operating assumptions in this proposal are based on the following current references:

- OpenAI API pricing for `GPT-5.2` and `GPT-5 mini`: [Pricing](https://openai.com/api/pricing/), [Platform pricing reference](https://platform.openai.com/docs/pricing/), [Models reference](https://platform.openai.com/docs/models)
- OpenClaw orchestration and security model: [Sub-agents](https://docs.openclaw.ai/tools/subagents), [Security](https://docs.openclaw.ai/gateway/security), [Multi-agent routing](https://docs.openclaw.ai/multi-agent)
- Polymarket operating constraints and API behavior: [Geographic restrictions](https://docs.polymarket.com/polymarket-learn/FAQ/geoblocking), [Order overview and heartbeat](https://docs.polymarket.com/trading/orders/overview), [API rate limits](https://docs.polymarket.com/quickstart/introduction/rate-limits), [Maker rebates program](https://docs.polymarket.com/developers/market-makers/maker-rebates-program)
- AWS service pricing and documentation: [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/), [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/), [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/), [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/), [Amazon CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), [AWS Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/), [Amazon ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html)
