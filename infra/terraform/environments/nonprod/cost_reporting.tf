locals {
  daily_cost_report_enabled       = trimspace(var.daily_cost_report_email) != ""
  daily_cost_report_name          = "${local.project_name}-nonprod-daily-cost-report"
  observation_schedule_group_name = "${local.project_name}-nonprod-observation-jobs"
}

data "aws_caller_identity" "current" {}

data "archive_file" "daily_cost_report_lambda" {
  count = local.daily_cost_report_enabled ? 1 : 0

  type        = "zip"
  source_file = "${path.module}/lambda/daily_cost_report.py"
  output_path = "${path.module}/.terraform/daily_cost_report.zip"
}

resource "aws_sns_topic" "daily_cost_report" {
  count = local.daily_cost_report_enabled ? 1 : 0

  name = local.daily_cost_report_name
}

resource "aws_sns_topic_subscription" "daily_cost_report_email" {
  count = local.daily_cost_report_enabled ? 1 : 0

  topic_arn = aws_sns_topic.daily_cost_report[0].arn
  protocol  = "email"
  endpoint  = var.daily_cost_report_email
}

resource "aws_cloudwatch_log_group" "daily_cost_report" {
  count = local.daily_cost_report_enabled ? 1 : 0

  name              = "/aws/lambda/${local.daily_cost_report_name}"
  retention_in_days = 30

  tags = {
    Name = local.daily_cost_report_name
  }
}

data "aws_iam_policy_document" "daily_cost_report_assume_role" {
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

resource "aws_iam_role" "daily_cost_report" {
  count = local.daily_cost_report_enabled ? 1 : 0

  name               = "${local.daily_cost_report_name}-role"
  assume_role_policy = data.aws_iam_policy_document.daily_cost_report_assume_role[0].json
}

data "aws_iam_policy_document" "daily_cost_report" {
  count = local.daily_cost_report_enabled ? 1 : 0

  statement {
    sid    = "WriteCloudWatchLogs"
    effect = "Allow"

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]

    resources = [
      "${aws_cloudwatch_log_group.daily_cost_report[0].arn}:*"
    ]
  }

  statement {
    sid    = "ReadCostExplorer"
    effect = "Allow"

    actions = [
      "ce:GetCostAndUsage",
      "ce:GetCostForecast"
    ]

    resources = ["*"]
  }

  statement {
    sid    = "PublishCostReportEmail"
    effect = "Allow"

    actions = ["sns:Publish"]

    resources = [aws_sns_topic.daily_cost_report[0].arn]
  }
}

resource "aws_iam_role_policy" "daily_cost_report" {
  count = local.daily_cost_report_enabled ? 1 : 0

  name   = "daily-cost-report"
  role   = aws_iam_role.daily_cost_report[0].id
  policy = data.aws_iam_policy_document.daily_cost_report[0].json
}

resource "aws_lambda_function" "daily_cost_report" {
  count = local.daily_cost_report_enabled ? 1 : 0

  function_name    = local.daily_cost_report_name
  role             = aws_iam_role.daily_cost_report[0].arn
  filename         = data.archive_file.daily_cost_report_lambda[0].output_path
  source_code_hash = data.archive_file.daily_cost_report_lambda[0].output_base64sha256
  runtime          = "python3.11"
  handler          = "daily_cost_report.handler"
  timeout          = 30

  environment {
    variables = {
      ACCOUNT_ID           = data.aws_caller_identity.current.account_id
      COST_EXPLORER_REGION = "us-east-1"
      ENVIRONMENT_NAME     = "nonprod"
      PROJECT_NAME         = local.project_name
      SNS_TOPIC_ARN        = aws_sns_topic.daily_cost_report[0].arn
    }
  }

  depends_on = [aws_cloudwatch_log_group.daily_cost_report]
}

resource "aws_scheduler_schedule_group" "observation_jobs" {
  count = local.daily_cost_report_enabled ? 1 : 0

  name = local.observation_schedule_group_name
}

data "aws_iam_policy_document" "observation_jobs_scheduler_assume_role" {
  count = local.daily_cost_report_enabled ? 1 : 0

  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "observation_jobs_scheduler" {
  count = local.daily_cost_report_enabled ? 1 : 0

  name               = "${local.observation_schedule_group_name}-role"
  assume_role_policy = data.aws_iam_policy_document.observation_jobs_scheduler_assume_role[0].json
}

data "aws_iam_policy_document" "observation_jobs_scheduler" {
  count = local.daily_cost_report_enabled ? 1 : 0

  statement {
    sid    = "InvokeDailyCostLambda"
    effect = "Allow"

    actions = ["lambda:InvokeFunction"]

    resources = [aws_lambda_function.daily_cost_report[0].arn]
  }
}

resource "aws_iam_role_policy" "observation_jobs_scheduler" {
  count = local.daily_cost_report_enabled ? 1 : 0

  name   = "observation-jobs-scheduler"
  role   = aws_iam_role.observation_jobs_scheduler[0].id
  policy = data.aws_iam_policy_document.observation_jobs_scheduler[0].json
}

resource "aws_scheduler_schedule" "daily_cost_report" {
  count = local.daily_cost_report_enabled ? 1 : 0

  name                         = local.daily_cost_report_name
  group_name                   = aws_scheduler_schedule_group.observation_jobs[0].name
  state                        = "ENABLED"
  schedule_expression          = var.daily_cost_report_schedule_expression
  schedule_expression_timezone = var.scheduler_timezone

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.daily_cost_report[0].arn
    role_arn = aws_iam_role.observation_jobs_scheduler[0].arn

    input = jsonencode({
      report = "daily-account-cost"
    })
  }
}
