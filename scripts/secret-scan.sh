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
  '-----BEGIN PGP PRIVATE KEY BLOCK-----'
  'ghp_[A-Za-z0-9]{36}'
  'github_pat_[A-Za-z0-9_]{80,}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'https://hooks\.slack\.com/services/[A-Za-z0-9/_-]{20,}'
  'AKIA[0-9A-Z]{16}'
  'ASIA[0-9A-Z]{16}'
  'AIza[0-9A-Za-z_-]{35}'
  'sk-[A-Za-z0-9]{20,}'
)

found=0
files_file="${tmp_dir}/files.txt"
report_file="${SECRET_SCAN_REPORT_PATH:-}"
git ls-files > "$files_file"
scanned_files_count="$(wc -l < "$files_file" | tr -d ' ')"

if [[ -n "$report_file" ]]; then
  mkdir -p "$(dirname "$report_file")"
  {
    echo -e "pattern\tpath:line"
  } > "$report_file"
fi

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
echo "[secret-scan] tracked files: ${scanned_files_count}"
if [[ -s "$compiled_allowlist" ]]; then
  echo "[secret-scan] allowlist enabled: ${allowlist_file}"
fi

declare -A match_counts=()
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
    match_count="$(wc -l < "$matches_file" | tr -d ' ')"
    match_counts["$pattern"]="$match_count"
    locations_file="${tmp_dir}/locations.txt"
    awk -F: 'NF >= 2 { print $1 ":" $2 }' "$matches_file" > "$locations_file"
    echo "[secret-scan] matched: ${pattern}"
    head -n 20 "$locations_file"
    if [[ -n "$report_file" ]]; then
      while IFS= read -r location; do
        printf '%s\t%s\n' "$pattern" "$location" >> "$report_file"
      done < "$locations_file"
    fi
    found=1
  fi
done

if [[ "${#match_counts[@]}" -gt 0 ]]; then
  echo "[secret-scan] match summary:"
  for pattern in "${!match_counts[@]}"; do
    echo "  - ${pattern}: ${match_counts[$pattern]}"
  done
fi

if [[ -n "$report_file" ]]; then
  echo "[secret-scan] report: ${report_file}"
fi

if [[ "$found" -ne 0 ]]; then
  echo "[secret-scan] potential secrets detected (see matches above)"
  exit 1
fi

echo "[secret-scan] no matches"
