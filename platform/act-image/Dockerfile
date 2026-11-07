# What act runs local workflow jobs on: its usual runner image with the browser and its system packages already there, so
# a local job spends its time limit on the job. Only for local runs: make test-<workflow> builds it from package-lock.json.
FROM catthehacker/ubuntu:act-24.04@sha256:c58e2b364da03b0c804c7d660f2ecbedf2f221a382b9baa0b344b0144780ff43
ARG PLAYWRIGHT_VERSION
RUN npx --yes "playwright@${PLAYWRIGHT_VERSION}" install --with-deps chromium \
    && rm -rf /root/.npm
