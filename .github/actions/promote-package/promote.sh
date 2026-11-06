#!/usr/bin/env bash
# Publishes what CI already built and tested for a commit. Nothing is rebuilt: only package.json's version changes, and
# every other file is checked to be byte-identical before publishing.
set -euo pipefail

scope="${PACKAGE_NAME%%/*}"
source_version="0.0.0-dev.$RELEASE_COMMIT"
# A prerelease must never become what a plain install gets.
case "$RELEASE_VERSION" in
  *-*) channel=next ;;
  *) channel=latest ;;
esac

work_directory="$(mktemp -d)"
trap 'rm -rf "$work_directory"' EXIT
cd "$work_directory"
printf '%s:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n' "$scope" > .npmrc

if ! npm pack --silent "$PACKAGE_NAME@$source_version" > tarball-name; then
  echo "::error::No dev package $PACKAGE_NAME@$source_version. Release a commit that CI built on main."
  exit 1
fi
mkdir original promoted
tar -xzf "$(cat tarball-name)" -C original
tar -xzf "$(cat tarball-name)" -C promoted
cp .npmrc promoted/package/.npmrc
(cd promoted/package && npm pkg set version="$RELEASE_VERSION")

if ! diff --recursive --exclude=package.json --exclude=.npmrc original/package promoted/package; then
  echo "::error::Promoting would change more than package.json."
  exit 1
fi
version_free() { node -e "const p=JSON.parse(require('fs').readFileSync(process.argv[1]));delete p.version;console.log(JSON.stringify(p,Object.keys(p).sort()))" "$1"; }
if [ "$(version_free original/package/package.json)" != "$(version_free promoted/package/package.json)" ]; then
  echo "::error::Promoting would change more of package.json than its version."
  exit 1
fi

cd promoted/package
# shellcheck disable=SC2086 # PUBLISH_FLAGS is empty or one flag.
npm publish --ignore-scripts --tag "$channel" $PUBLISH_FLAGS
echo "Published $PACKAGE_NAME@$RELEASE_VERSION under $channel, from $source_version $PUBLISH_FLAGS" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
