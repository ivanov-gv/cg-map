#!/bin/sh
# Parallel sessions stay out of each other's way only if each works in its own worktree.
# The main checkout is for reading and pulling main, so commits there are rejected.
set -eu
git_dir=$(git rev-parse --absolute-git-dir)
common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
if [ "$git_dir" = "$common_dir" ]; then
  echo "Commits are not allowed in the main checkout." >&2
  echo "Create a worktree and commit there: make worktree NAME=<branch>" >&2
  exit 1
fi
