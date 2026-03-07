variable "project_name" {
  description = "Short project identifier used in resource naming."
  type        = string
}

variable "environment_name" {
  description = "Deployment environment name, such as nonprod or prod."
  type        = string
}

variable "aws_region" {
  description = "AWS region for the deployment."
  type        = string
}

variable "service_names" {
  description = "Logical service names that need ECR, logging, and task roles."
  type        = set(string)
}

variable "service_secret_names" {
  description = "Map of service name to secret names that the service may read."
  type        = map(list(string))
  default     = {}
}

variable "extra_secret_names" {
  description = "Additional secret names to create that are not attached to a service role."
  type        = set(string)
  default     = []
}

variable "create_data_bucket" {
  description = "Whether to create the shared S3 data bucket."
  type        = bool
  default     = true
}

variable "dynamodb_tables" {
  description = "Base DynamoDB tables to create for the environment."
  type = map(object({
    hash_key      = string
    range_key     = optional(string)
    ttl_attribute = optional(string)
    point_in_time = optional(bool, true)
    billing_mode  = optional(string, "PAY_PER_REQUEST")
  }))
  default = {
    current_state = {
      hash_key      = "pk"
      range_key     = "sk"
      ttl_attribute = "ttl"
    }
    decision_ledger = {
      hash_key      = "pk"
      range_key     = "sk"
      ttl_attribute = "ttl"
    }
    idempotency_keys = {
      hash_key      = "pk"
      ttl_attribute = "ttl"
    }
  }
}

variable "tags" {
  description = "Common tags applied to all managed resources."
  type        = map(string)
  default     = {}
}
