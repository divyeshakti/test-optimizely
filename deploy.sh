#!/bin/bash
# Deploy to Firebase Hosting + Functions
# Reads ODP_API_KEY from server/.env and sets it as a Firebase secret before deploying.
# Copies latency-test results into the hosting root so they're served as static files.

set -e

ROOT="$(dirname "$0")"
ENV_FILE="$ROOT/server/.env"

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
FUNCTIONS_ENV="$ROOT/functions/.env"
echo "ODP_API_KEY=$ODP_API_KEY" > "$FUNCTIONS_ENV"
echo "Wrote $FUNCTIONS_ENV"

# Copy latency-test results into hosting root for static serving
if [ -d "$ROOT/server/results" ]; then
  mkdir -p "$ROOT/results"
  cp -r "$ROOT/server/results/"* "$ROOT/results/" 2>/dev/null || true
  echo "Copied server/results/ → results/"
fi
if [ -f "$ROOT/server/results-index.json" ]; then
  cp "$ROOT/server/results-index.json" "$ROOT/results-index.json"
  echo "Copied server/results-index.json → results-index.json"
fi

echo "Deploying to Firebase (project: zeotap-qa-microsvcs)..."
firebase deploy --only functions,hosting

# Clean up — don't leave the key on disk or duplicate results after deploy
rm -f "$FUNCTIONS_ENV"
rm -rf "$ROOT/results"
rm -f "$ROOT/results-index.json"
echo "Done."
