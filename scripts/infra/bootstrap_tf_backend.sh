#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: $0 <aws-profile> <state-bucket> [lock-table]" >&2
  exit 1
fi

AWS_PROFILE_NAME="$1"
STATE_BUCKET="$2"
LOCK_TABLE="${3:-poly-orchestrator-tf-locks}"
AWS_REGION="${AWS_REGION:-us-west-2}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 1
fi

echo "Bootstrapping Terraform backend for profile $AWS_PROFILE_NAME in $AWS_REGION"

if aws s3api head-bucket --bucket "$STATE_BUCKET" --profile "$AWS_PROFILE_NAME" >/dev/null 2>&1; then
  echo "  bucket exists: $STATE_BUCKET"
else
  aws s3api create-bucket \
    --bucket "$STATE_BUCKET" \
    --region "$AWS_REGION" \
    --create-bucket-configuration "LocationConstraint=$AWS_REGION" \
    --profile "$AWS_PROFILE_NAME" >/dev/null
  echo "  created bucket: $STATE_BUCKET"
fi

aws s3api put-bucket-versioning \
  --bucket "$STATE_BUCKET" \
  --versioning-configuration Status=Enabled \
  --profile "$AWS_PROFILE_NAME" >/dev/null

aws s3api put-bucket-encryption \
  --bucket "$STATE_BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
  --profile "$AWS_PROFILE_NAME" >/dev/null

aws s3api put-public-access-block \
  --bucket "$STATE_BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true \
  --profile "$AWS_PROFILE_NAME" >/dev/null

if aws dynamodb describe-table --table-name "$LOCK_TABLE" --profile "$AWS_PROFILE_NAME" >/dev/null 2>&1; then
  echo "  lock table exists: $LOCK_TABLE"
else
  aws dynamodb create-table \
    --table-name "$LOCK_TABLE" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --profile "$AWS_PROFILE_NAME" >/dev/null

  aws dynamodb wait table-exists \
    --table-name "$LOCK_TABLE" \
    --profile "$AWS_PROFILE_NAME"

  echo "  created lock table: $LOCK_TABLE"
fi

echo "Terraform backend bootstrap complete for $AWS_PROFILE_NAME"
