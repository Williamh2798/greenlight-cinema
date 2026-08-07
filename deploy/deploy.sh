#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-tendlife-1af7d}"
REGION="${GOOGLE_CLOUD_LOCATION:-us-central1}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AR_REPO="greenlight"
API_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/api:latest"
WEB_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/web:latest"

echo "Project: $PROJECT_ID  Region: $REGION"
cd "$REPO_ROOT"

gcloud config set project "$PROJECT_ID"

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  --project "$PROJECT_ID"

if ! gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --project="$PROJECT_ID" \
    --description="Greenlight hackathon images"
fi

if ! gcloud secrets describe PARALLEL_API_KEY --project "$PROJECT_ID" >/dev/null 2>&1; then
  if [[ -z "${PARALLEL_API_KEY:-}" ]]; then
    echo "ERROR: Set PARALLEL_API_KEY before first deploy (https://platform.parallel.ai)." >&2
    exit 1
  fi
  printf '%s' "$PARALLEL_API_KEY" | gcloud secrets create PARALLEL_API_KEY \
    --project "$PROJECT_ID" \
    --replication-policy=automatic \
    --data-file=-
elif [[ -n "${PARALLEL_API_KEY:-}" ]]; then
  printf '%s' "$PARALLEL_API_KEY" | gcloud secrets versions add PARALLEL_API_KEY \
    --project "$PROJECT_ID" \
    --data-file=-
fi

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding PARALLEL_API_KEY \
  --project "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

# Vertex AI access for Cloud Run runtime
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/aiplatform.user" \
  --condition=None \
  --quiet >/dev/null || true

echo "Building API image..."
gcloud builds submit "$REPO_ROOT" \
  --project "$PROJECT_ID" \
  --config deploy/cloudbuild-api.yaml \
  --substitutions="_IMAGE=${API_IMAGE}"

echo "Deploying API..."
gcloud run deploy greenlight-api \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$API_IMAGE" \
  --allow-unauthenticated \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},GOOGLE_GENAI_USE_VERTEXAI=true,GEMINI_MODEL=gemini-2.5-flash,CORS_ORIGINS=*" \
  --set-secrets="PARALLEL_API_KEY=PARALLEL_API_KEY:latest" \
  --memory=2Gi \
  --cpu=2 \
  --timeout=3600 \
  --quiet

API_URL="$(gcloud run services describe greenlight-api --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
echo "API URL: $API_URL"

echo "Building Web image..."
gcloud builds submit "$REPO_ROOT" \
  --project "$PROJECT_ID" \
  --config deploy/cloudbuild-web.yaml \
  --substitutions="_IMAGE=${WEB_IMAGE},_API_URL=${API_URL}"

echo "Deploying Web..."
gcloud run deploy greenlight-web \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$WEB_IMAGE" \
  --allow-unauthenticated \
  --memory=512Mi \
  --cpu=1 \
  --quiet

WEB_URL="$(gcloud run services describe greenlight-web --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
echo ""
echo "========================================"
echo "Hosted Project URL: $WEB_URL"
echo "API:                $API_URL"
echo "API docs:           ${API_URL}/docs"
echo "========================================"
