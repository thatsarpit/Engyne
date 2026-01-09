#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-engyne-483718}"
REGION="${GCP_REGION:-asia-south1}"
AR_REPO="${GCP_AR_REPO:-engyne}"
SERVICE_NAME="${GCP_API_SERVICE:-engyne-api}"

API_BASE_URL="${PUBLIC_API_BASE_URL:-https://api.engyne.space}"
DASHBOARD_BASE_URL="${PUBLIC_DASHBOARD_BASE_URL:-https://app.engyne.space}"
CORS_REGEX="${CORS_ALLOW_ORIGIN_REGEX:-^(https://([a-z0-9-]+\\.)*engyne\\.space|http://localhost(:\\d+)?|http://127\\.0\\.0\\.1(:\\d+)?)$}"
AUTH_ORIGINS="${AUTH_ALLOWED_REDIRECT_ORIGINS:-https://app.engyne.space,https://engyne.space}"
CONN_NAME="${CLOUD_SQL_CONNECTION_NAME:-}"

if [[ -z "$CONN_NAME" && -f runtime/db_connection_name.txt ]]; then
  CONN_NAME="$(cat runtime/db_connection_name.txt)"
fi

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:latest"

gcloud config set project "$PROJECT_ID"

if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  gcloud builds submit \
    --config deploy/cloudbuild.api.yaml \
    --substitutions _IMAGE="$IMAGE" \
    .
fi

env_file="runtime/cloudrun_env.yaml"
cat >"$env_file" <<EOF
PUBLIC_API_BASE_URL: "${API_BASE_URL}"
PUBLIC_DASHBOARD_BASE_URL: "${DASHBOARD_BASE_URL}"
NODE_ID: "hub"
CORS_ALLOW_ORIGIN_REGEX: '${CORS_REGEX}'
AUTH_ALLOWED_REDIRECT_ORIGINS: '${AUTH_ORIGINS}'
EOF

gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --port 8080 \
  --allow-unauthenticated \
  --env-vars-file "$env_file" \
  ${CONN_NAME:+--add-cloudsql-instances "$CONN_NAME"} \
  --set-secrets "DATABASE_URL=engyne-database-url:latest,JWT_SECRET=engyne-jwt-secret:latest,GOOGLE_OAUTH_CLIENT_ID=engyne-google-oauth-client-id:latest,GOOGLE_OAUTH_CLIENT_SECRET=engyne-google-oauth-client-secret:latest,ENGYNE_WORKER_SECRET=engyne-worker-secret:latest,VAPID_PUBLIC_KEY=engyne-vapid-public:latest,VAPID_PRIVATE_KEY=engyne-vapid-private:latest,WAHA_TOKEN=engyne-waha-token:latest"

echo "Deployed Cloud Run service ${SERVICE_NAME} in ${REGION}."
