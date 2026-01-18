#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="tmp/sbom"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/export-sbom.sh [--out <dir>]

Generate SBOM (CycloneDX JSON) for backend/frontend from package-lock.json.
EOF
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$OUT_DIR"

CYCLONEDX_VERSION="2.1.0"

echo "Generating SBOMs into: $OUT_DIR"

npx -y "@cyclonedx/cyclonedx-npm@${CYCLONEDX_VERSION}" \
  --package-lock-only \
  --output-reproducible \
  --output-format JSON \
  --spec-version 1.6 \
  --output-file "${OUT_DIR}/backend.cdx.json" \
  packages/backend/package.json

npx -y "@cyclonedx/cyclonedx-npm@${CYCLONEDX_VERSION}" \
  --package-lock-only \
  --output-reproducible \
  --output-format JSON \
  --spec-version 1.6 \
  --output-file "${OUT_DIR}/frontend.cdx.json" \
  packages/frontend/package.json

echo "Done:"
ls -la "${OUT_DIR}/backend.cdx.json" "${OUT_DIR}/frontend.cdx.json"
