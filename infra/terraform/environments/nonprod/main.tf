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
  region  = var.aws_region
  profile = var.aws_profile
}

locals {
  project_name = "poly-orchestrator"

  service_names = [
    "openclaw-control",
    "market-state",
    "trade-core"
  ]
}

module "platform_foundation" {
  source = "../../modules/platform_foundation"

  project_name       = local.project_name
  environment_name   = "nonprod"
  aws_region         = var.aws_region
  service_names      = toset(local.service_names)
  extra_secret_names = []

  service_secret_names = {
    "openclaw-control" = [
      "/poly/nonprod/openai-api-key",
      "/poly/nonprod/slack-app-token",
      "/poly/nonprod/slack-bot-token"
    ]
    "market-state" = []
    "trade-core"   = []
  }

  tags = {
    Repository = "poly-polymarket-agent"
    Stack      = "poly-nonprod"
  }
}
