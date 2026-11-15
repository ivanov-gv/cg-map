# Minimal image holding the dev Pages site. Built by ci-publish, pulled by cd-dev-pages.
# The site is assembled at build time: index.html, three app dist folders, and version.json.
FROM nginx:1.27-alpine@sha256:0c6fca1cddb10b5eb955f4b6fb4b823e1e0039bb7cd3e2ef5fdec26b5b501f80
COPY site /usr/share/nginx/html
EXPOSE 80
