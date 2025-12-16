#!/bin/bash
set -e

echo "Building the application..."
npm install
npm run build

echo "Deploying to Cloud Run..."
gcloud beta run deploy appmod-battle-royal \
  --source . \
  --region europe-north2 \
  --no-build \
  --base-image=nodejs22 \
  --command=node \
  --args=server.js \
  --allow-unauthenticated
