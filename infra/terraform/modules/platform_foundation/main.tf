terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  common_tags = merge(var.tags, {
    Project     = var.project_name
    Environment = var.environment_name
    ManagedBy   = "terraform"
  })

  service_secret_names = {
    for service in var.service_names :
    service => distinct(lookup(var.service_secret_names, service, []))
  }

  all_secret_names = toset(concat(
    tolist(var.extra_secret_names),
    flatten(values(local.service_secret_names))
  ))

  services_with_secret_access = {
    for service, secret_names in local.service_secret_names :
    service => secret_names
    if length(secret_names) > 0
  }
}

resource "aws_ecs_cluster" "this" {
  name = "${var.project_name}-${var.environment_name}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.common_tags
}

resource "aws_ecr_repository" "service" {
  for_each = var.service_names

  name                 = "${var.project_name}/${var.environment_name}/${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = merge(local.common_tags, {
    Service = each.key
  })
}

resource "aws_cloudwatch_log_group" "service" {
  for_each = var.service_names

  name              = "/ecs/${var.project_name}/${var.environment_name}/${each.key}"
  retention_in_days = 30

  tags = merge(local.common_tags, {
    Service = each.key
  })
}

resource "aws_secretsmanager_secret" "managed" {
  for_each = local.all_secret_names

  name                    = each.value
  recovery_window_in_days = 7

  tags = local.common_tags
}

data "aws_iam_policy_document" "ecs_task_execution_assume" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${var.project_name}-${var.environment_name}-ecs-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_execution_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "service_task" {
  for_each = var.service_names

  name               = "${var.project_name}-${var.environment_name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_execution_assume.json

  tags = merge(local.common_tags, {
    Service = each.key
  })
}

data "aws_iam_policy_document" "service_secret_access" {
  for_each = local.services_with_secret_access

  statement {
    sid    = "ReadApprovedSecrets"
    effect = "Allow"

    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue"
    ]

    resources = [
      for secret_name in each.value :
      aws_secretsmanager_secret.managed[secret_name].arn
    ]
  }
}

resource "aws_iam_role_policy" "service_secret_access" {
  for_each = local.services_with_secret_access

  name   = "secret-access"
  role   = aws_iam_role.service_task[each.key].id
  policy = data.aws_iam_policy_document.service_secret_access[each.key].json
}

resource "aws_s3_bucket" "data_plane" {
  count = var.create_data_bucket ? 1 : 0

  bucket = "${var.project_name}-${var.environment_name}-${data.aws_caller_identity.current.account_id}-data"

  tags = local.common_tags
}

resource "aws_s3_bucket_versioning" "data_plane" {
  count = var.create_data_bucket ? 1 : 0

  bucket = aws_s3_bucket.data_plane[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_dynamodb_table" "table" {
  for_each = var.dynamodb_tables

  name         = "${var.project_name}-${var.environment_name}-${replace(each.key, "_", "-")}"
  billing_mode = each.value.billing_mode
  hash_key     = each.value.hash_key
  range_key    = try(each.value.range_key, null)

  attribute {
    name = each.value.hash_key
    type = "S"
  }

  dynamic "attribute" {
    for_each = try(each.value.range_key, null) == null ? [] : [each.value.range_key]
    content {
      name = attribute.value
      type = "S"
    }
  }

  dynamic "ttl" {
    for_each = try(each.value.ttl_attribute, null) == null ? [] : [each.value.ttl_attribute]
    content {
      attribute_name = ttl.value
      enabled        = true
    }
  }

  point_in_time_recovery {
    enabled = try(each.value.point_in_time, true)
  }

  tags = local.common_tags
}
