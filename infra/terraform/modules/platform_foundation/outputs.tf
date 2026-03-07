output "ecs_cluster_name" {
  value       = aws_ecs_cluster.this.name
  description = "Name of the ECS cluster for this environment."
}

output "ecs_cluster_arn" {
  value       = aws_ecs_cluster.this.arn
  description = "ARN of the ECS cluster for this environment."
}

output "ecr_repository_urls" {
  value       = { for service, repo in aws_ecr_repository.service : service => repo.repository_url }
  description = "ECR repository URL per service."
}

output "log_group_names" {
  value       = { for service, log_group in aws_cloudwatch_log_group.service : service => log_group.name }
  description = "CloudWatch log group per service."
}

output "service_task_role_arns" {
  value       = { for service, role in aws_iam_role.service_task : service => role.arn }
  description = "Task role ARN per service."
}

output "execution_role_arn" {
  value       = aws_iam_role.ecs_task_execution.arn
  description = "Shared ECS task execution role ARN."
}

output "secret_arns" {
  value       = { for name, secret in aws_secretsmanager_secret.managed : name => secret.arn }
  description = "Secret ARN per managed secret name."
}

output "data_bucket_name" {
  value       = try(aws_s3_bucket.data_plane[0].bucket, null)
  description = "Shared S3 data bucket name."
}

output "dynamodb_table_names" {
  value       = { for key, table in aws_dynamodb_table.table : key => table.name }
  description = "DynamoDB table names keyed by logical table id."
}
