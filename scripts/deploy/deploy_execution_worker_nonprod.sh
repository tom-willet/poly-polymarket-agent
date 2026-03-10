#!/usr/bin/env bash
set -euo pipefail

AWS_PROFILE="${AWS_PROFILE:-mullet-dev}"
AWS_REGION="${AWS_REGION:-us-west-2}"
CLUSTER_NAME="${CLUSTER_NAME:-poly-orchestrator-nonprod}"
SERVICE_NAME="${SERVICE_NAME:-poly-orchestrator-nonprod-execution-worker}"

if ! command -v docker >/dev/null 2>&1; then
  printf 'docker is required\n' >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  printf 'docker daemon is not running\n' >&2
  exit 1
fi

ACCOUNT_ID="$(AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" aws sts get-caller-identity --query Account --output text)"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_REPO="${ECR_REGISTRY}/poly-orchestrator/nonprod/execution-worker"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE_URI="${IMAGE_REPO}:${IMAGE_TAG}"
BUILD_PLATFORM="${BUILD_PLATFORM:-linux/amd64}"
DOCKER_CONFIG_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$DOCKER_CONFIG_DIR"
}

trap cleanup EXIT

if [ -d "$HOME/.docker/cli-plugins" ]; then
  ln -s "$HOME/.docker/cli-plugins" "$DOCKER_CONFIG_DIR/cli-plugins"
fi

export DOCKER_CONFIG="$DOCKER_CONFIG_DIR"

AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" aws ecr get-login-password \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker buildx build \
  --platform "$BUILD_PLATFORM" \
  -f services/execution-worker/Dockerfile \
  -t "$IMAGE_URI" \
  --push \
  .

SERVICE_STATUS="$(
  AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" aws ecs describe-services \
    --cluster "$CLUSTER_NAME" \
    --services "$SERVICE_NAME" \
    --query 'services[0].status' \
    --output text 2>/dev/null || true
)"

if [ "$SERVICE_STATUS" = "ACTIVE" ]; then
  AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service "$SERVICE_NAME" \
    --force-new-deployment >/dev/null

  AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" aws ecs wait services-stable \
    --cluster "$CLUSTER_NAME" \
    --services "$SERVICE_NAME"

  AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" aws ecs describe-services \
    --cluster "$CLUSTER_NAME" \
    --services "$SERVICE_NAME" \
    --query 'services[0].{serviceName:serviceName,status:status,runningCount:runningCount,pendingCount:pendingCount,taskDefinition:taskDefinition}' \
    --output table
else
  printf 'image pushed to %s; ECS service %s does not exist yet\n' "$IMAGE_URI" "$SERVICE_NAME"
fi
