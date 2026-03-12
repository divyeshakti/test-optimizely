#!/bin/bash
# Deploy to Firebase Hosting + Functions
# Reads ODP_API_KEY from server/.env and sets it as a Firebase secret before deploying.

set -e

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

echo "Setting ODP_API_KEY secret in Firebase..."
echo "$ODP_API_KEY" | firebase functions:secrets:set ODP_API_KEY

echo "Deploying to Firebase..."
firebase deploy

echo "Done."
