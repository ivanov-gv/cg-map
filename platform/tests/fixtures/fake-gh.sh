#!/usr/bin/env bash
# Fake `gh` CLI for ci-workflows test-run-evidence tests.
# Reads configuration from files in FAKE_GH_DIR:
#   pr-files          — newline-separated filenames for the PR files endpoint
#   contents-*.yml    — "404" to simulate not-on-main, "error" to simulate API failure on --jq .content,
#                       or raw YAML that gets base64-encoded when --jq .content is used
#   runs-*.yml        — JSON array of {displayTitle} objects for run listings
set -euo pipefail
D="${FAKE_GH_DIR:-.}"
cmd="$1"; shift
case "$cmd" in
  api)
    args=()
    jq_arg=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --paginate|--silent) shift ;;
        --jq) jq_arg="$2"; shift 2 ;;
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
          # When --jq .content is used, return base64-encoded YAML; otherwise return the JSON metadata.
          # A stub value of "error" simulates an API failure only for the --jq .content call.
          if [ "$jq_arg" = ".content" ]; then
            if [ "$content" = "error" ]; then
              echo "API error"
              exit 1
            fi
            echo "$content" | base64 -w 0
          else
            echo '{"name":"ci-publish.yml"}'
          fi
        else
          # Default: workflow exists on main with workflow_dispatch.
          if [ "$jq_arg" = ".content" ]; then
            printf 'name: ci-publish\non:\n  workflow_dispatch:\n' | base64 -w 0
          else
            echo '{"name":"ci-publish.yml"}'
          fi
        fi
        ;;
      *contents*ci-pr-checks*)
        if [ -f "$D/contents-ci-pr-checks.yml" ]; then
          content=$(cat "$D/contents-ci-pr-checks.yml")
          if echo "$content" | grep -q "HTTP 404"; then
            echo "$content"
            exit 1
          fi
          if [ "$jq_arg" = ".content" ]; then
            if [ "$content" = "error" ]; then
              echo "API error"
              exit 1
            fi
            echo "$content" | base64 -w 0
          else
            echo '{"name":"ci-pr-checks.yml"}'
          fi
        else
          # Default: workflow exists on main with workflow_dispatch.
          if [ "$jq_arg" = ".content" ]; then
            printf 'name: ci-pr-checks\non:\n  workflow_dispatch:\n' | base64 -w 0
          else
            echo '{"name":"ci-pr-checks.yml"}'
          fi
        fi
        ;;
      *contents*ci-dev-pages*)
        if [ -f "$D/contents-ci-dev-pages.yml" ]; then
          content=$(cat "$D/contents-ci-dev-pages.yml")
          if echo "$content" | grep -q "HTTP 404"; then
            echo "$content"
            exit 1
          fi
          if [ "$jq_arg" = ".content" ]; then
            if [ "$content" = "error" ]; then
              echo "API error"
              exit 1
            fi
            echo "$content" | base64 -w 0
          else
            echo '{"name":"ci-dev-pages.yml"}'
          fi
        else
          # Default: workflow exists on main with workflow_dispatch.
          if [ "$jq_arg" = ".content" ]; then
            printf 'name: ci-dev-pages\non:\n  workflow_dispatch:\n' | base64 -w 0
          else
            echo '{"name":"ci-dev-pages.yml"}'
          fi
        fi
        ;;
      *contents*cd-*)
        if [ -f "$D/contents-cd.yml" ]; then
          content=$(cat "$D/contents-cd.yml")
          if echo "$content" | grep -q "HTTP 404"; then
            echo "$content"
            exit 1
          fi
          if [ "$jq_arg" = ".content" ]; then
            if [ "$content" = "error" ]; then
              echo "API error"
              exit 1
            fi
            echo "$content" | base64 -w 0
          else
            echo '{"name":"cd.yml"}'
          fi
        else
          # Default: workflow exists on main with workflow_dispatch.
          if [ "$jq_arg" = ".content" ]; then
            printf 'name: cd\non:\n  workflow_dispatch:\n' | base64 -w 0
          else
            echo '{"name":"cd.yml"}'
          fi
        fi
        ;;
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
