#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob globstar
case "${1:-}" in
  webos) platform=webos; extension=ipk; packages=(dist-tv/webos/*.ipk) ;;
  amazon-vega) platform=vegaos; extension=vpkg; packages=(dist-tv/amazon-vega/app/build/**/*.vpkg) ;;
  *) echo "Choose webos or amazon-vega" >&2; exit 1 ;;
esac
# SDK build/private contains working copies of the final release packages.
if [ "$1" = amazon-vega ]; then
  final_packages=()
  for package in "${packages[@]}"; do
    if [[ "$package" != */private/* ]]; then final_packages+=("$package"); fi
  done
  if [ ${#final_packages[@]} -gt 0 ]; then packages=("${final_packages[@]}"); fi
fi
if [ ${#packages[@]} -eq 0 ]; then
  echo "No packages found for $1" >&2
  exit 1
fi

VERSION=${TV_RELEASE_VERSION:-$(node -p "require('./package.json').version")}
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]+)?$ ]]; then
  echo "Invalid release version" >&2
  exit 1
fi
TAG="app-v${VERSION}"
stage="dist-tv/release-upload/$1"
mkdir -p "$stage"
uploads=()
declare -A names=()
for package in "${packages[@]}"; do
  suffix=""
  if [ ${#packages[@]} -gt 1 ]; then
    case "$package" in
      *arm64*|*aarch64*) variant=arm64 ;;
      *armv7*|*armhf*) variant=armv7 ;;
      *x86_64*|*amd64*|*x64*) variant=x64 ;;
      *) variant="${package##*/}"; variant="${variant%.*}" ;;
    esac
    suffix="_${variant//[^a-zA-Z0-9_-]/_}"
  fi
  name="Vega_${VERSION}_${platform}${suffix}.${extension}"
  if [[ -n "${names[$name]:-}" ]]; then
    echo "Multiple packages resolve to $name: ${names[$name]} and $package" >&2
    exit 1
  fi
  names[$name]="$package"
  echo "Stage $package as $name"
  cp -- "$package" "$stage/$name"
  uploads+=("$stage/$name")
done
if ! gh release view "$TAG" >/dev/null 2>&1; then
  # Another platform can create the shared release concurrently.
  gh release create "$TAG" --target "${TV_RELEASE_SOURCE_SHA:-$GITHUB_SHA}" \
    --title "Vega v${VERSION}" --notes "Automated release of Vega." --draft \
    || gh release view "$TAG" >/dev/null
fi
uploaded=false
for attempt in {1..6}; do
  if gh release upload "$TAG" "${uploads[@]}" --clobber; then
    uploaded=true
    break
  fi
  if [ "$attempt" -lt 6 ]; then sleep 5; fi
done
if [ "$uploaded" != true ]; then
  echo "Failed to upload $1 packages to $TAG" >&2
  exit 1
fi

# Remove legacy SDK-generated filenames only after their replacements exist.
asset_names=$(gh release view "$TAG" --json assets --jq '.assets[].name')
while IFS= read -r asset; do
  for package in "${packages[@]}"; do
    if [[ "$asset" == "${package##*/}" && -z "${names[$asset]:-}" ]]; then
      gh release delete-asset "$TAG" "$asset" --yes
      break
    fi
  done
done <<< "$asset_names"
