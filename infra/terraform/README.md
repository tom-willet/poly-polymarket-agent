# Terraform Foundation

This Terraform layout implements the `M0 Foundations` baseline from the v1 spec pack.

## Scope

- One AWS foundation per environment: `nonprod` and `prod`
- ECS cluster for always-on services
- ECR repositories for `openclaw-control`, `openclaw-runtime`, `market-state`, `trade-core`, and `execution-worker`
- CloudWatch log groups for each service
- Secrets Manager secret placeholders
- ECS task execution role plus per-service task roles
- Per-service DynamoDB and S3 data-plane access policies
- Shared S3 data bucket
- Base DynamoDB tables for current state, decision ledger, and idempotency keys

## Layout

- `modules/platform_foundation`: reusable AWS foundation module
- `environments/nonprod`: `poly-nonprod` root config
- `environments/prod`: `poly-prod` root config

## Usage

Example for nonprod:

```bash
cd infra/terraform/environments/nonprod
cp terraform.tfvars.example terraform.tfvars
../../../../scripts/infra/bootstrap_tf_backend.sh willy-nilly-dev poly-orchestrator-tfstate-174444915162
terraform init -reconfigure -backend-config=backend.hcl.example
terraform plan
```

Example for prod:

```bash
cd infra/terraform/environments/prod
cp terraform.tfvars.example terraform.tfvars
../../../../scripts/infra/bootstrap_tf_backend.sh willy-nilly-prod poly-orchestrator-tfstate-495026847132
terraform init -reconfigure -backend-config=backend.hcl.example
terraform plan
```

## Notes

- This layout uses the AWS CLI profile configured in each environment's `terraform.tfvars` and backend config.
- The intended workflow uses the remote S3 backend templates committed under each environment root.
- Each environment now sets `expected_aws_account_id` in `terraform.tfvars`, and the AWS provider will refuse to plan/apply/destroy if the active account does not match.
- The backend examples now also include `allowed_account_ids`; after editing the account numbers, rerun `terraform init -reconfigure -backend-config=backend.hcl.example` so the backend enforces the same guard.
- The repo includes a bootstrap script for the current `mullet-dev` and `mullet-prod` accounts.
- Secret resources are created as empty placeholders; populate values in Secrets Manager after apply.
- `openclaw-runtime` is the service intended to read Slack secrets in this scaffold.
- `trade-core` is the only service granted prod Polymarket secret access in this scaffold.
- `market-state` now has scoped access to the shared current-state table and data bucket in both environments.
- `execution-worker` now has scoped access to current-state and decision-ledger in both environments.
- nonprod now defines dedicated ECS services for `market-state`, `openclaw-runtime`, and `execution-worker`.
- nonprod `market-state` runs the continuous `loop` entrypoint with default-VPC networking, Secrets Manager injection for authenticated Polymarket polling, and tunable asset/account polling windows via Terraform variables.
- nonprod `openclaw-runtime` uses default-VPC networking and Secrets Manager injection for Slack Socket Mode tokens.
- nonprod now also defines EventBridge Scheduler jobs for `openclaw-runtime`:
  - a decision-cycle task every 5 minutes
  - a daily paper-scorecard task at 8:00 AM America/Denver
- the companion image-push helper for the new nonprod `market-state` service lives at `scripts/deploy/deploy_market_state_nonprod.sh`.
- nonprod can optionally send a daily AWS account cost email by setting `daily_cost_report_email`; this provisions a small Lambda, SNS email subscription, and an EventBridge Scheduler job that defaults to 7:00 AM America/Denver.
- the same observation email path also provisions a daily runtime-health digest at 7:15 AM America/Denver covering ECS service state, current-state health rows, and the latest decision-cycle summary.
- the email report is account-level because project-level cost allocation tags are not configured yet.
