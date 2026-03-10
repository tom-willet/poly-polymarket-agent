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
