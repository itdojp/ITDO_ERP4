#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_DIR="${INPUT_DIR:-}"
INPUT_FORMAT="${INPUT_FORMAT:-csv}"
ONLY="${ONLY:-}"
STRICT="${STRICT:-1}"

ALL_SCOPES=(
  customers
  vendors
  projects
  tasks
  milestones
  estimates
  invoices
  purchase_orders
  vendor_quotes
  vendor_invoices
  time_entries
  expenses
)

usage() {
  cat <<USAGE
Usage:
  INPUT_DIR=tmp/migration/po-real INPUT_FORMAT=csv ./scripts/check-po-migration-input-readiness.sh

Required env:
  INPUT_DIR

Optional env:
  INPUT_FORMAT=csv|json   (default: csv)
  ONLY=scope1,scope2      (default: all scopes)
  STRICT=0|1              (default: 1)

Notes:
- STRICT=1:
  - ONLY 指定時: 指定scopeの入力ファイルが全て存在しなければ失敗
  - ONLY 未指定時: 入力ファイルが1つも存在しなければ失敗
USAGE
}

log() {
  echo "[po-migration-input-preflight] $*"
}

warn() {
  echo "[po-migration-input-preflight][WARN] $*" >&2
}

die() {
  echo "[po-migration-input-preflight][ERROR] $*" >&2
  exit 1
}

normalize_input_dir() {
  if [[ "$INPUT_DIR" = /* ]]; then
    printf '%s\n' "$INPUT_DIR"
  else
    printf '%s\n' "$ROOT_DIR/$INPUT_DIR"
  fi
}

contains_scope() {
  local target="$1"
  local scope
  for scope in "${ALL_SCOPES[@]}"; do
    if [[ "$scope" == "$target" ]]; then
      return 0
    fi
  done
  return 1
}

main() {
  if [[ -z "$INPUT_DIR" ]]; then
    usage
    die "INPUT_DIR is required"
  fi
  if [[ "$INPUT_FORMAT" != "csv" && "$INPUT_FORMAT" != "json" ]]; then
    die "INPUT_FORMAT must be csv|json"
  fi
  if [[ "$STRICT" != "0" && "$STRICT" != "1" ]]; then
    die "STRICT must be 0|1"
  fi

  local input_dir_resolved
  input_dir_resolved="$(normalize_input_dir)"
  if [[ ! -d "$input_dir_resolved" ]]; then
    die "input dir not found: $input_dir_resolved"
  fi

  local scopes=()
  if [[ -n "$ONLY" ]]; then
    local raw
    IFS=',' read -r -a raw <<< "$ONLY"
    local scope
    for scope in "${raw[@]}"; do
      scope="$(echo "$scope" | xargs)"
      [[ -z "$scope" ]] && continue
      if ! contains_scope "$scope"; then
        die "invalid scope in ONLY: $scope"
      fi
      scopes+=("$scope")
    done
    if (( ${#scopes[@]} == 0 )); then
      die "ONLY did not contain valid scopes"
    fi
  else
    scopes=("${ALL_SCOPES[@]}")
  fi

  local found=0
  local missing=0
  local scope file
  for scope in "${scopes[@]}"; do
    file="$input_dir_resolved/${scope}.${INPUT_FORMAT}"
    if [[ -f "$file" ]]; then
      found=$((found + 1))
      log "FOUND  $scope -> $file"
    else
      missing=$((missing + 1))
      warn "MISSING $scope -> $file"
    fi
  done

  log "summary: scopes=${#scopes[@]} found=${found} missing=${missing} format=${INPUT_FORMAT}"

  if [[ "$STRICT" == "1" ]]; then
    if [[ -n "$ONLY" && "$missing" -gt 0 ]]; then
      die "STRICT=1 and ONLY scopes contain missing files"
    fi
    if [[ -z "$ONLY" && "$found" -eq 0 ]]; then
      die "STRICT=1 and no input files found"
    fi
  fi

  log "preflight completed"
}

main "$@"
