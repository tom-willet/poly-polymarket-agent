variable "aws_region" {
  description = "AWS region for the prod deployment."
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "AWS CLI profile for the prod account."
  type        = string
}

variable "expected_aws_account_id" {
  description = "AWS account ID that prod Terraform is allowed to target."
  type        = string

  validation {
    condition     = can(regex("^\\d{12}$", var.expected_aws_account_id))
    error_message = "expected_aws_account_id must be a 12-digit AWS account ID."
  }
}
