#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="${GITHUB_REPOSITORY:-itdojp/ITDO_ERP4}"
ALERT_LOW_NUMBER="${ALERT_LOW_NUMBER:-10}"
ALERT_HIGH_NUMBER="${ALERT_HIGH_NUMBER:-11}"
BACKEND_LOCKFILE="${BACKEND_LOCKFILE:-packages/backend/package-lock.json}"
QS_PATCH_MIN_VERSION="${QS_PATCH_MIN_VERSION:-6.14.2}"
FAST_XML_PATCH_MIN_VERSION="${FAST_XML_PATCH_MIN_VERSION:-5.3.6}"
STRICT="${STRICT:-0}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

if [[ "${REPOSITORY}" != */* ]]; then
  echo "Invalid GITHUB_REPOSITORY: ${REPOSITORY}" >&2
  exit 1
fi

REPO_OWNER="${REPOSITORY%%/*}"
REPO_NAME="${REPOSITORY##*/}"

read_alert() {
  local alert_number="$1"
  gh api "repos/${REPO_OWNER}/${REPO_NAME}/dependabot/alerts/${alert_number}" \
    --jq '{
      number: .number,
      state: ((.state // "unknown") | ascii_upcase),
      vulnerableManifestPath: (.dependency.manifest_path // ""),
      vulnerableRequirements: (.security_vulnerability.vulnerable_version_range // ""),
      securityVulnerability: {
        severity: ((.security_vulnerability.severity // "") | ascii_upcase),
        package: {
          name: (.dependency.package.name // "")
        },
        firstPatchedVersion: {
          identifier: (.security_vulnerability.first_patched_version.identifier // "")
        }
      },
      securityAdvisory: {
        ghsaId: (.security_advisory.ghsa_id // ""),
        summary: (.security_advisory.summary // "")
      }
    }'
}

normalize_json_scalar() {
  node -e '
const raw = process.argv[1];
try {
  const value = JSON.parse(raw);
  if (value == null) process.stdout.write("");
  else if (typeof value === "string") process.stdout.write(value);
  else process.stdout.write(String(value));
} catch {
  process.stdout.write(raw.replace(/^"|"$/g, ""));
}
' "$1"
}

version_gte() {
  node -e '
const left = process.argv[1];
const right = process.argv[2];
if (!left || !right) process.exit(1);
const toParts = (value) => value.split(".").map((part) => {
  const normalized = String(part || "").replace(/[^0-9].*$/, "");
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : 0;
});
const l = toParts(left);
const r = toParts(right);
const max = Math.max(l.length, r.length);
for (let i = 0; i < max; i += 1) {
  const lv = l[i] ?? 0;
  const rv = r[i] ?? 0;
  if (lv > rv) process.exit(0);
  if (lv < rv) process.exit(1);
}
process.exit(0);
' "$1" "$2"
}

read_lock_versions() {
  local lockfile="$1"
  node -e '
const fs = require("node:fs");
const lockfile = process.argv[1];
const raw = fs.readFileSync(lockfile, "utf8");
const lock = JSON.parse(raw);
const packages = lock.packages || {};
const readVersion = (name) => String((packages[`node_modules/${name}`] || {}).version || "");
const payload = {
  googleapis: readVersion("googleapis"),
  googleapisCommon: readVersion("googleapis-common"),
  qs: readVersion("qs"),
  fastXmlParser: readVersion("fast-xml-parser"),
};
process.stdout.write(JSON.stringify(payload));
' "${lockfile}"
}

read_latest_version() {
  local pkg="$1"
  local raw
  raw="$(npm view "${pkg}" version --json 2>/dev/null || echo 'null')"
  normalize_json_scalar "${raw}"
}

alert_low_json="$(read_alert "${ALERT_LOW_NUMBER}")"
alert_high_json="$(read_alert "${ALERT_HIGH_NUMBER}")"
lock_versions_json="$(read_lock_versions "${BACKEND_LOCKFILE}")"

alert_low_state="$(echo "${alert_low_json}" | jq -r '.state // "UNKNOWN"')"
alert_low_severity="$(echo "${alert_low_json}" | jq -r '.securityVulnerability.severity // ""')"
alert_low_package="$(echo "${alert_low_json}" | jq -r '.securityVulnerability.package.name // ""')"
alert_low_ghsa="$(echo "${alert_low_json}" | jq -r '.securityAdvisory.ghsaId // ""')"
alert_low_requirements="$(echo "${alert_low_json}" | jq -r '.vulnerableRequirements // ""')"

alert_high_state="$(echo "${alert_high_json}" | jq -r '.state // "UNKNOWN"')"
alert_high_severity="$(echo "${alert_high_json}" | jq -r '.securityVulnerability.severity // ""')"
alert_high_package="$(echo "${alert_high_json}" | jq -r '.securityVulnerability.package.name // ""')"
alert_high_ghsa="$(echo "${alert_high_json}" | jq -r '.securityAdvisory.ghsaId // ""')"
alert_high_requirements="$(echo "${alert_high_json}" | jq -r '.vulnerableRequirements // ""')"

googleapis_current="$(echo "${lock_versions_json}" | jq -r '.googleapis')"
googleapis_common_current="$(echo "${lock_versions_json}" | jq -r '.googleapisCommon')"
qs_current="$(echo "${lock_versions_json}" | jq -r '.qs')"
fast_xml_current="$(echo "${lock_versions_json}" | jq -r '.fastXmlParser')"

googleapis_latest="$(read_latest_version "googleapis")"
googleapis_common_latest="$(read_latest_version "googleapis-common")"

qs_patched=false
if version_gte "${qs_current}" "${QS_PATCH_MIN_VERSION}"; then
  qs_patched=true
fi

fast_xml_patched=false
if version_gte "${fast_xml_current}" "${FAST_XML_PATCH_MIN_VERSION}"; then
  fast_xml_patched=true
fi

upstream_updated=false
if [[ -n "${googleapis_latest}" ]] && [[ -n "${googleapis_current}" ]] && [[ "${googleapis_latest}" != "${googleapis_current}" ]]; then
  upstream_updated=true
fi
if [[ -n "${googleapis_common_latest}" ]] && [[ -n "${googleapis_common_current}" ]] && [[ "${googleapis_common_latest}" != "${googleapis_common_current}" ]]; then
  upstream_updated=true
fi

action_required=false
if [[ "${alert_high_state}" == "OPEN" ]]; then
  action_required=true
fi
if [[ "${alert_low_state}" == "OPEN" ]] && [[ "${qs_patched}" != "true" ]]; then
  action_required=true
fi
if [[ "${upstream_updated}" == "true" ]]; then
  action_required=true
fi

echo "alertLowNumber: ${ALERT_LOW_NUMBER}"
echo "alertLowState: ${alert_low_state}"
echo "alertLowSeverity: ${alert_low_severity}"
echo "alertLowPackage: ${alert_low_package}"
echo "alertLowGhsa: ${alert_low_ghsa}"
echo "alertLowVulnerableRequirements: ${alert_low_requirements}"
echo "alertHighNumber: ${ALERT_HIGH_NUMBER}"
echo "alertHighState: ${alert_high_state}"
echo "alertHighSeverity: ${alert_high_severity}"
echo "alertHighPackage: ${alert_high_package}"
echo "alertHighGhsa: ${alert_high_ghsa}"
echo "alertHighVulnerableRequirements: ${alert_high_requirements}"
echo "googleapisCurrent: ${googleapis_current}"
echo "googleapisLatest: ${googleapis_latest}"
echo "googleapisCommonCurrent: ${googleapis_common_current}"
echo "googleapisCommonLatest: ${googleapis_common_latest}"
echo "qsResolvedVersion: ${qs_current}"
echo "qsPatched: ${qs_patched}"
echo "fastXmlResolvedVersion: ${fast_xml_current}"
echo "fastXmlPatched: ${fast_xml_patched}"
echo "upstreamUpdated: ${upstream_updated}"
echo "actionRequired: ${action_required}"

if [[ "${action_required}" == "true" ]]; then
  echo "NG: Dependabot alerts require follow-up." >&2
  if [[ "${STRICT}" == "1" ]]; then
    exit 2
  fi
  exit 0
fi

echo "OK: alerts are stable and patched versions are resolved."
exit 0
