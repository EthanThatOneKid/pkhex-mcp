#!/usr/bin/env bash
# Download Gen 4 Platinum front battle sprites from PokeAPI/sprites
# Output: src/ui/sprites/platinum/<national-dex>.png (80x80 px each)
set -euo pipefail

DEST="src/ui/sprites/platinum"
API_URL="https://api.github.com/repos/PokeAPI/sprites/contents/sprites/pokemon/versions/generation-iv/platinum"

mkdir -p "$DEST"

echo "Fetching directory listing from GitHub API..."
ITEMS=$(curl -s "$API_URL")

# Check for API error
if echo "$ITEMS" | grep -q '"message"'; then
  echo "Error: $(echo "$ITEMS" | grep '"message"' | head -1)"
  exit 1
fi

COUNT=$(echo "$ITEMS" | grep -c '"download_url"')
echo "Found $COUNT sprites to download."

echo "$ITEMS" | grep '"download_url"' | sed 's/.*"download_url": "//;s/".*//' | while read -r url; do
  filename=$(basename "$url")
  if [ -f "$DEST/$filename" ]; then
    continue
  fi
  curl -s -o "$DEST/$filename" "$url"
  echo "  downloaded $filename"
done

echo "Done. $(ls "$DEST"/*.png 2>/dev/null | wc -l) sprites in $DEST/"
