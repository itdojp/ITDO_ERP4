#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-r1}"
EVIDENCE_BASIS="${EVIDENCE_BASIS:-repo-side}"
ENVIRONMENT_LABEL="${ENVIRONMENT_LABEL:-}"

[[ "$DATE_STAMP" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || {
  echo '[storage-readiness-record][error] DATE_STAMP must be YYYY-MM-DD' >&2
  exit 64
}
[[ "$RUN_LABEL" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || {
  echo '[storage-readiness-record][error] RUN_LABEL is invalid' >&2
  exit 64
}
case "$EVIDENCE_BASIS" in repo-side|target-environment) ;; *)
  echo '[storage-readiness-record][error] EVIDENCE_BASIS is invalid' >&2
  exit 64
esac
if [[ -z "$ENVIRONMENT_LABEL" && "$EVIDENCE_BASIS" == "repo-side" ]]; then
  ENVIRONMENT_LABEL="repo-side"
fi
[[ "$ENVIRONMENT_LABEL" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || {
  echo '[storage-readiness-record][error] ENVIRONMENT_LABEL is invalid or missing' >&2
  exit 64
}
if [[ -n "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=normal)" ]]; then
  echo '[storage-readiness-record][error] repository must be clean before recording commit-bound evidence' >&2
  exit 64
fi
commit_sha="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null)" || {
  echo '[storage-readiness-record][error] commit SHA is unavailable' >&2
  exit 64
}
[[ "$commit_sha" =~ ^[a-f0-9]{40,64}$ ]] || {
  echo '[storage-readiness-record][error] commit SHA is invalid' >&2
  exit 64
}

mkdir -p "$OUT_DIR" "$ROOT_DIR/.codex-local/tmp"
output="$OUT_DIR/${DATE_STAMP}-storage-readiness-${RUN_LABEL}.md"
[[ ! -e "$output" ]] || {
  echo '[storage-readiness-record][error] output already exists' >&2
  exit 1
}
input="$(mktemp "$ROOT_DIR/.codex-local/tmp/storage-readiness.XXXXXX.json")"
cleanup() { rm -f -- "$input"; }
trap cleanup EXIT

set +e
"$ROOT_DIR/scripts/storage-readiness.sh" --format json "$@" >"$input"
status=$?
set -e
case "$status" in 0|1|2|3) ;; *)
  echo '[storage-readiness-record][error] readiness command did not produce a recordable result' >&2
  exit "$status"
esac
chmod 600 "$input"
node "$ROOT_DIR/scripts/storage-readiness-record.mjs" \
  --input "$input" --output "$output" --basis "$EVIDENCE_BASIS" \
  --commit-sha "$commit_sha" --environment "$ENVIRONMENT_LABEL"
exit "$status"
