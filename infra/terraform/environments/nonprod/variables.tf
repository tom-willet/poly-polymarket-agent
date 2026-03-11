variable "aws_region" {
  description = "AWS region for the nonprod deployment."
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "AWS CLI profile for the nonprod account."
  type        = string
}

variable "openclaw_runtime_allowed_user_ids" {
  description = "Slack user IDs allowed to operate the nonprod runtime."
  type        = list(string)
  default     = []
}

variable "openclaw_runtime_cpu" {
  description = "CPU units for the nonprod openclaw-runtime Fargate task."
  type        = number
  default     = 256
}

variable "openclaw_runtime_memory" {
  description = "Memory in MiB for the nonprod openclaw-runtime Fargate task."
  type        = number
  default     = 512
}

variable "openclaw_runtime_desired_count" {
  description = "Desired task count for the nonprod openclaw-runtime ECS service."
  type        = number
  default     = 1
}

variable "openclaw_runtime_image_tag" {
  description = "ECR image tag to run for the nonprod openclaw-runtime ECS service."
  type        = string
  default     = "latest"
}

variable "openclaw_runtime_report_user_ids" {
  description = "Slack user IDs that should receive scheduled paper scorecards."
  type        = list(string)
  default     = []
}

variable "decision_cycle_schedule_expression" {
  description = "EventBridge Scheduler expression for nonprod decision-cycle runs."
  type        = string
  default     = "rate(5 minutes)"
}

variable "daily_scorecard_schedule_expression" {
  description = "EventBridge Scheduler expression for daily paper scorecards."
  type        = string
  default     = "cron(0 8 * * ? *)"
}

variable "daily_cost_report_email" {
  description = "Email address that should receive the daily nonprod AWS cost report. Leave empty to disable."
  type        = string
  default     = ""
}

variable "daily_cost_report_schedule_expression" {
  description = "EventBridge Scheduler expression for daily AWS cost report emails."
  type        = string
  default     = "cron(0 7 * * ? *)"
}

variable "daily_health_report_schedule_expression" {
  description = "EventBridge Scheduler expression for daily AWS health report emails."
  type        = string
  default     = "cron(15 7 * * ? *)"
}

variable "scheduler_timezone" {
  description = "Timezone used for calendar-based nonprod schedules."
  type        = string
  default     = "America/Denver"
}

variable "execution_worker_cpu" {
  description = "CPU units for the nonprod execution-worker Fargate task."
  type        = number
  default     = 256
}

variable "execution_worker_memory" {
  description = "Memory in MiB for the nonprod execution-worker Fargate task."
  type        = number
  default     = 512
}

variable "execution_worker_desired_count" {
  description = "Desired task count for the nonprod execution-worker ECS service."
  type        = number
  default     = 1
}

variable "execution_worker_image_tag" {
  description = "ECR image tag to run for the nonprod execution-worker ECS service."
  type        = string
  default     = "latest"
}

variable "execution_worker_paper_starting_cash_usd" {
  description = "Starting virtual bankroll for the nonprod paper broker."
  type        = number
  default     = 500
}

variable "market_state_cpu" {
  description = "CPU units for the nonprod market-state Fargate task."
  type        = number
  default     = 256
}

variable "market_state_memory" {
  description = "Memory in MiB for the nonprod market-state Fargate task."
  type        = number
  default     = 512
}

variable "market_state_desired_count" {
  description = "Desired task count for the nonprod market-state ECS service."
  type        = number
  default     = 1
}

variable "market_state_image_tag" {
  description = "ECR image tag to run for the nonprod market-state ECS service."
  type        = string
  default     = "latest"
}

variable "market_state_asset_limit" {
  description = "Maximum number of Polymarket contracts to track in the nonprod market-state stream."
  type        = number
  default     = 200
}

variable "market_state_loop_duration_seconds" {
  description = "Seconds per nonprod market-state stream window before refreshing the universe."
  type        = number
  default     = 60
}

variable "market_state_account_poll_interval_seconds" {
  description = "Seconds between authenticated account polls in the nonprod market-state loop."
  type        = number
  default     = 15
}
