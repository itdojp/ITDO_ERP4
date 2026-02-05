#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/gh-pr-export-comments.sh <pr_number> [out_dir]

Purpose:
  Export PR description, reviews, review comments (inline/suggestions), and issue comments
  without relying on `gh pr view --comments` (which can fail due to GraphQL field errors).

Output (default):
  tmp/pr-<pr_number>/{pr.json,issue-comments.json,review-comments.json,reviews.json,summary.md}

Rate limit retry (optional env):
  GH_API_RETRY_MAX=6
  GH_API_RETRY_SLEEP_SECONDS=2

Examples:
  ./scripts/gh-pr-export-comments.sh 123
  ./scripts/gh-pr-export-comments.sh 123 tmp/pr-123-custom
USAGE
}

is_rate_limited_error() {
  # gh prints errors to stderr; match common GitHub rate limit patterns.
  local err_file="$1"
  grep -qiE "HTTP 429|rate limit exceeded|secondary rate limit|abuse detection mechanism" "$err_file"
}

gh_api_with_retry() {
  local outfile="$1"
  shift

  local max_attempts="${GH_API_RETRY_MAX:-6}"
  local base_sleep_seconds="${GH_API_RETRY_SLEEP_SECONDS:-2}"
  local attempt=1

  local err_file
  err_file="$(mktemp -t gh-api-err.XXXXXX)"
  trap 'rm -f "$err_file"' RETURN

  while true; do
    if gh api "$@" >"$outfile" 2>"$err_file"; then
      return 0
    fi
    local exit_code=$?

    if ! is_rate_limited_error "$err_file"; then
      cat "$err_file" >&2
      return "$exit_code"
    fi

    if [[ "$attempt" -ge "$max_attempts" ]]; then
      cat "$err_file" >&2
      echo "Error: gh api failed after ${attempt} attempts." >&2
      return "$exit_code"
    fi

    local sleep_seconds=$((base_sleep_seconds * attempt))
    echo "rate limited: retrying in ${sleep_seconds}s (attempt ${attempt}/${max_attempts})" >&2
    sleep "$sleep_seconds"
    attempt=$((attempt + 1))
  done
}

pr_number="${1:-}"
out_dir="${2:-}"

if [[ "$pr_number" == "-h" || "$pr_number" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$pr_number" ]]; then
  usage
  exit 1
fi

if ! [[ "$pr_number" =~ ^[0-9]+$ ]] || [[ "$pr_number" -le 0 ]]; then
  echo "Error: pr_number must be a positive integer, got: '$pr_number'." >&2
  usage
  exit 1
fi

if [[ -z "$out_dir" ]]; then
  out_dir="$ROOT_DIR/tmp/pr-${pr_number}"
fi

if [[ "$out_dir" == -* ]]; then
  echo "Error: out_dir must not start with '-': '$out_dir'" >&2
  exit 1
fi
if [[ "$out_dir" == *".."* ]]; then
  echo "Error: out_dir must not contain '..': '$out_dir'" >&2
  exit 1
fi

mkdir -p "$out_dir"

repo="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
if [[ -z "$repo" || "$repo" != */* ]]; then
  echo "Error: failed to determine GitHub repository (expected OWNER/REPO), got: '$repo'." >&2
  exit 1
fi

pr_json="$out_dir/pr.json"
issue_comments_json="$out_dir/issue-comments.json"
review_comments_json="$out_dir/review-comments.json"
reviews_json="$out_dir/reviews.json"
summary_md="$out_dir/summary.md"

echo "Exporting PR #${pr_number} comments for ${repo}..."

echo "- fetching PR details"
gh_api_with_retry "$pr_json" "repos/${repo}/pulls/${pr_number}"
echo "- fetching issue comments"
gh_api_with_retry "$issue_comments_json" "repos/${repo}/issues/${pr_number}/comments" --paginate
echo "- fetching review comments (inline)"
gh_api_with_retry "$review_comments_json" "repos/${repo}/pulls/${pr_number}/comments" --paginate
echo "- fetching reviews"
gh_api_with_retry "$reviews_json" "repos/${repo}/pulls/${pr_number}/reviews" --paginate

exported_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if ! command -v jq >/dev/null 2>&1; then
  cat >"$summary_md" <<EOF
# PR export: #${pr_number}

- repo: ${repo}
- exportedAt(UTC): ${exported_at_utc}

Generated JSON files:
- ${pr_json}
- ${issue_comments_json}
- ${review_comments_json}
- ${reviews_json}

Note: jq is not available; summary rendering is skipped.
EOF
  echo "exported: $out_dir"
  exit 0
fi

{
  echo "# PR export: #${pr_number}"
  echo
  echo "- repo: ${repo}"
  echo "- exportedAt(UTC): ${exported_at_utc}"
  echo

  echo "## PR"
  jq -r '
    [
      "- title: " + (.title // ""),
      "- url: " + (.html_url // ""),
      "- state: " + (.state // ""),
      "- draft: " + ((.draft // false) | tostring),
      "- merged: " + ((.merged // false) | tostring),
      "- mergeable: " + ((.mergeable // "unknown") | tostring),
      "- mergeable_state: " + (.mergeable_state // ""),
      "- head: " + (.head.ref // "") + "@" + (.head.sha // ""),
      "- base: " + (.base.ref // "") + "@" + (.base.sha // "")
    ] | join("\n")
  ' "$pr_json"
  echo

  echo "## Description"
  jq -r '.body // ""' "$pr_json"
  echo

  echo "## Issue Comments"
  jq -r '"- count: \(length)"' "$issue_comments_json"
  echo
  jq -r '
    .[] |
    "### " + (.user.login // "unknown") + " (" + (.created_at // "") + ")\n" +
    "- url: " + (.html_url // "") + "\n\n" +
    (.body // "") + "\n"
  ' "$issue_comments_json"
  echo

  echo "## Reviews"
  jq -r '"- count: \(length)"' "$reviews_json"
  echo
  jq -r '
    .[] |
    "### " + (.user.login // "unknown") + " [" + (.state // "") + "] (" + (.submitted_at // "") + ")\n" +
    "- url: " + (.html_url // "") + "\n\n" +
    (.body // "") + "\n"
  ' "$reviews_json"
  echo

  echo "## Review Comments (Inline)"
  jq -r '"- count: \(length)"' "$review_comments_json"
  echo
  jq -r '
    .[] |
    "### " + (.user.login // "unknown") + " (" + (.created_at // "") + ")\n" +
    "- url: " + (.html_url // "") + "\n" +
    "- file: " + (.path // "") + "\n" +
    "- line: " + (if .line != null then (.line|tostring) elif .original_line != null then (.original_line|tostring) else "unknown" end) + "\n\n" +
    (.body // "") + "\n"
  ' "$review_comments_json"
} >"$summary_md"

echo "exported:"
echo "- $out_dir"
echo "- $summary_md"
