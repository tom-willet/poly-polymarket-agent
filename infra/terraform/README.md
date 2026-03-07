# Terraform Foundation

This Terraform layout implements the `M0 Foundations` baseline from the v1 spec pack.

## Scope

- One AWS foundation per environment: `nonprod` and `prod`
- ECS cluster for always-on services
- ECR repositories for `openclaw-control`, `market-state`, and `trade-core`
- CloudWatch log groups for each service
- Secrets Manager secret placeholders
- ECS task execution role plus per-service task roles
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
../../../../scripts/infra/bootstrap_tf_backend.sh mullet-dev poly-orchestrator-tfstate-418295697992
terraform init -backend-config=backend.hcl.example
terraform plan
```

Example for prod:

```bash
cd infra/terraform/environments/prod
cp terraform.tfvars.example terraform.tfvars
../../../../scripts/infra/bootstrap_tf_backend.sh mullet-prod poly-orchestrator-tfstate-183295425682
terraform init -backend-config=backend.hcl.example
terraform plan
```

## Notes

- This layout uses the AWS CLI profile configured in each environment's `terraform.tfvars` and backend config.
- The intended workflow uses the remote S3 backend templates committed under each environment root.
- The repo includes a bootstrap script for the current `mullet-dev` and `mullet-prod` accounts.
- Secret resources are created as empty placeholders; populate values in Secrets Manager after apply.
- `trade-core` is the only service granted prod Polymarket secret access in this scaffold.
