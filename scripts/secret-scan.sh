#!/usr/bin/env bash
set -euo pipefail

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

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

echo "[secret-scan] scanning tracked files (baseline patterns)"

for pattern in "${patterns[@]}"; do
  matches_file="${tmp_dir}/matches.txt"
  : > "$matches_file"

  if xargs -a "$files_file" grep -nE -- "$pattern" > "$matches_file" 2>/dev/null; then
    :
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
