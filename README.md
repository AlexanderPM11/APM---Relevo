# Relevo

Relevo is an OpenAI-compatible API for routing chat requests across configurable model providers, with authentication, quotas, health tracking, and fallback.

The repository is under active implementation. See [the implementation plan](docs/PLAN.md), [architecture](docs/ARCHITECTURE.md), [decisions](docs/DECISIONS.md), and [blockers](docs/BLOCKERS.md).

The complete verification and responsive interface roadmap is in [Relevo tests and UI plan from 0 to 100](docs/PLAN_PRUEBAS_Y_UX_0_A_100.md). It defines 100 test scenarios, current evidence, Playwright API and browser testing, device coverage, and delivery milestones.

## Development

Use Docker Compose. Copy `.env.example` to `.env`, replace the passwords and security secrets, and set `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the initial administrator. Then start the stack with `docker compose up --build`. The `web` service serves the React console on port 80 and proxies API requests to `app` over the private Compose network. For local browser access, temporarily add `ports: ["8080:80"]` to the `web` service and visit `http://localhost:8080`. In Dokploy, route your domain (for example, `relevo.polanco.com`) to the `web` service on port 80. The backend and MySQL have no host-published ports. `/health` reports backend liveness; `/docs` is available in development.

For front-end development, start the API on port 8000, then run `npm ci` and `npm run dev` from `web/`. Open `http://localhost:5173/console/`; Vite proxies API requests to the local server. In production, Nginx serves the React build and reverse-proxies `/admin`, `/v1`, `/health`, `/ready`, and `/console-config` to FastAPI over the internal Compose network.

Set `API_PUBLIC_BASE_URL` to the public API origin when Relevo is behind a proxy or has a separate public hostname. The connection guide reads this value from `/console-config`; when unset, it uses the origin received by FastAPI.

The console lets administrators create, list, search, and revoke user API keys. A new key's full secret is shown once; save it as `RELEVO_API_KEY` in the connecting application's server-side environment. The **Conectar una app** guide includes cURL, Node.js, and Python examples for the OpenAI-compatible `/v1/chat/completions` endpoint. Never put a Relevo key in browser code or commit it to source control.

Run backend unit and API-route tests with `.venv/Scripts/python -m pytest tests/unit`. They use isolated SQLite tables for the admin API. Run `npm run test:e2e` from `web/` for the browser and HTTP integration checks: Playwright starts FastAPI with a fresh in-memory SQLite database, a local mock provider, and Vite, so it does not touch the normal database or require provider credentials. UI scenarios run on Chromium, Firefox, and WebKit; API and chat-fallback scenarios run once on Chromium. The suite checks widths from 320–1440 px, axe accessibility, and keyboard focus. Results are written to `test-results/frontend-test-report.json`, with browser evidence in `output/playwright/`.

Run `npm run test:e2e:mysql` from `web/` to repeat the suite against a newly created MySQL 8 container. It uses a separate container and port 3337, applies Alembic migrations, and removes the container even when the suite fails. It does not connect to the normal Compose database. The MySQL path has passed with migrations and all three browser engines; the deployment image and real external providers are not part of this suite.

Run `npm run test:e2e:image` from `web/` to build a uniquely tagged disposable Docker image and test it against a separate MySQL database. The smoke check verifies migration startup, `/health`, `/ready`, the served React console, administrator access, browser-based key creation/chat/revocation, 429 fallback, restart persistence, allowed and denied CORS origins, MySQL backup/restore, and cleanup of the temporary image, containers, and network. It requires Docker Engine to be available.

Install development dependencies with `python -m pip install -e '.[dev]'`. Run quality checks with `ruff check .`, `ruff format --check .`, `mypy app`, and `pytest`.

Provider catalog values in `config/models.seed.yaml` are configurable references. Verify provider model names, limits, and signup requirements against provider documentation before production use. Version 1 targets a single Uvicorn worker because in-process routing state is not shared between workers.

The free-provider inventory, account requirements, included models, and setup steps are in [docs/FREE_PROVIDERS.md](docs/FREE_PROVIDERS.md). Add only the provider keys you choose to `.env`; Relevo routes across the configured providers and falls back when one is rate-limited or unavailable.
