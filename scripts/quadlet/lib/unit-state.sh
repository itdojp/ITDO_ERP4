#!/usr/bin/env bash

erp4_unit_content_sha256() {
  local path="$1"
  [[ -f "$path" ]] || return 1
  sha256sum -- "$path" | awk '{print $1}'
}

erp4_read_unit_state() {
  local state_file="$1"
  local value
  [[ -f "$state_file" && ! -L "$state_file" ]] || return 1
  [[ "$(stat -c '%u:%a' -- "$state_file")" == "$EUID:600" ]] || return 1
  IFS= read -r value <"$state_file" || return 1
  [[ "$value" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s\n' "$value"
}

erp4_write_unit_state() {
  local state_file="$1"
  local value="$2"
  local temp_file
  [[ "$value" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ ! -L "$state_file" ]] || return 1
  temp_file="$(mktemp "${state_file}.tmp.XXXXXX")" || return 1
  if ! printf '%s\n' "$value" >"$temp_file" || ! chmod 0600 "$temp_file" || ! mv -f -- "$temp_file" "$state_file"; then
    rm -f -- "$temp_file"
    return 1
  fi
}
