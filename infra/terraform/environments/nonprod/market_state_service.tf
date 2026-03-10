locals {
  market_state_service_name = "${local.project_name}-nonprod-market-state"
}

resource "aws_security_group" "market_state" {
  name        = "${local.market_state_service_name}-sg"
  description = "Egress-only security group for the nonprod market-state service"
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name = "${local.market_state_service_name}-sg"
  }
}

data "aws_iam_policy_document" "market_state_execution_secret_access" {
  statement {
    sid    = "ReadPolymarketSecretsForContainerInjection"
    effect = "Allow"

    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret"
    ]

    resources = [
      module.platform_foundation.secret_arns["/poly/nonprod/polymarket-user-address"],
      module.platform_foundation.secret_arns["/poly/nonprod/polymarket-funder-address"],
      module.platform_foundation.secret_arns["/poly/nonprod/polymarket-wallet-private-key"],
      module.platform_foundation.secret_arns["/poly/nonprod/polymarket-api-key"],
      module.platform_foundation.secret_arns["/poly/nonprod/polymarket-api-secret"],
      module.platform_foundation.secret_arns["/poly/nonprod/polymarket-api-passphrase"]
    ]
  }
}

resource "aws_iam_role_policy" "market_state_execution_secret_access" {
  name   = "market-state-secrets"
  role   = data.aws_iam_role.ecs_task_execution.id
  policy = data.aws_iam_policy_document.market_state_execution_secret_access.json
}

resource "aws_ecs_task_definition" "market_state" {
  family                   = local.market_state_service_name
  cpu                      = tostring(var.market_state_cpu)
  memory                   = tostring(var.market_state_memory)
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = module.platform_foundation.execution_role_arn
  task_role_arn            = module.platform_foundation.service_task_role_arns["market-state"]

  container_definitions = jsonencode([
    {
      name      = "market-state"
      image     = "${module.platform_foundation.ecr_repository_urls["market-state"]}:${var.market_state_image_tag}"
      essential = true
      command = [
        "pnpm",
        "--filter",
        "@poly/market-state",
        "exec",
        "node",
        "dist/cli.js",
        "loop",
        "--asset-limit",
        tostring(var.market_state_asset_limit),
        "--duration-seconds",
        tostring(var.market_state_loop_duration_seconds),
        "--poll-interval-seconds",
        tostring(var.market_state_account_poll_interval_seconds)
      ]
      environment = [
        { name = "APP_ENV", value = "nonprod" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "RUNTIME_MODE", value = "paper" },
        { name = "STATE_CURRENT_TABLE", value = module.platform_foundation.dynamodb_table_names["current_state"] },
        { name = "STATE_ARCHIVE_BUCKET", value = module.platform_foundation.data_bucket_name },
        { name = "STATE_ARCHIVE_PREFIX", value = "market-state" },
        { name = "POLYMARKET_INCLUDE_RESTRICTED", value = "true" },
        { name = "NODE_OPTIONS", value = "--enable-source-maps" }
      ]
      secrets = [
        {
          name      = "POLY_USER_ADDRESS"
          valueFrom = module.platform_foundation.secret_arns["/poly/nonprod/polymarket-user-address"]
        },
        {
          name      = "POLY_FUNDER_ADDRESS"
          valueFrom = module.platform_foundation.secret_arns["/poly/nonprod/polymarket-funder-address"]
        },
        {
          name      = "POLY_PRIVATE_KEY"
          valueFrom = module.platform_foundation.secret_arns["/poly/nonprod/polymarket-wallet-private-key"]
        },
        {
          name      = "POLY_CLOB_API_KEY"
          valueFrom = module.platform_foundation.secret_arns["/poly/nonprod/polymarket-api-key"]
        },
        {
          name      = "POLY_CLOB_API_SECRET"
          valueFrom = module.platform_foundation.secret_arns["/poly/nonprod/polymarket-api-secret"]
        },
        {
          name      = "POLY_CLOB_API_PASSPHRASE"
          valueFrom = module.platform_foundation.secret_arns["/poly/nonprod/polymarket-api-passphrase"]
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = module.platform_foundation.log_group_names["market-state"]
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])

  depends_on = [aws_iam_role_policy.market_state_execution_secret_access]
}

resource "aws_ecs_service" "market_state" {
  name                   = local.market_state_service_name
  cluster                = module.platform_foundation.ecs_cluster_arn
  task_definition        = aws_ecs_task_definition.market_state.arn
  desired_count          = var.market_state_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = true
  platform_version       = "LATEST"

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.market_state.id]
    assign_public_ip = true
  }
}
