#!/usr/bin/env bash
set -euo pipefail

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
allowlist_file="${SECRET_SCAN_ALLOWLIST:-${script_dir}/secret-scan.allowlist}"
compiled_allowlist="${tmp_dir}/allowlist.regex"

patterns=(
  '-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----'
  '-----BEGIN PRIVATE KEY-----'
  'ghp_[A-Za-z0-9]{36}'
  'github_pat_[A-Za-z0-9_]{80,}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'sk-[A-Za-z0-9]{20,}'
)

found=0
files_file="${tmp_dir}/files.txt"
git ls-files > "$files_file"

if [[ -f "$allowlist_file" ]]; then
  set +e
  grep -Ev '^[[:space:]]*(#|$)' "$allowlist_file" > "$compiled_allowlist"
  allowlist_status=$?
  set -e
  if [[ "$allowlist_status" -ne 0 && "$allowlist_status" -ne 1 ]]; then
    echo "[secret-scan] invalid allowlist: ${allowlist_file}" >&2
    exit "$allowlist_status"
  fi
fi

echo "[secret-scan] scanning tracked files (baseline patterns)"
if [[ -s "$compiled_allowlist" ]]; then
  echo "[secret-scan] allowlist enabled: ${allowlist_file}"
fi

for pattern in "${patterns[@]}"; do
  matches_file="${tmp_dir}/matches.txt"
  : > "$matches_file"

  if xargs -a "$files_file" grep -nHE -- "$pattern" > "$matches_file" 2>/dev/null; then
    :
  fi

  if [[ -s "$compiled_allowlist" ]]; then
    filtered_file="${tmp_dir}/filtered.txt"
    set +e
    grep -Ev -f "$compiled_allowlist" "$matches_file" > "$filtered_file"
    filter_status=$?
    set -e
    if [[ "$filter_status" -eq 2 ]]; then
      echo "[secret-scan] invalid allowlist pattern in ${allowlist_file}" >&2
      exit 2
    fi
    mv "$filtered_file" "$matches_file"
  fi

  if [[ -s "$matches_file" ]]; then
    echo "[secret-scan] matched: ${pattern}"
    head -n 20 "$matches_file"
    found=1
  fi
done

if [[ "$found" -ne 0 ]]; then
  echo "[secret-scan] potential secrets detected (see matches above)"
  exit 1
fi

echo "[secret-scan] no matches"
