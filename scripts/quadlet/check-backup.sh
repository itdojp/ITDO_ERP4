#!/usr/bin/env bash
set -euo pipefail

ARCHIVE=""
LIST_ENTRIES=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help       Show this help message and exit
  --archive FILE   Backup archive created by backup-config.sh
  --list           Print archive entries after validation
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)
      [[ $# -ge 2 ]] || fail 'missing argument for --archive'
      ARCHIVE="$2"
      shift 2
      ;;
    --list)
      LIST_ENTRIES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ -n "$ARCHIVE" ]] || fail '--archive is required'
[[ -f "$ARCHIVE" ]] || fail "archive not found: $ARCHIVE"
command -v tar >/dev/null 2>&1 || fail 'required command not found: tar'

if ! entries_output="$(tar -tzf "$ARCHIVE")"; then
  fail "archive could not be listed: $ARCHIVE"
fi
mapfile -t entries <<<"$entries_output"
[[ ${#entries[@]} -gt 0 ]] || fail "archive is empty: $ARCHIVE"

if ! entry_details_output="$(tar -tvzf "$ARCHIVE")"; then
  fail "archive metadata could not be verified: $ARCHIVE"
fi
mapfile -t entry_details <<<"$entry_details_output"
[[ ${#entry_details[@]} -eq ${#entries[@]} ]] || fail "archive metadata could not be verified: $ARCHIVE"

has_proxy=0
has_units=0

for i in "${!entries[@]}"; do
  entry="${entries[$i]}"
  detail="${entry_details[$i]}"
  [[ -n "$entry" ]] || fail "archive contains an empty entry: $ARCHIVE"
  [[ "$entry" != /* ]] || fail "archive contains an absolute path: $entry"
  [[ "$entry" != *'/'* ]] || fail "archive contains nested paths: $entry"
  [[ "$entry" != '.' && "$entry" != '..' ]] || fail "archive contains an invalid entry: $entry"
  [[ "${detail:0:1}" == "-" ]] || fail "archive contains a non-regular entry: $entry"
  case "$entry" in
    erp4-caddy.env|erp4-caddy.Caddyfile)
      has_proxy=1
      ;;
  esac
  if [[ "$entry" =~ \.(container|service|volume|network)$ ]]; then
    has_units=1
  fi
done

printf 'OK: archive validated: %s\n' "$ARCHIVE"
printf 'Entries: %s\n' "${#entries[@]}"
printf 'Includes proxy config: %s\n' "$([[ "$has_proxy" -eq 1 ]] && printf yes || printf no)"
printf 'Includes unit files: %s\n' "$([[ "$has_units" -eq 1 ]] && printf yes || printf no)"

if [[ "$LIST_ENTRIES" -eq 1 ]]; then
  printf 'Archive entries:\n'
  printf '  %s\n' "${entries[@]}"
fi
