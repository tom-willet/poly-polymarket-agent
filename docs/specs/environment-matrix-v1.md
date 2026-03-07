# Environment Matrix v1

Date: March 6, 2026

Status: Frozen for v1 implementation

## 1. Purpose

Define how environments are separated for infrastructure, credentials, operators, and bankroll.

## 2. Environment Strategy

v1 uses three runtime environments:

- `sim`
- `paper`
- `prod`

Design rule:

- A mistake in one environment must not silently affect another environment.

## 3. Separation Model

### AWS

Recommended account structure:

- `poly-nonprod`: `sim` and `paper`
- `poly-prod`: `prod`

Reason:

- Production should have separate IAM, secrets, and blast radius even if the team is small.

### Slack

Recommended app structure:

- `Poly Orchestrator Nonprod`
- `Poly Orchestrator Prod`

Reason:

- Prevent accidental production commands during testing.

### OpenAI

Recommended project structure:

- One project for nonprod
- One project for prod

Reason:

- Separate spend controls and simpler attribution.

### Polymarket

Wallet and credential model:

- `sim`: synthetic wallets only
- `paper`: no live trading credentials required for order placement
- `prod`: one primary live wallet in bootstrap phase, with virtual sleeve accounting

Decision:

- Do not create one live wallet per sleeve in v1 bootstrap production.
- Add separate live wallets later only if bankroll size or strategy diversity justifies the added complexity.

## 4. Matrix

| Dimension | `sim` | `paper` | `prod` |
| --- | --- | --- | --- |
| Purpose | Replay and research | Live dry run | Live autonomous trading |
| AWS account | `poly-nonprod` | `poly-nonprod` | `poly-prod` |
| ECS services | Optional scheduled jobs | Always-on | Always-on |
| Slack app | Nonprod | Nonprod | Prod |
| OpenAI project | Nonprod | Nonprod | Prod |
| Polymarket write access | No | No | Yes, when enabled |
| Bankroll | Synthetic | Shadow `$1,000` | `$500` then `$1,000` |
| Trading enabled | No | No | Yes, only after release gate |
| Primary operator commands | Research | Validation | Operations |

## 5. Required Secrets

### Nonprod

- `OPENAI_API_KEY_NONPROD`
- `SLACK_APP_TOKEN_NONPROD`
- `SLACK_BOT_TOKEN_NONPROD`

### Prod

- `OPENAI_API_KEY_PROD`
- `SLACK_APP_TOKEN_PROD`
- `SLACK_BOT_TOKEN_PROD`
- `POLYMARKET_WALLET_PRIVATE_KEY_PROD`
- `POLYMARKET_API_CREDENTIALS_PROD`
- `POLYMARKET_BUILDER_KEY_PROD` if required by the selected integration path

Rule:

- Production secrets must never be accessible from nonprod tasks.

## 6. Release Gate for `prod`

`prod` may only be enabled when all of the following are true:

1. Compliance approval is recorded.
2. Production secrets are present only in the prod account.
3. The prod Slack app is installed and tested.
4. Risk policy version is pinned.
5. Trading enablement flag is set by authorized operator action.

## 7. Configuration Rules

- Environment name must be explicit in every service.
- Default startup mode is `paper`, never `prod`.
- `TRADING_ENABLED=false` by default.
- Production deploys must require an explicit release action.

## 8. Bootstrap Decision

For the first live phase, the system should optimize for safety and speed of learning:

- one live wallet
- one live strategy family
- at most two live sleeves
- one prod cluster

The architecture still supports future expansion without requiring a redesign.

## 9. Related Specs

- [system-spec-v1.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/docs/specs/system-spec-v1.md)
- [risk-policy-v1.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/docs/specs/risk-policy-v1.md)
- [service-contracts-v1.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/docs/specs/service-contracts-v1.md)
