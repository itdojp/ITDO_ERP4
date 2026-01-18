#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SOURCE_CONTAINER_NAME="${SOURCE_CONTAINER_NAME:-erp4-pg-poc}"
SOURCE_HOST_PORT="${SOURCE_HOST_PORT:-55432}"

VERIFY_CONTAINER_NAME="${VERIFY_CONTAINER_NAME:-erp4-pg-dr-verify}"
VERIFY_HOST_PORT="${VERIFY_HOST_PORT:-55433}"

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/tmp/erp4-backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-erp4}"
BACKUP_TIMESTAMP="${BACKUP_TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"

KEEP_VERIFY_CONTAINER="${KEEP_VERIFY_CONTAINER:-0}"
LOG_FILE="${LOG_FILE:-$ROOT_DIR/tmp/erp4-dr-verify-${BACKUP_TIMESTAMP}.log}"

usage() {
  cat <<USAGE
Usage: $0

This script performs a restore verification on Podman by:
  1) creating a backup from SOURCE_CONTAINER_NAME
  2) restoring into VERIFY_CONTAINER_NAME (separate container)
  3) running integrity checks

Optional env:
  SOURCE_CONTAINER_NAME, SOURCE_HOST_PORT
  VERIFY_CONTAINER_NAME, VERIFY_HOST_PORT
  BACKUP_DIR, BACKUP_PREFIX, BACKUP_TIMESTAMP
  LOG_FILE
  KEEP_VERIFY_CONTAINER=1 (do not stop/remove verify container)
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

mkdir -p "$(dirname "$LOG_FILE")"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "[restore-verify] started: $(date -Is)"
echo "[restore-verify] source container: ${SOURCE_CONTAINER_NAME} (port ${SOURCE_HOST_PORT})"
echo "[restore-verify] verify container: ${VERIFY_CONTAINER_NAME} (port ${VERIFY_HOST_PORT})"
echo "[restore-verify] backup dir: ${BACKUP_DIR}"
echo "[restore-verify] backup prefix: ${BACKUP_PREFIX}"
echo "[restore-verify] backup timestamp: ${BACKUP_TIMESTAMP}"
echo "[restore-verify] log file: ${LOG_FILE}"

START_EPOCH="$(date +%s)"

backup_file="${BACKUP_DIR}/${BACKUP_PREFIX}-backup-${BACKUP_TIMESTAMP}.sql"
globals_file="${BACKUP_DIR}/${BACKUP_PREFIX}-globals-${BACKUP_TIMESTAMP}.sql"

echo "[1/4] create backup from source"
CONTAINER_NAME="$SOURCE_CONTAINER_NAME" \
  HOST_PORT="$SOURCE_HOST_PORT" \
  BACKUP_DIR="$BACKUP_DIR" \
  BACKUP_PREFIX="$BACKUP_PREFIX" \
  BACKUP_TIMESTAMP="$BACKUP_TIMESTAMP" \
  "$ROOT_DIR/scripts/podman-poc.sh" backup

if [[ ! -s "$backup_file" ]]; then
  echo "[restore-verify] backup file is missing or empty: $backup_file" >&2
  exit 1
fi
if [[ ! -s "$globals_file" ]]; then
  echo "[restore-verify] globals file is missing or empty: $globals_file" >&2
  exit 1
fi

echo "[2/4] reset verify container"
CONTAINER_NAME="$VERIFY_CONTAINER_NAME" \
  HOST_PORT="$VERIFY_HOST_PORT" \
  "$ROOT_DIR/scripts/podman-poc.sh" stop || true

echo "[3/4] restore into verify container"
CONTAINER_NAME="$VERIFY_CONTAINER_NAME" \
  HOST_PORT="$VERIFY_HOST_PORT" \
  BACKUP_FILE="$backup_file" \
  BACKUP_GLOBALS_FILE="$globals_file" \
  BACKUP_DIR="$BACKUP_DIR" \
  BACKUP_PREFIX="$BACKUP_PREFIX" \
  RESTORE_CONFIRM=1 \
  RESTORE_CLEAN=1 \
  "$ROOT_DIR/scripts/podman-poc.sh" restore

echo "[4/4] run integrity checks"
CONTAINER_NAME="$VERIFY_CONTAINER_NAME" \
  HOST_PORT="$VERIFY_HOST_PORT" \
  "$ROOT_DIR/scripts/podman-poc.sh" check

END_EPOCH="$(date +%s)"
DURATION="$((END_EPOCH - START_EPOCH))"
echo "[restore-verify] success (duration: ${DURATION}s)"

if [[ "$KEEP_VERIFY_CONTAINER" == "1" ]]; then
  echo "[restore-verify] KEEP_VERIFY_CONTAINER=1; leaving verify container running"
else
  CONTAINER_NAME="$VERIFY_CONTAINER_NAME" \
    HOST_PORT="$VERIFY_HOST_PORT" \
    "$ROOT_DIR/scripts/podman-poc.sh" stop
fi

echo "[restore-verify] completed: $(date -Is)"

