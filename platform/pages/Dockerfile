# Minimal image holding the dev Pages site. Built by ci-publish, pulled by cd-dev-pages.
# The site is assembled at build time: index.html, three app dist folders, and version.json.
# This image only carries files — it never runs as a service. cd-dev-pages extracts /site/ with
# `docker cp`, so the image does not need a runtime. FROM scratch produces the smallest possible
# image (no OS, no nginx binary). The build context is the site/ directory itself, so COPY . /site
# copies all assembled files into the image.
FROM scratch
COPY . /site

# docker create requires a CMD entrypoint; without it the command fails.
# The value is never executed — it only satisfies the container runtime.
CMD ["/site"]
