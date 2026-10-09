"""Unit tests for OpenAI-compatible streaming in POST /v1/chat/completions."""

import json
from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio
import respx
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.api.routes as api_routes
import app.auth.dependencies as auth_dependencies
from app.core.config import Settings
from app.core.security import hash_api_key
from app.db.base import Base
from app.db.models import ApiKey, Model, Provider
from app.db.session import get_session


@pytest_asyncio.fixture
async def streaming_client(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[AsyncClient]:
    """FastAPI test client configured with an active provider, model, and API key."""
    settings = Settings(
        _env_file=None,
        jwt_secret=SecretStr("unit-test-jwt-secret-not-for-production"),
        api_key_pepper=SecretStr("unit-test-api-key-pepper"),
    )
    monkeypatch.setattr(settings, "groq_api_key", SecretStr("test-provider-key"))
    monkeypatch.setattr(api_routes, "get_settings", lambda: settings)
    monkeypatch.setattr(auth_dependencies, "get_settings", lambda: settings)

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(api_routes, "SessionLocal", session_factory)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def session_override() -> AsyncIterator[object]:
        async with session_factory() as session:
            yield session

    app = FastAPI()
    app.include_router(api_routes.router)
    app.dependency_overrides[get_session] = session_override
    app.state.laya_client = None

    async with session_factory() as session:
        provider = Provider(
            slug="groq",
            name="Groq",
            base_url="https://api.groq.example/openai/v1",
            env_key_name="GROQ_API_KEY",
            is_enabled=True,
            adapter="openai",
        )
        session.add(provider)
        await session.flush()
        model = Model(
            provider_id=provider.id,
            name="llama-3.3-70b-versatile",
            capabilities=["text"],
            is_enabled=True,
            priority=1,
            tier=1,
        )
        session.add(model)

        raw_key = "rlv_test_secret1234567890"
        api_key = ApiKey(
            name="Test Key",
            prefix="test",
            key_hash=hash_api_key(raw_key, settings.api_key_pepper.get_secret_value()),
            is_active=True,
        )
        session.add(api_key)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    await engine.dispose()


@pytest.mark.asyncio
async def test_chat_completions_streaming_success(streaming_client: AsyncClient) -> None:
    """POST /v1/chat/completions with stream=true streams OpenAI chunks and [DONE]."""
    mock_frames = [
        {"choices": [{"index": 0, "delta": {"content": "Hola"}, "finish_reason": None}]},
        {"choices": [{"index": 0, "delta": {"content": " mundo"}, "finish_reason": None}]},
        {
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 2, "total_tokens": 6},
        },
        "[DONE]",
    ]
    sse_body = (
        "\n\n".join(
            f"data: {frame if isinstance(frame, str) else json.dumps(frame)}"
            for frame in mock_frames
        )
        + "\n\n"
    )

    with respx.mock(assert_all_called=True) as mock:
        mock.post("https://api.groq.example/openai/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                headers={"Content-Type": "text/event-stream"},
                content=sse_body,
            )
        )
        response = await streaming_client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer rlv_test_secret1234567890"},
            json={
                "model": "llama-3.3-70b-versatile",
                "messages": [{"role": "user", "content": "Di hola"}],
                "stream": True,
            },
        )

    assert response.status_code == 200
    assert "text/event-stream" in response.headers["Content-Type"]
    assert response.headers["X-Relevo-Model"] == "llama-3.3-70b-versatile"
    assert response.headers["X-Relevo-Provider"] == "groq"

    lines = [line.strip() for line in response.text.split("\n") if line.strip()]
    data_lines = [line for line in lines if line.startswith("data:")]

    assert len(data_lines) >= 3
    # Check that the last line is data: [DONE]
    assert data_lines[-1] == "data: [DONE]"

    # Parse JSON chunks
    chunks = [json.loads(line[5:].strip()) for line in data_lines[:-1]]
    assert all(c["object"] == "chat.completion.chunk" for c in chunks)
    content_deltas = [
        c["choices"][0]["delta"].get("content")
        for c in chunks
        if "content" in c["choices"][0]["delta"]
    ]
    assert content_deltas == ["Hola", " mundo"]


@pytest.mark.asyncio
async def test_chat_completions_streaming_error_before_first_byte(
    streaming_client: AsyncClient,
) -> None:
    """When the provider returns an error before any chunks, an HTTP error status is returned."""
    with respx.mock(assert_all_called=True) as mock:
        mock.post("https://api.groq.example/openai/v1/chat/completions").mock(
            return_value=httpx.Response(503, json={"error": "service unavailable"})
        )
        response = await streaming_client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer rlv_test_secret1234567890"},
            json={
                "model": "llama-3.3-70b-versatile",
                "messages": [{"role": "user", "content": "Test"}],
                "stream": True,
            },
        )

    assert response.status_code == 503
    assert "text/event-stream" not in response.headers.get("Content-Type", "")
