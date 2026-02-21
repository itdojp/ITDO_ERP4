#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="${GITHUB_REPOSITORY:-itdojp/ITDO_ERP4}"
STRICT="${STRICT:-0}"
TOKEN_ENV_NAME="${TOKEN_ENV_NAME:-DEPENDABOT_ALERTS_TOKEN}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required" >&2
  exit 1
fi

if [[ "${REPOSITORY}" != */* ]]; then
  echo "Invalid GITHUB_REPOSITORY: ${REPOSITORY}" >&2
  exit 1
fi

if ! [[ "${TOKEN_ENV_NAME}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "Invalid TOKEN_ENV_NAME: ${TOKEN_ENV_NAME}" >&2
  exit 1
fi

REPO_OWNER="${REPOSITORY%%/*}"
REPO_NAME="${REPOSITORY##*/}"
TOKEN_ENV_VALUE="${!TOKEN_ENV_NAME:-}"
TOKEN_ENV_SET=false
if [[ -n "${TOKEN_ENV_VALUE}" ]]; then
  TOKEN_ENV_SET=true
fi

missing_token_reason() {
  if [[ "${TOKEN_ENV_NAME}" == "DEPENDABOT_ALERTS_TOKEN" ]]; then
    echo "MISSING_DEPENDABOT_ALERTS_TOKEN"
  else
    echo "MISSING_TOKEN"
  fi
}

reason="NONE"
ready=true
status=0
api_output=""

if [[ "${TOKEN_ENV_SET}" == "true" ]]; then
  set +e
  api_output="$(GH_TOKEN="${TOKEN_ENV_VALUE}" gh api "repos/${REPO_OWNER}/${REPO_NAME}/dependabot/alerts?per_page=1&state=open" --jq 'length' 2>&1)"
  status=$?
  set -e
else
  ready=false
  status=1
  reason="$(missing_token_reason)"
  api_output="Token environment variable ${TOKEN_ENV_NAME} is not set."
fi

if [[ "${status}" != "0" ]]; then
  ready=false
  if grep -qi 'Resource not accessible by integration' <<<"${api_output}"; then
    if [[ "${TOKEN_ENV_SET}" == "true" ]]; then
      reason="PERMISSION_DENIED"
    else
      reason="$(missing_token_reason)"
    fi
  elif grep -qi 'Bad credentials' <<<"${api_output}"; then
    reason="BAD_CREDENTIALS"
  elif grep -qi 'Could not resolve host' <<<"${api_output}"; then
    reason="NETWORK_ERROR"
  elif [[ "${reason}" == "NONE" ]]; then
    reason="UNKNOWN_FAILURE"
  fi
fi

echo "repository: ${REPOSITORY}"
echo "tokenEnvName: ${TOKEN_ENV_NAME}"
echo "tokenEnvSet: ${TOKEN_ENV_SET}"
echo "resultReason: ${reason}"
echo "ready: ${ready}"

if [[ "${status}" == "0" ]]; then
  echo "openAlertSampleCount: ${api_output}"
  echo "OK: token can access Dependabot alerts API."
else
  echo "apiError: ${api_output}" >&2
  echo "NG: token cannot access Dependabot alerts API." >&2
fi

if [[ "${ready}" != "true" ]] && [[ "${STRICT}" == "1" ]]; then
  exit 2
fi

exit 0
