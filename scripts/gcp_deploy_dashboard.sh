#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-engyne-483718}"
BUCKET="${GCP_DASHBOARD_BUCKET:-engyne-dashboard-prod}"
BUCKET_LOCATION="${GCP_BUCKET_LOCATION:-ASIA-SOUTH1}"
API_BASE_URL="${VITE_API_BASE_URL:-https://api.engyne.space}"

gcloud config set project "$PROJECT_ID"

pushd dashboards/client >/dev/null
export VITE_API_BASE_URL="$API_BASE_URL"
npm install
npm run build
popd >/dev/null

gsutil mb -p "$PROJECT_ID" -c STANDARD -l "$BUCKET_LOCATION" "gs://${BUCKET}" 2>/dev/null || true
gsutil -m rsync -r dashboards/client/dist "gs://${BUCKET}"
gsutil web set -m index.html -e index.html "gs://${BUCKET}"

echo "Dashboard deployed to gs://${BUCKET} (API ${API_BASE_URL})."
