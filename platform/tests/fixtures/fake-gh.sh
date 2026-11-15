#!/usr/bin/env bash
# Fake `gh` CLI for ci-workflows test-run-evidence tests.
# Reads configuration from files in FAKE_GH_DIR:
#   pr-files          — newline-separated filenames for the PR files endpoint
#   contents-*.yml    — "404" to simulate not-on-main, or any other content
#   runs-*.yml        — JSON array of {displayTitle} objects for run listings
set -euo pipefail
D="${FAKE_GH_DIR:-.}"
cmd="$1"; shift
case "$cmd" in
  api)
    args=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --paginate|--silent) shift ;;
        --jq) shift; shift ;;
        *) args+=("$1"); shift ;;
      esac
    done
    ep="${args[0]:-}"
    case "$ep" in
      *contents*ci-publish*)
        if [ -f "$D/contents-ci-publish.yml" ]; then
          content=$(cat "$D/contents-ci-publish.yml")
          if echo "$content" | grep -q "HTTP 404"; then
            echo "$content"
            exit 1
          fi
          echo "$content"
        else
          echo '{"name":"ci-publish.yml"}'
        fi
        ;;
      *contents*ci-pr-checks*) echo '{"name":"ci-pr-checks.yml"}' ;;
      *contents*cd-*) echo '{"name":"cd.yml"}' ;;
      *pulls/*/files*) [ -f "$D/pr-files" ] && cat "$D/pr-files" ;;
      *) echo "{}" ;;
    esac ;;
  run)
    wf=""
    jq_filter=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --workflow) wf="$2"; shift 2 ;;
        --commit|--event|--status|--json) shift 2 ;;
        --jq) jq_filter="$2"; shift 2 ;;
        -*) shift ;;
        *) shift ;;
      esac
    done
    run_file="$D/runs-$wf"
    data=$( [ -f "$run_file" ] && cat "$run_file" || echo '[]' )
    if [ -n "$jq_filter" ]; then
      echo "$data" | jq "$jq_filter"
    else
      echo "$data"
    fi
    ;;
esac
