# Relevo

Relevo is an OpenAI-compatible API for routing chat requests across configurable model providers, with authentication, quotas, health tracking, and fallback.

The repository is under active implementation. See [the implementation plan](docs/PLAN.md), [architecture](docs/ARCHITECTURE.md), [decisions](docs/DECISIONS.md), and [blockers](docs/BLOCKERS.md).

The complete verification and responsive interface roadmap is in [Relevo tests and UI plan from 0 to 100](docs/PLAN_PRUEBAS_Y_UX_0_A_100.md). It defines 100 test scenarios, current evidence, Playwright API and browser testing, device coverage, and delivery milestones.

## Development

Use Python 3.12 and Docker Compose. Copy `.env.example` to `.env`, replace the local passwords and security secrets, and set `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the initial administrator. Then start the stack with `docker compose up --build`. The API listens on port 8000 and the administrative console is available at `http://localhost:8000/console/`. `/health` reports process liveness; `/docs` is available in development.

For front-end development, start the API on port 8000, then run `npm ci` and `npm run dev` from `web/`. Open `http://localhost:5173/console/`; Vite proxies API requests to the local server. In the production Docker image, the React build is served by FastAPI on the same origin, so no separate front-end service or CORS configuration is required.

Set `API_PUBLIC_BASE_URL` to the public API origin when Relevo is behind a proxy or has a separate public hostname. The connection guide reads this value from `/console-config`; when unset, it uses the origin received by FastAPI.

The console lets administrators create, list, search, and revoke user API keys. A new key's full secret is shown once; save it as `RELEVO_API_KEY` in the connecting application's server-side environment. The **Conectar una app** guide includes cURL, Node.js, and Python examples for the OpenAI-compatible `/v1/chat/completions` endpoint. Never put a Relevo key in browser code or commit it to source control.

Run backend unit and API-route tests with `.venv/Scripts/python -m pytest tests/unit`. They use isolated SQLite tables for the admin API. Run `npm run test:e2e` from `web/` for the browser and HTTP integration checks: Playwright starts FastAPI with a fresh in-memory SQLite database and starts Vite, so it does not touch the normal database or require provider credentials. Four UI scenarios use mocked responses; browser-to-FastAPI and API scenarios use the real local backend. The suite checks 320–1440 px widths, axe accessibility, and keyboard focus. Results are written to `test-results/frontend-test-report.json`, with browser evidence in `output/playwright/`.

The Playwright API and browser integration uses this disposable database instead of MySQL. Run the separate MySQL deployment and migration checks when Docker or an isolated MySQL test service is available.

Install development dependencies with `python -m pip install -e '.[dev]'`. Run quality checks with `ruff check .`, `ruff format --check .`, `mypy app`, and `pytest`.

Provider catalog values in `config/models.seed.yaml` are configurable references. Verify provider model names, limits, and signup requirements against provider documentation before production use. Version 1 targets a single Uvicorn worker because in-process routing state is not shared between workers.

The free-provider inventory, account requirements, included models, and setup steps are in [docs/FREE_PROVIDERS.md](docs/FREE_PROVIDERS.md). Add only the provider keys you choose to `.env`; Relevo routes across the configured providers and falls back when one is rate-limited or unavailable.
