#!/bin/sh
# The one place the backend resolves shared contracts for generation. Dev reads this commit; checks and releases read
# the installed pin. BACKEND_REPOSITORY_ROOT is a test seam: it points at a checkout-shaped temporary root.
set -eu

mode=${1:-dev}
case "$mode" in
  dev|pinned|release) ;;
  *) echo "usage: contracts-root.sh [dev|pinned|release]" >&2; exit 2 ;;
esac

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=${BACKEND_REPOSITORY_ROOT:-$(CDPATH= cd -- "$script_directory/../../.." && pwd)}
installed_root="$repository_root/node_modules/@ivanov-gv/map-contracts"

if [ "$mode" = pinned ] || [ "$mode" = release ]; then
  if [ ! -f "$installed_root/package.json" ]; then
    echo "Cannot resolve the pinned @ivanov-gv/map-contracts package; run make setup" >&2
    exit 1
  fi
  pinned_version=$(sed -n 's/.*"@ivanov-gv\/map-contracts"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$repository_root/package.json")
  installed_version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$installed_root/package.json")
  if [ -z "$pinned_version" ] || [ "$pinned_version" != "$installed_version" ]; then
    echo "Installed @ivanov-gv/map-contracts is $installed_version, not pinned $pinned_version" >&2
    exit 1
  fi
  if [ "$mode" = release ] && [ "${MAP_CONTRACTS_ROOT+x}" = x ]; then
    echo "A release build must use the pinned @ivanov-gv/map-contracts, not MAP_CONTRACTS_ROOT=$MAP_CONTRACTS_ROOT" >&2
    exit 1
  fi
  printf '%s\n' "$installed_root"
  exit 0
fi

if [ "${MAP_CONTRACTS_ROOT+x}" = x ] && [ -z "${MAP_CONTRACTS_ROOT:-}" ]; then
  echo 'MAP_CONTRACTS_ROOT is set but empty' >&2
  exit 1
fi
if [ -n "${MAP_CONTRACTS_ROOT:-}" ]; then
  if ! selected_root=$(CDPATH= cd -- "$MAP_CONTRACTS_ROOT" && pwd -P); then
    echo "MAP_CONTRACTS_ROOT does not name a directory: $MAP_CONTRACTS_ROOT" >&2
    exit 1
  fi
  printf '%s\n' "$selected_root"
  exit 0
fi
printf '%s\n' "$repository_root/packages/contracts"
