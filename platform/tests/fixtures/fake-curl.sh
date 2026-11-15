#!/usr/bin/env bash
# Fake `curl` for find-pages-artifact tests.
# Reads configuration from files in FAKE_CURL_DIR:
#   compare-main-<sha>        — JSON response for compare/main...<sha> (status field)
#   artifacts-name-<name>     — JSON response for actions/artifacts?name=<name>
#   commit-main               — JSON response for commits/main (sha field)
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
elif [[ "$url" == */actions/artifacts\?name=* ]]; then
  # Extract the artifact name from the query string.
  name="${url##*name=}"
  name="${name%%&*}"
  stub="$StubDirectory/artifacts-name-$name"
  if [ -f "$stub" ]; then
    cat "$stub"
  else
    echo '{"artifacts":[]}'
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
