FROM python:3.12-slim AS builder
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /build
COPY pyproject.toml ./
COPY app ./app
RUN python -m pip install --upgrade pip && python -m pip install --prefix=/install .

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/usr/local/bin:$PATH"
WORKDIR /app
RUN groupadd --system relevo && useradd --system --gid relevo --home-dir /app relevo
COPY --from=builder /install /usr/local
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini pyproject.toml ./
COPY config ./config
COPY scripts/entrypoint.sh ./scripts/entrypoint.sh
RUN chmod 755 ./scripts/entrypoint.sh && chown -R relevo:relevo /app
USER relevo
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"
ENTRYPOINT ["./scripts/entrypoint.sh"]
