# One image for browser test jobs on GitHub and for every local job under act: Chromium with its system packages, and the
# tools those jobs use. Published and versioned on its own: see docs/runbooks/release.md, "Releasing the browser image".
# These versions move first, in their own change. Then a release, then a PR that bumps the repository and the pin together.
ARG NODE_VERSION=24.19.0
FROM node:${NODE_VERSION}-slim AS node
FROM docker:29-cli@sha256:2357639ad1ea7d0194134bf3292622fd4e562483966ed674e5d7c945b5f3b28d AS docker

# The same system as the jobs on GitHub that do not run in this image.
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852
ARG PLAYWRIGHT_VERSION=1.56.1
LABEL org.opencontainers.image.source="https://github.com/ivanov-gv/cg-map" \
      org.opencontainers.image.description="Browser and workflow tools for cg-map CI and local act runs" \
      playwright.version="${PLAYWRIGHT_VERSION}"
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
# act's jobs build and push images through the host's Docker.
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
# A fixed path, because a job's container gets its own HOME.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_PATH=/usr/local/lib/node_modules
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
       ca-certificates curl git jq make python3 sudo tar unzip xz-utils zstd \
    && npm install --global "playwright@${PLAYWRIGHT_VERSION}" \
    && playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm \
    && git config --system --add safe.directory '*'
