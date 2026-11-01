#!/bin/sh
# Create an isolated worktree for a parallel agent session: platform/tools/worktree.sh <name> [base]
# Worktrees live next to the repository (../<repo>.worktrees/<name>) so nothing lands in this checkout.
# Each worktree gets its own dist/, .build/, node_modules and ports (see platform/tools/dev-port.mjs).
set -eu
name=${1:?usage: worktree.sh <name> [base-branch]}
base=${2:-main}
root=$(git rev-parse --show-toplevel)
dir="$(dirname "$root")/$(basename "$root").worktrees/$name"
git -C "$root" worktree add -b "$name" "$dir" "$base"
cd "$dir"
make --no-print-directory setup
echo
echo "Worktree ready: $dir (branch $name)"
echo "  dev port $(node platform/tools/dev-port.mjs), e2e port $(node platform/tools/dev-port.mjs --e2e)"
echo "  Claude: cd \"$dir\" && claude"
echo "  Codex:  codex --cd \"$dir\"            (or --cd \"$dir/services/backend\" for Go-only work)"
echo "  Remove: git worktree remove \"$dir\" && git branch -d $name"
