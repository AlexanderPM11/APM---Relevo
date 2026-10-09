"""Admin API-key flows tested against an isolated in-memory SQLite database."""

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.api.routes as api_routes
import app.auth.dependencies as auth_dependencies
from app.core.config import Settings
from app.core.security import hash_password
from app.db.base import Base
from app.db.models import AdminUser
from app.db.session import get_session


@pytest_asyncio.fixture
async def api_client(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[AsyncClient]:
    """Provide real FastAPI routes backed by fresh, isolated SQLite tables."""
    settings = Settings(
        _env_file=None,
        jwt_secret=SecretStr("unit-test-jwt-secret-not-for-production"),
        api_key_pepper=SecretStr("unit-test-api-key-pepper"),
    )
    monkeypatch.setattr(api_routes, "get_settings", lambda: settings)
    monkeypatch.setattr(auth_dependencies, "get_settings", lambda: settings)

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def session_override() -> AsyncIterator[object]:
        async with session_factory() as session:
            yield session

    app = FastAPI()
    app.include_router(api_routes.router)
    app.dependency_overrides[get_session] = session_override
    async with session_factory() as session:
        session.add(
            AdminUser(
                email="admin@example.com",
                password_hash=hash_password("test-admin-password"),
                is_active=True,
            )
        )
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    await engine.dispose()


async def admin_token(client: AsyncClient) -> str:
    """Authenticate the test administrator and return a signed access token."""
    response = await client.post(
        "/admin/auth/login",
        json={"email": "admin@example.com", "password": "test-admin-password"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


@pytest.mark.asyncio
async def test_admin_login_rejects_wrong_password(api_client: AsyncClient) -> None:
    response = await api_client.post(
        "/admin/auth/login",
        json={"email": "admin@example.com", "password": "incorrect-password"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


@pytest.mark.asyncio
async def test_api_key_lifecycle_requires_admin_and_hides_saved_secret(
    api_client: AsyncClient,
) -> None:
    unauthorized = await api_client.get("/admin/api-keys")
    assert unauthorized.status_code == 401

    token = await admin_token(api_client)
    headers = {"Authorization": f"Bearer {token}"}
    created = await api_client.post(
        "/admin/api-keys",
        headers=headers,
        json={"name": "Portal interno", "owner": "Equipo web", "requests_per_minute": 24},
    )
    assert created.status_code == 201
    payload = created.json()
    assert payload["api_key"].startswith(f"rlv_{payload['prefix']}_")

    listing = await api_client.get("/admin/api-keys", headers=headers)
    assert listing.status_code == 200
    listed_key = listing.json()[0]
    assert listed_key == {
        "id": payload["id"],
        "name": "Portal interno",
        "prefix": payload["prefix"],
        "owner": "Equipo web",
        "is_active": True,
        "requests_per_minute": 24,
    }
    assert "api_key" not in listed_key
    assert payload["api_key"] not in listing.text

    revoked = await api_client.delete(f"/admin/api-keys/{payload['id']}", headers=headers)
    assert revoked.status_code == 204
    listing_after_revoke = await api_client.get("/admin/api-keys", headers=headers)
    assert listing_after_revoke.json()[0]["is_active"] is False


@pytest.mark.asyncio
async def test_api_key_rate_limit_must_be_positive(api_client: AsyncClient) -> None:
    token = await admin_token(api_client)
    response = await api_client.post(
        "/admin/api-keys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Portal", "requests_per_minute": 0},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_api_key_limits_match_the_admin_console(api_client: AsyncClient) -> None:
    token = await admin_token(api_client)
    headers = {"Authorization": f"Bearer {token}"}
    accepted = await api_client.post(
        "/admin/api-keys",
        headers=headers,
        json={"name": "A" * 120, "owner": "B" * 120, "requests_per_minute": 10000},
    )
    assert accepted.status_code == 201

    too_many_requests = await api_client.post(
        "/admin/api-keys",
        headers=headers,
        json={"name": "Portal", "requests_per_minute": 10001},
    )
    assert too_many_requests.status_code == 422

    owner_too_long = await api_client.post(
        "/admin/api-keys",
        headers=headers,
        json={"name": "Portal", "owner": "B" * 121},
    )
    assert owner_too_long.status_code == 422
