data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_iam_role" "ecs_task_execution" {
  name = split("/", module.platform_foundation.execution_role_arn)[1]
}

locals {
  openclaw_runtime_service_name = "${local.project_name}-nonprod-openclaw-runtime"
}

resource "aws_security_group" "openclaw_runtime" {
  name        = "${local.openclaw_runtime_service_name}-sg"
  description = "Egress-only security group for the nonprod Slack runtime"
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name = "${local.openclaw_runtime_service_name}-sg"
  }
}

data "aws_iam_policy_document" "openclaw_runtime_execution_secret_access" {
  statement {
    sid    = "ReadSlackSecretsForContainerInjection"
    effect = "Allow"

    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret"
    ]

    resources = [
      module.platform_foundation.secret_arns["/poly/nonprod/slack-app-token"],
      module.platform_foundation.secret_arns["/poly/nonprod/slack-bot-token"]
    ]
  }
}

resource "aws_iam_role_policy" "openclaw_runtime_execution_secret_access" {
  name   = "openclaw-runtime-secrets"
  role   = data.aws_iam_role.ecs_task_execution.id
  policy = data.aws_iam_policy_document.openclaw_runtime_execution_secret_access.json
}

resource "aws_ecs_task_definition" "openclaw_runtime" {
  family                   = local.openclaw_runtime_service_name
  cpu                      = tostring(var.openclaw_runtime_cpu)
  memory                   = tostring(var.openclaw_runtime_memory)
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = module.platform_foundation.execution_role_arn
  task_role_arn            = module.platform_foundation.service_task_role_arns["openclaw-runtime"]

  container_definitions = jsonencode([
    {
      name      = "openclaw-runtime"
      image     = "${module.platform_foundation.ecr_repository_urls["openclaw-runtime"]}:${var.openclaw_runtime_image_tag}"
      essential = true
      environment = [
        { name = "APP_ENV", value = "nonprod" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "RUNTIME_MODE", value = "paper" },
        { name = "STATE_CURRENT_TABLE", value = module.platform_foundation.dynamodb_table_names["current_state"] },
        { name = "DECISION_LEDGER_TABLE", value = module.platform_foundation.dynamodb_table_names["decision_ledger"] },
        { name = "SLACK_ALLOWED_USER_IDS", value = join(",", var.openclaw_runtime_allowed_user_ids) },
        { name = "NODE_OPTIONS", value = "--enable-source-maps" }
      ]
      secrets = [
        {
          name      = "SLACK_APP_TOKEN"
          valueFrom = module.platform_foundation.secret_arns["/poly/nonprod/slack-app-token"]
        },
        {
          name      = "SLACK_BOT_TOKEN"
          valueFrom = module.platform_foundation.secret_arns["/poly/nonprod/slack-bot-token"]
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = module.platform_foundation.log_group_names["openclaw-runtime"]
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])

  depends_on = [aws_iam_role_policy.openclaw_runtime_execution_secret_access]
}

resource "aws_ecs_service" "openclaw_runtime" {
  name                   = local.openclaw_runtime_service_name
  cluster                = module.platform_foundation.ecs_cluster_arn
  task_definition        = aws_ecs_task_definition.openclaw_runtime.arn
  desired_count          = var.openclaw_runtime_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = true
  platform_version       = "LATEST"

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.openclaw_runtime.id]
    assign_public_ip = true
  }
}
