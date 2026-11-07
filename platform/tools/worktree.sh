#!/bin/sh
# Create an isolated worktree for a parallel agent session: platform/tools/worktree.sh <name> [base]
# Worktrees live next to the repository (../<repo>.worktrees/<name>) so nothing lands in this checkout.
# Each worktree gets its own dist/, .build/, node_modules and ports (see platform/tools/dev-port.mjs).
set -eu
# An existing branch, such as one a cloud session is told to use, is checked out as it is; base applies only to new ones.
name=${1:?usage: worktree.sh <name> [base-branch]}
base=${2:-main}
root=$(git rev-parse --show-toplevel)
dir="$(dirname "$root")/$(basename "$root").worktrees/$name"
if git -C "$root" show-ref --verify --quiet "refs/heads/$name"; then
  git -C "$root" worktree add "$dir" "$name"
else
  git -C "$root" worktree add -b "$name" "$dir" "$base"
fi
cd "$dir"
make --no-print-directory setup
echo
echo "Worktree ready: $dir (branch $name)"
echo "  dev port $(node platform/tools/dev-port.mjs), e2e port $(node platform/tools/dev-port.mjs --e2e)"
echo "  Claude: cd \"$dir\" && claude"
echo "  Codex:  codex --cd \"$dir\"            (or --cd \"$dir/services/backend\" for Go-only work)"
echo "  Remove: git worktree remove \"$dir\" && git branch -d $name"
