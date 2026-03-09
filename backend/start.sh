#!/usr/bin/env bash
# Start historian-api with all required env vars
# Usage: ./start.sh [--reload]
set -e

cd "$(dirname "$0")"

exec env \
  GOOGLE_APPLICATION_CREDENTIALS=SERVICE_ACCOUNT_KEY_PATH \
  GCS_BUCKET_NAME=YOUR_BUCKET_NAME \
  GCP_PROJECT_ID=YOUR_PROJECT_ID \
  DOCUMENT_AI_PROCESSOR_NAME=projects/YOUR_PROJECT_ID/locations/us/processors/YOUR_PROCESSOR_ID \
  VERTEX_AI_LOCATION=us-central1 \
  GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID \
  GOOGLE_CLOUD_LOCATION=us-central1 \
  GOOGLE_GENAI_USE_VERTEXAI=1 \
  PORT=8000 \
  uvicorn historian_api.main:app --host 0.0.0.0 --port 8000 "$@"
