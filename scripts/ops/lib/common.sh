#!/usr/bin/env bash
# Shared helpers for ERP4 ops automation scripts.

if [[ -n "${ERP4_OPS_COMMON_SOURCED:-}" ]]; then
  return 0
fi
ERP4_OPS_COMMON_SOURCED=1

ops_timestamp() {
  date -u +'%Y-%m-%dT%H:%M:%SZ'
}

ops_info() {
  printf '[ops][info] %s\n' "$*"
}

ops_warn() {
  printf '[ops][warn] %s\n' "$*" >&2
}

ops_error() {
  printf '[ops][error] %s\n' "$*" >&2
}

ops_fail() {
  ops_error "$*"
  exit 1
}

ops_require_arg() {
  local option="$1"
  local value="${2:-}"
  [[ -n "$value" ]] || ops_fail "$option requires a non-empty argument"
}

ops_command_exists() {
  command -v "$1" >/dev/null 2>&1
}

ops_quote_command() {
  local first=1
  local arg
  for arg in "$@"; do
    if [[ "$first" -eq 0 ]]; then
      printf ' '
    fi
    printf '%q' "$arg"
    first=0
  done
  printf '\n'
}

ops_run() {
  local mode="$1"
  shift
  if [[ "$mode" == "dry-run" ]]; then
    printf '[ops][dry-run] '
    ops_quote_command "$@"
    return 0
  fi
  printf '[ops][run] '
  ops_quote_command "$@"
  "$@"
}

ops_is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

ops_read_env_value() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    $0 ~ /^[[:space:]]*#/ { next }
    $0 ~ /^[[:space:]]*$/ { next }
    {
      pos = index($0, "=")
      if (pos == 0) next
      k = substr($0, 1, pos - 1)
      sub(/^[[:space:]]+/, "", k)
      sub(/[[:space:]]+$/, "", k)
      if (k == key) {
        v = substr($0, pos + 1)
        sub(/^[[:space:]]+/, "", v)
        sub(/[[:space:]]+$/, "", v)
        gsub(/^"|"$/, "", v)
        print v
        exit
      }
    }
  ' "$file"
}

ops_mask_tail() {
  local value="${1:-}"
  local keep="${2:-4}"
  if [[ -z "$value" ]]; then
    printf '<empty>\n'
  elif (( ${#value} <= keep )); then
    printf '***\n'
  else
    printf '***%s\n' "${value: -keep}"
  fi
}

ops_check_private_file_mode() {
  local file="$1"
  local mode
  [[ -e "$file" ]] || return 0
  mode="$(stat -c '%a' "$file" 2>/dev/null || stat -f '%Lp' "$file" 2>/dev/null || true)"
  [[ -n "$mode" ]] || return 0
  if (( (8#$mode & 8#077) != 0 )); then
    ops_warn "$file should not be readable, writable, or executable by group/other (current: $mode)"
    return 1
  fi
  return 0
}
