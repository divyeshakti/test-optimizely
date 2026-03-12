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

# Write functions/.env so Firebase CLI uploads it with the deployment
FUNCTIONS_ENV="$(dirname "$0")/functions/.env"
echo "ODP_API_KEY=$ODP_API_KEY" > "$FUNCTIONS_ENV"
echo "Wrote $FUNCTIONS_ENV"

echo "Deploying to Firebase (project: zeotap-qa-microsvcs)..."
firebase deploy --only functions

# Clean up — don't leave the key on disk after deploy
rm -f "$FUNCTIONS_ENV"
echo "Done."
