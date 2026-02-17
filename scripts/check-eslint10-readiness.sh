#!/usr/bin/env bash
set -euo pipefail

PLUGIN_PACKAGE="${TSESLINT_PLUGIN_PACKAGE:-@typescript-eslint/eslint-plugin}"
PLUGIN_VERSION="${TSESLINT_PLUGIN_VERSION:-latest}"
PARSER_PACKAGE="${TSESLINT_PARSER_PACKAGE:-@typescript-eslint/parser}"
PARSER_VERSION="${TSESLINT_PARSER_VERSION:-latest}"
REACT_PLUGIN_PACKAGE="${REACT_PLUGIN_PACKAGE:-eslint-plugin-react}"
REACT_PLUGIN_VERSION="${REACT_PLUGIN_VERSION:-latest}"
REACT_HOOKS_PLUGIN_PACKAGE="${REACT_HOOKS_PLUGIN_PACKAGE:-eslint-plugin-react-hooks}"
REACT_HOOKS_PLUGIN_VERSION="${REACT_HOOKS_PLUGIN_VERSION:-latest}"
STRICT="${STRICT:-1}"

read_npm_field() {
  local target="$1"
  local field="$2"
  npm view "${target}" "${field}" --json
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

contains_eslint10() {
  local range="$1"
  if [[ -z "${range}" ]]; then
    return 1
  fi
  # Use semver range evaluation to avoid false positives such as "^8.10.0" or "<10".
  if npx --yes semver -r "${range}" 10.0.0 >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

plugin_target="${PLUGIN_PACKAGE}@${PLUGIN_VERSION}"
parser_target="${PARSER_PACKAGE}@${PARSER_VERSION}"
react_plugin_target="${REACT_PLUGIN_PACKAGE}@${REACT_PLUGIN_VERSION}"
react_hooks_plugin_target="${REACT_HOOKS_PLUGIN_PACKAGE}@${REACT_HOOKS_PLUGIN_VERSION}"

plugin_resolved_version_json="$(read_npm_field "${plugin_target}" version)"
plugin_peer_eslint_json="$(read_npm_field "${plugin_target}" peerDependencies.eslint || echo 'null')"
parser_resolved_version_json="$(read_npm_field "${parser_target}" version)"
parser_peer_eslint_json="$(read_npm_field "${parser_target}" peerDependencies.eslint || echo 'null')"
react_plugin_resolved_version_json="$(read_npm_field "${react_plugin_target}" version)"
react_plugin_peer_eslint_json="$(read_npm_field "${react_plugin_target}" peerDependencies.eslint || echo 'null')"
react_hooks_plugin_resolved_version_json="$(read_npm_field "${react_hooks_plugin_target}" version)"
react_hooks_plugin_peer_eslint_json="$(read_npm_field "${react_hooks_plugin_target}" peerDependencies.eslint || echo 'null')"

plugin_resolved_version="$(normalize_json_scalar "${plugin_resolved_version_json}")"
plugin_peer_eslint="$(normalize_json_scalar "${plugin_peer_eslint_json}")"
parser_resolved_version="$(normalize_json_scalar "${parser_resolved_version_json}")"
parser_peer_eslint="$(normalize_json_scalar "${parser_peer_eslint_json}")"
react_plugin_resolved_version="$(normalize_json_scalar "${react_plugin_resolved_version_json}")"
react_plugin_peer_eslint="$(normalize_json_scalar "${react_plugin_peer_eslint_json}")"
react_hooks_plugin_resolved_version="$(normalize_json_scalar "${react_hooks_plugin_resolved_version_json}")"
react_hooks_plugin_peer_eslint="$(normalize_json_scalar "${react_hooks_plugin_peer_eslint_json}")"

plugin_supports=false
parser_supports=false
react_plugin_supports=false
react_hooks_plugin_supports=false
ready=false

if contains_eslint10 "${plugin_peer_eslint}"; then
  plugin_supports=true
fi
if contains_eslint10 "${parser_peer_eslint}"; then
  parser_supports=true
fi
if contains_eslint10 "${react_plugin_peer_eslint}"; then
  react_plugin_supports=true
fi
if contains_eslint10 "${react_hooks_plugin_peer_eslint}"; then
  react_hooks_plugin_supports=true
fi
if [[ "${plugin_supports}" == "true" ]] \
  && [[ "${parser_supports}" == "true" ]] \
  && [[ "${react_plugin_supports}" == "true" ]] \
  && [[ "${react_hooks_plugin_supports}" == "true" ]]; then
  ready=true
fi

echo "pluginTarget: ${plugin_target}"
echo "pluginVersion: ${plugin_resolved_version}"
echo "pluginPeerEslint: ${plugin_peer_eslint}"
echo "pluginSupportsEslint10: ${plugin_supports}"
echo "parserTarget: ${parser_target}"
echo "parserVersion: ${parser_resolved_version}"
echo "parserPeerEslint: ${parser_peer_eslint}"
echo "parserSupportsEslint10: ${parser_supports}"
echo "reactPluginTarget: ${react_plugin_target}"
echo "reactPluginVersion: ${react_plugin_resolved_version}"
echo "reactPluginPeerEslint: ${react_plugin_peer_eslint}"
echo "reactPluginSupportsEslint10: ${react_plugin_supports}"
echo "reactHooksPluginTarget: ${react_hooks_plugin_target}"
echo "reactHooksPluginVersion: ${react_hooks_plugin_resolved_version}"
echo "reactHooksPluginPeerEslint: ${react_hooks_plugin_peer_eslint}"
echo "reactHooksPluginSupportsEslint10: ${react_hooks_plugin_supports}"
echo "ready: ${ready}"

if [[ "${ready}" == "true" ]]; then
  echo "OK: eslint core + frontend plugins include eslint@10 in peerDependencies."
  exit 0
fi

echo "NG: eslint@10 is not supported by all required packages yet." >&2
if [[ "${STRICT}" == "1" ]]; then
  exit 2
fi
exit 0
