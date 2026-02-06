#!/usr/bin/env bash
set -euo pipefail

PACKAGE="${DESIGN_SYSTEM_PACKAGE:-@itdojp/design-system}"
REGISTRY="${DESIGN_SYSTEM_REGISTRY:-https://npm.pkg.github.com}"
VERSION="${DESIGN_SYSTEM_VERSION:-}"

if [[ -z "${NODE_AUTH_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    NODE_AUTH_TOKEN="$(gh auth token)"
    export NODE_AUTH_TOKEN
  fi
fi

if [[ -z "${NODE_AUTH_TOKEN:-}" ]]; then
  echo "NODE_AUTH_TOKEN is required. Export NODE_AUTH_TOKEN or login via 'gh auth login'." >&2
  exit 1
fi

TARGET="${PACKAGE}"
if [[ -n "${VERSION}" ]]; then
  TARGET="${PACKAGE}@${VERSION}"
fi

if OUTPUT="$(npm view "${TARGET}" version --json --registry="${REGISTRY}" 2>&1)"; then
  echo "OK: package is available"
  echo "target: ${TARGET}"
  echo "registry: ${REGISTRY}"
  echo "version: ${OUTPUT}"
  exit 0
fi

echo "NG: package is not available or not accessible" >&2
echo "target: ${TARGET}" >&2
echo "registry: ${REGISTRY}" >&2
echo "${OUTPUT}" >&2
exit 2
