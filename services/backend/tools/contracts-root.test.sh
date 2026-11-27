#!/bin/sh
# Tests run with backend checks, so they need no installed package and no other project's checkout.
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
resolver="$script_directory/contracts-root.sh"
makefile="$script_directory/../Makefile"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

assert_equal() {
  if [ "$2" != "$3" ]; then
    fail "$1: got $2, want $3"
  fi
}

assert_contains() {
  if ! grep -qF "$2" "$3"; then
    fail "$1: $3 does not contain $2"
  fi
}

assert_rejected() {
  if sh -c "$2" >/dev/null 2>&1; then
    fail "$1 was accepted"
  fi
}

temporary_root=$(mktemp -d)
trap 'rm -rf "$temporary_root"' EXIT
installed_root="$temporary_root/node_modules/@ivanov-gv/map-contracts"
head_root="$temporary_root/packages/contracts"
other_root="$temporary_root/other-contracts"
mkdir -p "$head_root/proto" "$installed_root/proto" "$other_root"
printf '%s\n' '{"devDependencies":{"@ivanov-gv/map-contracts":"0.1.0"}}' > "$temporary_root/package.json"
printf '%s\n' '{"name":"@ivanov-gv/map-contracts","version":"0.1.0"}' > "$installed_root/package.json"
export BACKEND_REPOSITORY_ROOT="$temporary_root"

assert_equal 'dev default' "$(sh "$resolver" dev)" "$head_root"
assert_equal 'dev override' "$(MAP_CONTRACTS_ROOT="$other_root" sh "$resolver" dev)" "$other_root"
assert_equal 'check pin' "$(MAP_CONTRACTS_ROOT="$other_root" sh "$resolver" pinned)" "$installed_root"
assert_equal 'release pin' "$(sh "$resolver" release)" "$installed_root"
assert_rejected 'release with another root' "MAP_CONTRACTS_ROOT='$other_root' sh '$resolver' release"
assert_rejected 'release with an empty root' "MAP_CONTRACTS_ROOT= sh '$resolver' release"
assert_rejected 'dev with an empty root' "MAP_CONTRACTS_ROOT= sh '$resolver' dev"

printf '%s\n' '{"name":"@ivanov-gv/map-contracts","version":"0.2.0"}' > "$installed_root/package.json"
assert_rejected 'release with a different installed version' "sh '$resolver' release"

assert_contains 'dev resolver in the Makefile' 'sh tools/contracts-root.sh dev' "$makefile"
assert_contains 'check resolver in the Makefile' 'sh tools/contracts-root.sh pinned' "$makefile"
assert_contains 'release resolver in the Makefile' 'sh tools/contracts-root.sh release' "$makefile"
assert_contains 'check target' 'check: format-check vet lint test build check-roots' "$makefile"
assert_contains 'release build' 'build-release: generate-check build' "$makefile"
echo 'contracts-root checks passed'
