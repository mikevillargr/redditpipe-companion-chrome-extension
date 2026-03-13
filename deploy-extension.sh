#!/bin/bash
# Deploy RedditPipe Chrome Extension to VPS
# Usage: ./deploy-extension.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/redditpipe-extension"
ZIP_PATH="/tmp/redditpipe-extension.zip"
VPS_HOST="root@76.13.191.149"
VPS_CONTAINER="redditpipe-frontend"
VPS_DEST="/usr/share/nginx/html/redditpipe-extension.zip"

echo "📦 Zipping extension..."
rm -f "$ZIP_PATH"
cd "$SCRIPT_DIR"
zip -r "$ZIP_PATH" redditpipe-extension/ -x "redditpipe-extension/.DS_Store" "redditpipe-extension/**/.DS_Store"

echo "⬆️  Uploading to VPS..."
scp "$ZIP_PATH" "$VPS_HOST:/tmp/redditpipe-extension.zip"

echo "🐳 Copying into container..."
ssh "$VPS_HOST" "docker cp /tmp/redditpipe-extension.zip $VPS_CONTAINER:$VPS_DEST"

echo "✅ Extension deployed to http://76.13.191.149:3200/redditpipe-extension.zip"
