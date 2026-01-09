#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-engyne-483718}"
REGION="${GCP_REGION:-asia-south1}"
AR_REPO="${GCP_AR_REPO:-engyne}"
SERVICE_NAME="${GCP_API_SERVICE:-engyne-api}"

API_BASE_URL="${PUBLIC_API_BASE_URL:-https://api.engyne.space}"
DASHBOARD_BASE_URL="${PUBLIC_DASHBOARD_BASE_URL:-https://app.engyne.space}"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:latest"

gcloud config set project "$PROJECT_ID"

gcloud builds submit --tag "$IMAGE" --file Dockerfile.api .

gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --port 8080 \
  --allow-unauthenticated \
  --set-env-vars "PUBLIC_API_BASE_URL=${API_BASE_URL},PUBLIC_DASHBOARD_BASE_URL=${DASHBOARD_BASE_URL},NODE_ID=hub"

echo "Deployed Cloud Run service ${SERVICE_NAME} in ${REGION}."
