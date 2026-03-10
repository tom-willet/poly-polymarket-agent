locals {
  control_schedule_group_name = "${local.project_name}-nonprod-control-jobs"
}

resource "aws_scheduler_schedule_group" "control_jobs" {
  name = local.control_schedule_group_name
}

data "aws_iam_policy_document" "control_jobs_scheduler_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "control_jobs_scheduler" {
  name               = "${local.control_schedule_group_name}-role"
  assume_role_policy = data.aws_iam_policy_document.control_jobs_scheduler_assume_role.json
}

data "aws_iam_policy_document" "control_jobs_scheduler" {
  statement {
    sid    = "RunOpenClawRuntimeTasks"
    effect = "Allow"

    actions = ["ecs:RunTask"]

    resources = [
      aws_ecs_task_definition.openclaw_runtime.arn
    ]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [module.platform_foundation.ecs_cluster_arn]
    }
  }

  statement {
    sid    = "PassRuntimeRoles"
    effect = "Allow"

    actions = ["iam:PassRole"]

    resources = [
      module.platform_foundation.execution_role_arn,
      module.platform_foundation.service_task_role_arns["openclaw-runtime"]
    ]
  }
}

resource "aws_iam_role_policy" "control_jobs_scheduler" {
  name   = "control-jobs-scheduler"
  role   = aws_iam_role.control_jobs_scheduler.id
  policy = data.aws_iam_policy_document.control_jobs_scheduler.json
}

resource "aws_scheduler_schedule" "decision_cycle" {
  name                = "${local.project_name}-nonprod-decision-cycle"
  group_name          = aws_scheduler_schedule_group.control_jobs.name
  state               = "ENABLED"
  schedule_expression = var.decision_cycle_schedule_expression

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = module.platform_foundation.ecs_cluster_arn
    role_arn = aws_iam_role.control_jobs_scheduler.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.openclaw_runtime.arn
      launch_type         = "FARGATE"
      platform_version    = "LATEST"
      task_count          = 1

      network_configuration {
        subnets          = data.aws_subnets.default.ids
        security_groups  = [aws_security_group.openclaw_runtime.id]
        assign_public_ip = true
      }
    }

    input = jsonencode({
      containerOverrides = [
        {
          name    = "openclaw-runtime",
          command = ["pnpm", "--filter", "@poly/openclaw-runtime", "exec", "node", "dist/cli.js", "cycle"]
        }
      ]
    })
  }
}

resource "aws_scheduler_schedule" "daily_scorecard" {
  name                         = "${local.project_name}-nonprod-daily-scorecard"
  group_name                   = aws_scheduler_schedule_group.control_jobs.name
  state                        = "ENABLED"
  schedule_expression          = var.daily_scorecard_schedule_expression
  schedule_expression_timezone = var.scheduler_timezone

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = module.platform_foundation.ecs_cluster_arn
    role_arn = aws_iam_role.control_jobs_scheduler.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.openclaw_runtime.arn
      launch_type         = "FARGATE"
      platform_version    = "LATEST"
      task_count          = 1

      network_configuration {
        subnets          = data.aws_subnets.default.ids
        security_groups  = [aws_security_group.openclaw_runtime.id]
        assign_public_ip = true
      }
    }

    input = jsonencode({
      containerOverrides = [
        {
          name    = "openclaw-runtime",
          command = ["pnpm", "--filter", "@poly/openclaw-runtime", "exec", "node", "dist/cli.js", "scorecard", "--post"]
        }
      ]
    })
  }
}
