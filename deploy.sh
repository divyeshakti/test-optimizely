#!/bin/bash
# Deploy to Firebase Hosting + Functions
# Reads ODP_API_KEY from server/.env and sets it via functions/.env before deploying.

set -e

PROJECT=$(firebase use --json 2>/dev/null | grep '"active"' | sed 's/.*"active": *"\([^"]*\)".*/\1/' || echo "")

ENV_FILE="$(dirname "$0")/server/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

# Parse ODP_API_KEY from .env
ODP_API_KEY=$(grep -E '^ODP_API_KEY=' "$ENV_FILE" | cut -d '=' -f2-)

if [ -z "$ODP_API_KEY" ]; then
  echo "Error: ODP_API_KEY not found in $ENV_FILE"
  exit 1
fi

# Enable Eventarc API and grant service agent role (required for Cloud Functions v1 deploy)
echo "Enabling required GCP APIs..."
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID="unity-firebase-preview"
fi

gcloud services enable eventarc.googleapis.com --project="$PROJECT_ID" 2>/dev/null || true

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)" 2>/dev/null || echo "")
if [ -n "$PROJECT_NUMBER" ]; then
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-eventarc.iam.gserviceaccount.com" \
    --role="roles/eventarc.serviceAgent" 2>/dev/null || true
fi

# Write functions/.env so Firebase CLI uploads it with the deployment
FUNCTIONS_ENV="$(dirname "$0")/functions/.env"
echo "ODP_API_KEY=$ODP_API_KEY" > "$FUNCTIONS_ENV"
echo "Wrote $FUNCTIONS_ENV"

echo "Deploying to Firebase..."
firebase deploy

# Clean up — don't leave the key on disk after deploy
rm -f "$FUNCTIONS_ENV"
echo "Done."
