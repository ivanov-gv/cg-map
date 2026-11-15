#!/usr/bin/env bash
# Fake `curl` for find-pages-artifact tests.
# Reads configuration from files in FAKE_CURL_DIR:
#   compare-main-<sha>   — JSON response for compare/main...<sha> (status field)
#   runs-head-sha-<sha>  — JSON response for actions/runs?head_sha=<sha>
#   run-detail-<id>      — JSON response for actions/runs/<id>
#   commit-main          — JSON response for commits/main (sha field)
#
# Usage: fake-curl.sh [options] URL
# Options: --fail --silent --show-error --location --header ... are ignored.
set -euo pipefail
StubDirectory="${FAKE_CURL_DIR:-.}"

# Parse arguments to find the URL (last non-option argument).
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fail|--silent|--show-error|--location) shift ;;
    --header) shift 2 ;;
    *) url="$1"; shift ;;
  esac
done

# Route to the appropriate stub based on the URL.
if [[ "$url" == */compare/main\...* ]]; then
  # Extract the commit SHA after main...
  commit="${url##*main...}"
  stub="$StubDirectory/compare-main-$commit"
  if [ -f "$stub" ]; then
    cat "$stub"
  else
    echo '{"status":"behind"}'
  fi
elif [[ "$url" == */actions/runs\?head_sha=* ]]; then
  # Extract the SHA from the query string, stripping any trailing query params.
  commit="${url##*head_sha=}"
  commit="${commit%%&*}"
  stub="$StubDirectory/runs-head-sha-$commit"
  if [ -f "$stub" ]; then
    cat "$stub"
  else
    echo '{"workflow_runs":[]}'
  fi
elif [[ "$url" == */actions/runs/* ]]; then
  # Extract the run ID.
  run_id="${url##*/actions/runs/}"
  stub="$StubDirectory/run-detail-$run_id"
  if [ -f "$stub" ]; then
    cat "$stub"
  else
    echo '{"status":"completed","conclusion":"success"}'
  fi
elif [[ "$url" == */commits/main ]]; then
  stub="$StubDirectory/commit-main"
  if [ -f "$stub" ]; then
    cat "$stub"
  else
    echo '{"sha":"abc123"}'
  fi
else
  echo '{}'
fi
