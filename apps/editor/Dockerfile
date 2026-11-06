# This app's built artifact and the shared range-capable server. Build from the repository root after make build: only CI
# publishes it, and the dev Pages site is extracted from it.
FROM python:3.12-alpine@sha256:e064671ca452259bab50e8e2c7bd896e39e9a343bb06ca25234adf6fe18d0fc7
WORKDIR /app
COPY platform/tools/serve.py platform/tools/serve.py
COPY dist/editor dist/editor
USER nobody
EXPOSE 8080
ENTRYPOINT ["python3", "platform/tools/serve.py", "--host", "0.0.0.0", "--port", "8080", "--app", "editor"]
