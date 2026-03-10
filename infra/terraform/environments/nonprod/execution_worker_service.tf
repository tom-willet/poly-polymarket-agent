locals {
  execution_worker_service_name = "${local.project_name}-nonprod-execution-worker"
}

resource "aws_security_group" "execution_worker" {
  name        = "${local.execution_worker_service_name}-sg"
  description = "Egress-only security group for the nonprod execution worker"
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name = "${local.execution_worker_service_name}-sg"
  }
}

resource "aws_ecs_task_definition" "execution_worker" {
  family                   = local.execution_worker_service_name
  cpu                      = tostring(var.execution_worker_cpu)
  memory                   = tostring(var.execution_worker_memory)
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = module.platform_foundation.execution_role_arn
  task_role_arn            = module.platform_foundation.service_task_role_arns["execution-worker"]

  container_definitions = jsonencode([
    {
      name      = "execution-worker"
      image     = "${module.platform_foundation.ecr_repository_urls["execution-worker"]}:${var.execution_worker_image_tag}"
      essential = true
      environment = [
        { name = "APP_ENV", value = "nonprod" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "RUNTIME_MODE", value = "paper" },
        { name = "STATE_CURRENT_TABLE", value = module.platform_foundation.dynamodb_table_names["current_state"] },
        { name = "DECISION_LEDGER_TABLE", value = module.platform_foundation.dynamodb_table_names["decision_ledger"] },
        { name = "EXECUTION_WORKER_POLL_INTERVAL_MS", value = "5000" },
        { name = "EXECUTION_WORKER_MAX_INTENTS", value = "25" },
        { name = "PAPER_STARTING_CASH_USD", value = tostring(var.execution_worker_paper_starting_cash_usd) },
        { name = "NODE_OPTIONS", value = "--enable-source-maps" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = module.platform_foundation.log_group_names["execution-worker"]
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "execution_worker" {
  name                   = local.execution_worker_service_name
  cluster                = module.platform_foundation.ecs_cluster_arn
  task_definition        = aws_ecs_task_definition.execution_worker.arn
  desired_count          = var.execution_worker_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = true
  platform_version       = "LATEST"

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.execution_worker.id]
    assign_public_ip = true
  }
}
