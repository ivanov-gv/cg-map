#!/usr/bin/env bash
# Fake `gh` CLI for ci-workflows test-run-evidence tests.
# Reads configuration from files in FAKE_GH_DIR:
#   pr-files           — newline-separated filenames for the PR files endpoint
#   contents-*.yml     — "HTTP 404" to simulate not-on-main, "error" to simulate a non-404 API failure,
#                        or raw YAML that gets base64-encoded when --jq .content is used
#   runs-*.yml         — JSON array of {displayTitle} objects for run listings
set -euo pipefail
StubDirectory="${FAKE_GH_DIR:-.}"

# Handle the contents endpoint for any workflow file.
# Returns base64-encoded YAML when jq_argument is ".content", JSON metadata otherwise.
# A stub of "HTTP 404" simulates a missing workflow; "error" simulates a non-404 API failure.
serve_contents() {
  local workflow_name="$1"
  local jq_argument="$2"
  local stub_file="$StubDirectory/contents-${workflow_name}"

  local content
  if [ -f "$stub_file" ]; then
    content=$(cat "$stub_file")
    if echo "$content" | grep -q "HTTP 404"; then
      echo "$content"
      exit 1
    fi
  else
    # Default: workflow exists on main with workflow_dispatch.
    content="name: ${workflow_name%.yml}
on:
  workflow_dispatch:
"
  fi

  if [ "$jq_argument" = ".content" ]; then
    if [ "$content" = "error" ]; then
      echo "API error"
      exit 1
    fi
    echo "$content" | base64 -w 0
  else
    echo "{\"name\":\"${workflow_name}\"}"
  fi
}

cmd="$1"; shift
case "$cmd" in
  api)
    args=()
    jq_argument=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --paginate|--silent) shift ;;
        --jq) jq_argument="$2"; shift 2 ;;
        *) args+=("$1"); shift ;;
      esac
    done
    endpoint="${args[0]:-}"
    case "$endpoint" in
      *contents*ci-publish*)
        serve_contents "ci-publish.yml" "$jq_argument"
        ;;
      *contents*ci-pr-checks*)
        serve_contents "ci-pr-checks.yml" "$jq_argument"
        ;;
      *contents*ci-dev-pages*)
        serve_contents "ci-dev-pages.yml" "$jq_argument"
        ;;
      *contents*cd-*)
        serve_contents "cd.yml" "$jq_argument"
        ;;
      *pulls/*/files*) [ -f "$StubDirectory/pr-files" ] && cat "$StubDirectory/pr-files" ;;
      *) echo "{}" ;;
    esac ;;
  run)
    workflow=""
    jq_filter=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --workflow) workflow="$2"; shift 2 ;;
        --commit|--event|--status|--json) shift 2 ;;
        --jq) jq_filter="$2"; shift 2 ;;
        -*) shift ;;
        *) shift ;;
      esac
    done
    run_file="$StubDirectory/runs-$workflow"
    data=$( [ -f "$run_file" ] && cat "$run_file" || echo '[]' )
    if [ -n "$jq_filter" ]; then
      echo "$data" | jq "$jq_filter"
    else
      echo "$data"
    fi
    ;;
esac
