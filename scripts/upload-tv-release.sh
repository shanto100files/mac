#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob globstar
case "${1:-}" in
  webos) packages=(dist-tv/webos/*.ipk) ;;
  amazon-vega) packages=(dist-tv/amazon-vega/app/build/**/*.vpkg) ;;
  *) echo "Choose webos or amazon-vega" >&2; exit 1 ;;
esac
if [ ${#packages[@]} -eq 0 ]; then
  echo "No packages found for $1" >&2
  exit 1
fi

VERSION=$(node -p "require('./package.json').version")
TAG="app-v${VERSION}"
if ! gh release view "$TAG" >/dev/null 2>&1; then
  # Another platform can create the shared release concurrently.
  gh release create "$TAG" --target "$GITHUB_SHA" \
    --title "Vega v${VERSION}" --notes "Automated release of Vega." --draft \
    || gh release view "$TAG" >/dev/null
fi
for attempt in {1..6}; do
  if gh release upload "$TAG" "${packages[@]}" --clobber; then
    exit 0
  fi
  if [ "$attempt" -lt 6 ]; then sleep 5; fi
done
echo "Failed to upload $1 packages to $TAG" >&2
exit 1
