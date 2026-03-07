output "ecs_cluster_name" {
  value = module.platform_foundation.ecs_cluster_name
}

output "ecr_repository_urls" {
  value = module.platform_foundation.ecr_repository_urls
}

output "secret_arns" {
  value = module.platform_foundation.secret_arns
}

output "data_bucket_name" {
  value = module.platform_foundation.data_bucket_name
}
