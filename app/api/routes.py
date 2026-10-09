"""Public OpenAI-compatible and administrator API endpoints."""

import time
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import require_admin, require_api_key
from app.auth.rate_limit import allow_request
from app.core.config import get_settings
from app.core.security import (
    create_access_token,
    generate_api_key,
    hash_api_key,
    verify_password,
)
from app.db.models import (
    AdminUser,
    ApiKey,
    Model,
    ModelHealth,
    ModelLimit,
    ModelUsage,
    Provider,
    RequestLog,
)
from app.db.session import get_session
from app.providers.base import ProviderError
from app.router.service import complete_with_fallback, provider_is_configured
from app.schemas.chat import ChatCompletionRequest

router = APIRouter()
SessionDep = Annotated[AsyncSession, Depends(get_session)]


class LoginRequest(BaseModel):
    """Administrator credentials."""

    email: EmailStr
    password: str


class ApiKeyCreate(BaseModel):
    """Consumer key metadata and per-minute cap."""

    name: str = Field(min_length=1, max_length=120)
    owner: str | None = Field(default=None, max_length=120)
    requests_per_minute: int = Field(default=60, gt=0, le=10000)


class PlaygroundChatRequest(ChatCompletionRequest):
    """Administrator playground request attributed to one consumer key."""

    api_key_id: int


class ProviderInput(BaseModel):
    """Provider metadata editable without exposing credentials."""

    name: str
    base_url: str
    env_key_name: str
    is_enabled: bool = True
    model_config = ConfigDict(extra="forbid")


class ModelInput(BaseModel):
    """Routable model metadata."""

    provider_id: int
    name: str
    alias: str | None = None
    priority: int = 100
    weight: int = 1
    context_max: int = 8192
    capabilities: list[str] = Field(default_factory=lambda: ["text"])
    is_enabled: bool = True
    tier: int = 3
    model_config = ConfigDict(extra="forbid")


def admin_guard() -> Any:
    """Return a dependency marker for protected admin routes."""
    return Depends(require_admin)


@router.post("/v1/chat/completions")
async def chat_completions(
    request: ChatCompletionRequest,
    response: Response,
    session: SessionDep,
    api_key: Annotated[ApiKey, Depends(require_api_key)],
) -> dict[str, Any]:
    """Route a chat request through available provider models."""
    if request.stream:
        raise HTTPException(501, "Streaming support is not available yet")
    settings = get_settings()
    payload = request.model_dump(exclude={"model", "stream"}, exclude_none=True)
    started = time.monotonic()
    try:
        completion, model, provider, attempts = await complete_with_fallback(
            session, settings, request.model, payload
        )
    except ProviderError as error:
        session.add(
            RequestLog(
                api_key_id=api_key.id,
                requested_model=request.model,
                attempts=error.attempts,
                status="error",
                latency_ms=int((time.monotonic() - started) * 1000),
                error_code=f"upstream_{error.status_code}",
            )
        )
        await session.commit()
        headers = {
            "Retry-After": str(error.retry_after or settings.router_cooldown_default_seconds)
        }
        raise HTTPException(error.status_code, error.message, headers=headers) from error
    response.headers["X-Relevo-Model"] = model.name
    response.headers["X-Relevo-Provider"] = provider.slug
    response.headers["X-Relevo-Attempts"] = str(attempts)
    usage = completion.get("usage", {})
    session.add(
        RequestLog(
            api_key_id=api_key.id,
            requested_model=request.model,
            final_model=model.name,
            attempts=attempts,
            status="success",
            latency_ms=int((time.monotonic() - started) * 1000),
            input_tokens=int(usage.get("prompt_tokens", 0)),
            output_tokens=int(usage.get("completion_tokens", 0)),
        )
    )
    await session.commit()
    completion["model"] = (
        request.model if request.model not in ("auto", model.alias) else model.alias or model.name
    )
    completion["relevo"] = {
        "model": model.name,
        "provider": provider.slug,
        "attempts": attempts,
    }
    return completion


@router.get("/v1/models")
async def available_models(
    session: SessionDep, _: Annotated[ApiKey, Depends(require_api_key)]
) -> dict[str, Any]:
    """List models whose provider currently has credentials configured."""
    settings = get_settings()
    result = await session.execute(
        select(Model, Provider)
        .join(Provider)
        .where(Model.is_enabled.is_(True), Provider.is_enabled.is_(True))
        .options(selectinload(Model.health))
    )
    now = datetime.now(UTC).replace(tzinfo=None)
    data = [
        {"id": model.alias or model.name, "object": "model", "owned_by": provider.slug}
        for model, provider in result.all()
        if provider.slug != "ollama" or settings.router_enable_local_fallback
        if provider_is_configured(settings, provider)
        if provider.adapter in {"openai", "google"}
        if model.health is None
        or model.health.cooldown_until is None
        or model.health.cooldown_until <= now
    ]
    return {"object": "list", "data": data}


@router.post("/admin/playground/chat", dependencies=[admin_guard()])
async def playground_chat(
    body: PlaygroundChatRequest, response: Response, session: SessionDep
) -> dict[str, Any]:
    """Run a real chat from the console, applying the selected key's limits and usage log."""
    api_key = await session.get(ApiKey, body.api_key_id)
    now = datetime.now(UTC).replace(tzinfo=None)
    if (
        api_key is None
        or not api_key.is_active
        or (api_key.expires_at and api_key.expires_at <= now)
    ):
        raise HTTPException(404, "Active API key not found")
    settings = get_settings()
    if not await allow_request(
        f"api-key:{api_key.id}", api_key.requests_per_minute, 60
    ):
        raise HTTPException(429, "API key rate limit exceeded", headers={"Retry-After": "60"})
    api_key.last_used_at = now
    payload = body.model_dump(exclude={"api_key_id", "model", "stream"}, exclude_none=True)
    started = time.monotonic()
    try:
        completion, model, provider, attempts = await complete_with_fallback(
            session, settings, body.model, payload
        )
    except ProviderError as error:
        session.add(
            RequestLog(
                api_key_id=api_key.id,
                requested_model=body.model,
                attempts=error.attempts,
                status="error",
                latency_ms=int((time.monotonic() - started) * 1000),
                error_code=f"upstream_{error.status_code}",
            )
        )
        await session.commit()
        raise HTTPException(error.status_code, error.message) from error
    usage = completion.get("usage", {})
    session.add(
        RequestLog(
            api_key_id=api_key.id,
            requested_model=body.model,
            final_model=model.name,
            attempts=attempts,
            status="success",
            latency_ms=int((time.monotonic() - started) * 1000),
            input_tokens=int(usage.get("prompt_tokens", 0)),
            output_tokens=int(usage.get("completion_tokens", 0)),
        )
    )
    await session.commit()
    response.headers["X-Relevo-Model"] = model.name
    response.headers["X-Relevo-Provider"] = provider.slug
    response.headers["X-Relevo-Attempts"] = str(attempts)
    completion["model"] = body.model if body.model != "auto" else model.alias or model.name
    completion["relevo"] = {"model": model.name, "provider": provider.slug, "attempts": attempts}
    return completion


@router.post("/admin/auth/login")
async def login(body: LoginRequest, request: Request, session: SessionDep) -> dict[str, str]:
    """Authenticate an administrator and issue a short-lived JWT."""
    host = request.client.host if request.client else "unknown"
    settings = get_settings()
    if not await allow_request(f"admin-login:{host}", settings.admin_login_attempt_limit, 300):
        raise HTTPException(429, "Too many login attempts", headers={"Retry-After": "300"})
    result = await session.execute(select(AdminUser).where(AdminUser.email == str(body.email)))
    admin = result.scalar_one_or_none()
    if (
        admin is None
        or not admin.is_active
        or not verify_password(body.password, admin.password_hash)
    ):
        raise HTTPException(401, "Invalid email or password")
    token = create_access_token(
        str(admin.email),
        settings.jwt_secret.get_secret_value(),
        settings.jwt_algorithm,
        settings.jwt_expire_minutes,
    )
    return {"access_token": token, "token_type": "bearer"}


@router.post("/admin/api-keys", dependencies=[admin_guard()], status_code=201)
async def create_api_key(body: ApiKeyCreate, session: SessionDep) -> dict[str, Any]:
    """Create a consumer API key and return its secret once."""
    key, prefix = generate_api_key()
    settings = get_settings()
    record = ApiKey(
        name=body.name,
        owner=body.owner,
        prefix=prefix,
        key_hash=hash_api_key(key, settings.api_key_pepper.get_secret_value()),
        requests_per_minute=body.requests_per_minute,
    )
    session.add(record)
    await session.commit()
    return {"id": record.id, "name": record.name, "prefix": prefix, "api_key": key}


@router.get("/admin/api-keys", dependencies=[admin_guard()])
async def list_api_keys(session: SessionDep) -> list[dict[str, Any]]:
    """List consumer key metadata without returning key digests."""
    result = await session.execute(select(ApiKey).order_by(ApiKey.id))
    return [
        {
            "id": key.id,
            "name": key.name,
            "prefix": key.prefix,
            "owner": key.owner,
            "is_active": key.is_active,
            "requests_per_minute": key.requests_per_minute,
        }
        for key in result.scalars()
    ]


@router.delete("/admin/api-keys/{key_id}", dependencies=[admin_guard()], status_code=204)
async def revoke_api_key(key_id: int, session: SessionDep) -> Response:
    """Revoke a consumer API key without deleting its audit record."""
    key = await session.get(ApiKey, key_id)
    if key is None:
        raise HTTPException(404, "API key not found")
    key.is_active = False
    await session.commit()
    return Response(status_code=204)


@router.get("/admin/providers", dependencies=[admin_guard()])
async def list_providers(session: SessionDep) -> list[dict[str, Any]]:
    """List providers without secret material."""
    result = await session.execute(select(Provider).order_by(Provider.slug))
    return [
        {
            "id": p.id,
            "slug": p.slug,
            "name": p.name,
            "base_url": p.base_url,
            "env_key_name": p.env_key_name,
            "is_enabled": p.is_enabled,
        }
        for p in result.scalars()
    ]


@router.delete("/admin/providers/{slug}", dependencies=[admin_guard()], status_code=204)
async def delete_provider(slug: str, session: SessionDep) -> Response:
    """Disable a provider and all its models."""
    result = await session.execute(select(Provider).where(Provider.slug == slug))
    provider = result.scalar_one_or_none()
    if provider is None:
        raise HTTPException(404, "Provider not found")
    provider.is_enabled = False
    await session.commit()
    return Response(status_code=204)


@router.get("/admin/models", dependencies=[admin_guard()])
async def list_admin_models(session: SessionDep) -> list[dict[str, Any]]:
    """List configured models and routing metadata."""
    result = await session.execute(select(Model).order_by(Model.tier, Model.priority))
    return [
        {
            "id": model.id,
            "provider_id": model.provider_id,
            "name": model.name,
            "alias": model.alias,
            "priority": model.priority,
            "tier": model.tier,
            "is_enabled": model.is_enabled,
        }
        for model in result.scalars()
    ]


@router.get("/admin/playground/catalog", dependencies=[admin_guard()])
async def playground_catalog(session: SessionDep) -> dict[str, Any]:
    """List active consumer keys and models usable by the API playground."""
    settings = get_settings()
    keys_result = await session.execute(
        select(ApiKey).where(ApiKey.is_active.is_(True)).order_by(ApiKey.name, ApiKey.id)
    )
    models_result = await session.execute(
        select(Model, Provider)
        .join(Provider)
        .where(Model.is_enabled.is_(True), Provider.is_enabled.is_(True))
        .options(selectinload(Model.health))
        .order_by(Model.tier, Model.priority, Model.name)
    )
    now = datetime.now(UTC).replace(tzinfo=None)
    models = [
        {
            "id": model.alias or model.name,
            "name": model.name,
            "alias": model.alias,
            "provider": provider.slug,
            "provider_name": provider.name,
            "capabilities": model.capabilities,
        }
        for model, provider in models_result.all()
        if provider.adapter in {"openai", "google"}
        and (provider.slug != "ollama" or settings.router_enable_local_fallback)
        and provider_is_configured(settings, provider)
        and (
            model.health is None
            or model.health.state != "open"
            or model.health.cooldown_until is not None
            and model.health.cooldown_until <= now
        )
        and (
            model.health is None
            or model.health.cooldown_until is None
            or model.health.cooldown_until <= now
        )
    ]
    return {
        "api_keys": [
            {
                "id": key.id,
                "name": key.name,
                "prefix": key.prefix,
                "owner": key.owner,
                "requests_per_minute": key.requests_per_minute,
            }
            for key in keys_result.scalars()
        ],
        "models": models,
    }


@router.post("/admin/providers/{slug}", dependencies=[admin_guard()])
async def upsert_provider(slug: str, body: ProviderInput, session: SessionDep) -> dict[str, Any]:
    """Create or update provider configuration metadata."""
    result = await session.execute(select(Provider).where(Provider.slug == slug))
    provider = result.scalar_one_or_none()
    if provider is None:
        provider = Provider(slug=slug, **body.model_dump())
        session.add(provider)
    else:
        for field, value in body.model_dump().items():
            setattr(provider, field, value)
    await session.commit()
    return {"id": provider.id, "slug": provider.slug, "is_enabled": provider.is_enabled}


@router.post("/admin/models", dependencies=[admin_guard()], status_code=201)
async def create_model(body: ModelInput, session: SessionDep) -> dict[str, Any]:
    """Create a model record for an existing provider."""
    if await session.get(Provider, body.provider_id) is None:
        raise HTTPException(404, "Provider not found")
    model = Model(**body.model_dump())
    session.add(model)
    await session.commit()
    return {"id": model.id, "name": model.name}


@router.patch("/admin/models/{model_id}", dependencies=[admin_guard()])
async def update_model(model_id: int, body: ModelInput, session: SessionDep) -> dict[str, Any]:
    """Update model routing metadata."""
    model = await session.get(Model, model_id)
    if model is None:
        raise HTTPException(404, "Model not found")
    if await session.get(Provider, body.provider_id) is None:
        raise HTTPException(404, "Provider not found")
    for field, value in body.model_dump().items():
        setattr(model, field, value)
    await session.commit()
    return {"id": model.id, "name": model.name, "is_enabled": model.is_enabled}


@router.delete("/admin/models/{model_id}", dependencies=[admin_guard()], status_code=204)
async def delete_model(model_id: int, session: SessionDep) -> Response:
    """Disable a model while retaining its health and usage history."""
    model = await session.get(Model, model_id)
    if model is None:
        raise HTTPException(404, "Model not found")
    model.is_enabled = False
    await session.commit()
    return Response(status_code=204)


@router.get("/admin/models/{model_id}/limits", dependencies=[admin_guard()])
async def list_model_limits(model_id: int, session: SessionDep) -> list[dict[str, Any]]:
    """List configured quota windows for one model."""
    result = await session.execute(select(ModelLimit).where(ModelLimit.model_id == model_id))
    return [
        {"id": item.id, "window": item.window, "metric": item.metric, "max_value": item.max_value}
        for item in result.scalars()
    ]


@router.put("/admin/models/{model_id}/limits", dependencies=[admin_guard()])
async def set_model_limit(
    model_id: int, body: dict[str, Any], session: SessionDep
) -> dict[str, Any]:
    """Create or update one model quota window and metric."""
    if await session.get(Model, model_id) is None:
        raise HTTPException(404, "Model not found")
    window, metric, maximum = body.get("window"), body.get("metric"), body.get("max_value")
    if window not in {"minute", "hour", "day", "month"} or metric not in {
        "requests",
        "tokens",
        "neurons",
    }:
        raise HTTPException(422, "Unsupported quota window or metric")
    if not isinstance(maximum, int) or maximum <= 0:
        raise HTTPException(422, "max_value must be a positive integer")
    result = await session.execute(
        select(ModelLimit).where(
            ModelLimit.model_id == model_id,
            ModelLimit.window == window,
            ModelLimit.metric == metric,
        )
    )
    limit = result.scalar_one_or_none()
    if limit is None:
        limit = ModelLimit(model_id=model_id, window=window, metric=metric, max_value=maximum)
        session.add(limit)
    else:
        limit.max_value = maximum
    await session.commit()
    return {
        "id": limit.id,
        "window": limit.window,
        "metric": limit.metric,
        "max_value": limit.max_value,
    }


@router.post("/admin/models/{model_id}/reset-cooldown", dependencies=[admin_guard()])
async def reset_model_cooldown(model_id: int, session: SessionDep) -> dict[str, str]:
    """Reset the persisted circuit breaker and cooldown."""
    if await session.get(Model, model_id) is None:
        raise HTTPException(404, "Model not found")
    result = await session.execute(select(ModelHealth).where(ModelHealth.model_id == model_id))
    health = result.scalar_one_or_none()
    if health:
        health.state = "closed"
        health.consecutive_failures = 0
        health.cooldown_until = None
        health.last_error = None
        await session.commit()
    return {"status": "reset"}


@router.get("/admin/stats", dependencies=[admin_guard()])
async def stats(session: SessionDep) -> dict[str, Any]:
    """Aggregate request outcomes, latency percentiles and quota usage."""
    result = await session.execute(select(RequestLog).order_by(RequestLog.created_at))
    logs = list(result.scalars())
    latencies = sorted(log.latency_ms for log in logs if log.latency_ms is not None)

    def percentile(value: float) -> int | None:
        if not latencies:
            return None
        return latencies[min(len(latencies) - 1, int((len(latencies) - 1) * value))]

    usage_result = await session.execute(
        select(Model.name, ModelUsage.window, ModelUsage.metric, func.sum(ModelUsage.consumed))
        .join(ModelUsage, ModelUsage.model_id == Model.id)
        .group_by(Model.name, ModelUsage.window, ModelUsage.metric)
    )
    usage = [
        {"model": name, "window": window, "metric": metric, "consumed": consumed}
        for name, window, metric, consumed in usage_result.all()
    ]
    successful = sum(log.status == "success" for log in logs)
    return {
        "requests": len(logs),
        "success_rate": successful / len(logs) if logs else 0,
        "latency_p50_ms": percentile(0.50),
        "latency_p95_ms": percentile(0.95),
        "fallbacks": sum(log.attempts > 1 for log in logs),
        "quota_by_model": usage,
    }


@router.get("/metrics", include_in_schema=False)
async def prometheus_metrics(session: SessionDep) -> Response:
    """Expose aggregate counters in Prometheus text format when enabled."""
    if not get_settings().prometheus_enabled:
        raise HTTPException(404, "Metrics are disabled")
    totals = await session.execute(
        select(RequestLog.status, func.count(RequestLog.id)).group_by(RequestLog.status)
    )
    lines = [
        "# HELP relevo_requests_total Requests handled by outcome.",
        "# TYPE relevo_requests_total counter",
    ]
    for status, count in totals.all():
        safe_status = str(status).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "")
        lines.append(f'relevo_requests_total{{status="{safe_status}"}} {count}')
    usage = await session.execute(
        select(Model.name, ModelUsage.window, ModelUsage.metric, func.sum(ModelUsage.consumed))
        .join(ModelUsage, ModelUsage.model_id == Model.id)
        .group_by(Model.name, ModelUsage.window, ModelUsage.metric)
    )
    lines.extend(
        [
            "# HELP relevo_quota_consumed Current persisted quota usage.",
            "# TYPE relevo_quota_consumed gauge",
        ]
    )
    for model, window, metric, consumed in usage.all():
        labels = (model, window, metric)
        encoded = [
            value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "") for value in labels
        ]
        lines.append(
            "relevo_quota_consumed{"
            f'model="{encoded[0]}",window="{encoded[1]}",metric="{encoded[2]}"'
            f"}} {consumed}"
        )
    return Response("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4; charset=utf-8")


@router.post("/admin/seed/reload", dependencies=[admin_guard()])
async def seed_reload(session: SessionDep) -> dict[str, str]:
    """Reload the initial provider and model catalog."""
    from app.core.seed import load_seed

    await load_seed(session)
    return {"status": "reloaded"}
