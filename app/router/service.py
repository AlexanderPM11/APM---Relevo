"""Database-backed model selection with provider fallback."""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.models import Model, ModelHealth, Provider
from app.providers.base import OpenAICompatibleAdapter, ProviderError


def provider_key(settings: Settings, env_name: str) -> str | None:
    """Resolve only known configured provider credential names."""
    normalized = env_name.lower()
    value = getattr(settings, normalized, None)
    if value is None:
        return None
    if hasattr(value, "get_secret_value"):
        return value.get_secret_value()
    return str(value)


async def complete_with_fallback(
    session: AsyncSession, settings: Settings, requested_model: str, payload: dict[str, Any]
) -> tuple[dict[str, Any], Model, Provider, int]:
    """Try enabled, credentialed candidates in priority order."""
    result = await session.execute(
        select(Model, Provider)
        .join(Provider)
        .where(Model.is_enabled.is_(True), Provider.is_enabled.is_(True))
        .options(selectinload(Model.health))
        .order_by(Model.tier, Model.priority)
    )
    messages = payload.get("messages", [])
    estimated_context = sum(len(str(message.get("content", ""))) for message in messages) // 4
    required = {"text"}
    if payload.get("tools"):
        required.add("tools")
    if payload.get("response_format", {}).get("type") == "json_object":
        required.add("json")
    if any(isinstance(message.get("content"), list) for message in messages):
        required.add("vision")
    candidates = [
        (model, provider)
        for model, provider in result.all()
        if (requested_model in {"auto", model.name, model.alias})
        and estimated_context <= model.context_max
        and required.issubset(set(model.capabilities))
        and (provider.slug != "ollama" or settings.router_enable_local_fallback)
        and provider_key(settings, provider.env_key_name)
        and (model.health is None or model.health.state != "open"
             or model.health.cooldown_until is not None
             and model.health.cooldown_until <= datetime.now(UTC))
        and (model.health is None or model.health.cooldown_until is None
             or model.health.cooldown_until <= datetime.now(UTC))
    ][: settings.router_max_attempts]
    if not candidates:
        raise ProviderError(503, "No compatible model is currently available")
    errors: list[ProviderError] = []
    for attempt, (model, provider) in enumerate(candidates, start=1):
        key = provider_key(settings, provider.env_key_name)
        if not key:
            continue
        adapter = OpenAICompatibleAdapter(provider.base_url, key, settings.router_request_timeout_seconds)
        try:
            completion = await adapter.chat(model.name, payload)
            if model.health is not None:
                model.health.state = "closed"
                model.health.consecutive_failures = 0
                model.health.cooldown_until = None
                model.health.last_error = None
                await session.commit()
            return completion, model, provider, attempt
        except ProviderError as error:
            errors.append(error)
            now = datetime.now(UTC)
            health = model.health
            if health is None:
                health = ModelHealth(model_id=model.id)
                session.add(health)
                await session.flush()
                model.health = health
            health.last_error = f"HTTP {error.status_code}: {error.message[:200]}"
            if error.status_code == 429:
                health.cooldown_until = now + timedelta(
                    seconds=error.retry_after or settings.router_cooldown_default_seconds
                )
            elif error.status_code in (401, 403):
                provider.is_enabled = False
            elif error.status_code >= 500 or error.status_code in (502, 504):
                health.consecutive_failures += 1
                if health.consecutive_failures >= settings.router_circuit_failure_threshold:
                    health.state = "open"
                    health.cooldown_until = now + timedelta(
                        seconds=settings.router_cooldown_default_seconds
                    )
            await session.commit()
            if error.status_code == 400:
                if any(marker in error.message.lower() for marker in ("context", "token limit", "too long")):
                    continue
                raise error
            if error.status_code in (401, 403):
                continue
    if errors and all(error.status_code in (401, 403) for error in errors):
        raise ProviderError(502, "All configured providers rejected authentication")
    retry_after = next((error.retry_after for error in errors if error.retry_after), None)
    raise ProviderError(503, "All available models failed", retry_after)
