#!/usr/bin/env bash
set -euo pipefail

PACKAGE="${DESIGN_SYSTEM_PACKAGE:-@itdo/design-system}"
REGISTRY="${DESIGN_SYSTEM_REGISTRY:-https://registry.npmjs.org}"
VERSION="${DESIGN_SYSTEM_VERSION:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NPM_USERCONFIG="${NPM_CONFIG_USERCONFIG:-${REPO_ROOT}/.npmrc}"

requires_auth="false"
if [[ "${REGISTRY}" == *"npm.pkg.github.com"* ]]; then
  requires_auth="true"
fi

if [[ "${requires_auth}" == "true" ]] && [[ -z "${NODE_AUTH_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    NODE_AUTH_TOKEN="$(gh auth token)"
    export NODE_AUTH_TOKEN
  fi
fi

if [[ "${requires_auth}" == "true" ]] && [[ -z "${NODE_AUTH_TOKEN:-}" ]]; then
  echo "NODE_AUTH_TOKEN is required for GitHub Packages. Export NODE_AUTH_TOKEN or login via 'gh auth login'." >&2
  exit 1
fi

TARGET="${PACKAGE}"
if [[ -n "${VERSION}" ]]; then
  TARGET="${PACKAGE}@${VERSION}"
fi

if OUTPUT="$(npm view "${TARGET}" version --json --registry="${REGISTRY}" --userconfig="${NPM_USERCONFIG}" 2>&1)"; then
  echo "OK: package is available"
  echo "target: ${TARGET}"
  echo "registry: ${REGISTRY}"
  echo "npmrc: ${NPM_USERCONFIG}"
  echo "version: ${OUTPUT}"
  exit 0
fi

echo "NG: package is not available or not accessible" >&2
echo "target: ${TARGET}" >&2
echo "registry: ${REGISTRY}" >&2
echo "npmrc: ${NPM_USERCONFIG}" >&2
echo "${OUTPUT}" >&2
exit 2
