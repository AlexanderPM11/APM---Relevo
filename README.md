# Relevo

Relevo is an OpenAI-compatible API for routing chat requests across configurable model providers, with authentication, quotas, health tracking, and fallback.

The repository is under active implementation. See [the implementation plan](docs/PLAN.md), [architecture](docs/ARCHITECTURE.md), [decisions](docs/DECISIONS.md), and [blockers](docs/BLOCKERS.md).

## Development

Use Python 3.12 and Docker Compose. Copy `.env.example` to `.env`, replace the local passwords and security secrets, then start the stack with `docker compose up --build`. The API listens on port 8000. `/health` reports process liveness; `/docs` is available in development.

Install development dependencies with `python -m pip install -e '.[dev]'`. Run quality checks with `ruff check .`, `ruff format --check .`, `mypy app`, and `pytest`.

Provider catalog values in `config/models.seed.yaml` are configurable references. Verify provider model names, limits, and signup requirements against provider documentation before production use. Version 1 targets a single Uvicorn worker because in-process routing state is not shared between workers.
