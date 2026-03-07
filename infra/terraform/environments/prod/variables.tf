variable "aws_region" {
  description = "AWS region for the prod deployment."
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "AWS CLI profile for the prod account."
  type        = string
}
