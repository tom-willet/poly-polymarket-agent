locals {
  daily_health_report_name = "${local.project_name}-nonprod-daily-health-report"
}

data "archive_file" "daily_health_report_lambda" {
  count = local.daily_cost_report_enabled ? 1 : 0

  type        = "zip"
  source_file = "${path.module}/lambda/daily_health_report.py"
  output_path = "${path.module}/.terraform/daily_health_report.zip"
}

resource "aws_cloudwatch_log_group" "daily_health_report" {
  count = local.daily_cost_report_enabled ? 1 : 0

  name              = "/aws/lambda/${local.daily_health_report_name}"
  retention_in_days = 30

  tags = {
    Name = local.daily_health_report_name
  }
}

data "aws_iam_policy_document" "daily_health_report_assume_role" {
  count = local.daily_cost_report_enabled ? 1 : 0

  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "daily_health_report" {
  count = local.daily_cost_report_enabled ? 1 : 0

  name               = "${local.daily_health_report_name}-role"
  assume_role_policy = data.aws_iam_policy_document.daily_health_report_assume_role[0].json
}

data "aws_iam_policy_document" "daily_health_report" {
  count = local.daily_cost_report_enabled ? 1 : 0

  statement {
    sid    = "WriteCloudWatchLogs"
    effect = "Allow"

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]

    resources = [
      "${aws_cloudwatch_log_group.daily_health_report[0].arn}:*"
    ]
  }

  statement {
    sid    = "ReadCurrentState"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:Scan"
    ]

    resources = [
      "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${module.platform_foundation.dynamodb_table_names["current_state"]}"
    ]
  }

  statement {
    sid    = "ReadDecisionLedger"
    effect = "Allow"

    actions = [
      "dynamodb:Scan"
    ]

    resources = [
      "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${module.platform_foundation.dynamodb_table_names["decision_ledger"]}"
    ]
  }

  statement {
    sid    = "DescribeObservationServices"
    effect = "Allow"

    actions = ["ecs:DescribeServices"]

    resources = ["*"]
  }

  statement {
    sid    = "PublishHealthReportEmail"
    effect = "Allow"

    actions = ["sns:Publish"]

    resources = [aws_sns_topic.daily_cost_report[0].arn]
  }
}

resource "aws_iam_role_policy" "daily_health_report" {
  count = local.daily_cost_report_enabled ? 1 : 0

  name   = "daily-health-report"
  role   = aws_iam_role.daily_health_report[0].id
  policy = data.aws_iam_policy_document.daily_health_report[0].json
}

resource "aws_lambda_function" "daily_health_report" {
  count = local.daily_cost_report_enabled ? 1 : 0

  function_name    = local.daily_health_report_name
  role             = aws_iam_role.daily_health_report[0].arn
  filename         = data.archive_file.daily_health_report_lambda[0].output_path
  source_code_hash = data.archive_file.daily_health_report_lambda[0].output_base64sha256
  runtime          = "python3.11"
  handler          = "daily_health_report.handler"
  timeout          = 30

  environment {
    variables = {
      CURRENT_STATE_TABLE   = module.platform_foundation.dynamodb_table_names["current_state"]
      DECISION_LEDGER_TABLE = module.platform_foundation.dynamodb_table_names["decision_ledger"]
      ECS_CLUSTER_NAME      = module.platform_foundation.ecs_cluster_name
      ENVIRONMENT_NAME      = "nonprod"
      PROJECT_NAME          = local.project_name
      SERVICE_NAMES = join(",", [
        aws_ecs_service.market_state.name,
        aws_ecs_service.openclaw_runtime.name,
        aws_ecs_service.execution_worker.name
      ])
      SNS_TOPIC_ARN = aws_sns_topic.daily_cost_report[0].arn
    }
  }

  depends_on = [aws_cloudwatch_log_group.daily_health_report]
}

data "aws_iam_policy_document" "observation_jobs_scheduler_health" {
  count = local.daily_cost_report_enabled ? 1 : 0

  statement {
    sid    = "InvokeDailyHealthLambda"
    effect = "Allow"

    actions = ["lambda:InvokeFunction"]

    resources = [aws_lambda_function.daily_health_report[0].arn]
  }
}

resource "aws_iam_role" "observation_jobs_scheduler_health" {
  count = local.daily_cost_report_enabled ? 1 : 0

  name               = "${local.daily_health_report_name}-scheduler-role"
  assume_role_policy = data.aws_iam_policy_document.observation_jobs_scheduler_assume_role[0].json
}

resource "aws_iam_role_policy" "observation_jobs_scheduler_health" {
  count = local.daily_cost_report_enabled ? 1 : 0

  name   = "observation-health-scheduler"
  role   = aws_iam_role.observation_jobs_scheduler_health[0].id
  policy = data.aws_iam_policy_document.observation_jobs_scheduler_health[0].json
}

resource "aws_scheduler_schedule" "daily_health_report" {
  count = local.daily_cost_report_enabled ? 1 : 0

  name                         = local.daily_health_report_name
  group_name                   = aws_scheduler_schedule_group.observation_jobs[0].name
  state                        = "ENABLED"
  schedule_expression          = var.daily_health_report_schedule_expression
  schedule_expression_timezone = var.scheduler_timezone

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.daily_health_report[0].arn
    role_arn = aws_iam_role.observation_jobs_scheduler_health[0].arn

    input = jsonencode({
      report = "daily-runtime-health"
    })
  }
}
