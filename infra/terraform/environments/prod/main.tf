terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region              = var.aws_region
  profile             = var.aws_profile
  allowed_account_ids = [var.expected_aws_account_id]
}

locals {
  project_name = "poly-orchestrator"

  service_names = [
    "openclaw-control",
    "openclaw-runtime",
    "market-state",
    "trade-core",
    "execution-worker"
  ]
}

module "platform_foundation" {
  source = "../../modules/platform_foundation"

  project_name     = local.project_name
  environment_name = "prod"
  aws_region       = var.aws_region
  service_names    = toset(local.service_names)

  service_secret_names = {
    "openclaw-control" = [
      "/poly/prod/openai-api-key"
    ]
    "openclaw-runtime" = [
      "/poly/prod/slack-app-token",
      "/poly/prod/slack-bot-token"
    ]
    "market-state" = []
    "trade-core" = [
      "/poly/prod/polymarket-wallet-private-key",
      "/poly/prod/polymarket-api-credentials",
      "/poly/prod/polymarket-builder-key"
    ]
    "execution-worker" = []
  }

  service_dynamodb_table_access = {
    "openclaw-control" = ["current_state", "decision_ledger"]
    "openclaw-runtime" = ["current_state", "decision_ledger"]
    "market-state"     = ["current_state"]
    "trade-core"       = ["current_state"]
    "execution-worker" = ["current_state", "decision_ledger"]
  }

  service_data_bucket_access = toset(["market-state"])

  tags = {
    Repository = "poly-polymarket-agent"
    Stack      = "poly-prod"
  }
}
