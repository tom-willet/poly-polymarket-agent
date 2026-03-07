variable "aws_region" {
  description = "AWS region for the nonprod deployment."
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "AWS CLI profile for the nonprod account."
  type        = string
}
