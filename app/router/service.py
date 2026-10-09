"""Database-backed model selection with provider fallback."""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings
from app.db.models import Model, ModelHealth, Provider
from app.providers.base import (
    GoogleAIStudioAdapter,
    OpenAICompatibleAdapter,
    ProviderAdapter,
    ProviderError,
)
from app.router.classifier import RoutingDecision, classify_with_laya, order_by_decision
from app.router.quotas import (
    QuotaExceeded,
    adjust_token_reservation,
    release_quota_reservation,
    reserve_quota,
)

_weighted_cursors: dict[int, int] = {}


def _weighted_order(candidates: list[tuple[Model, Provider]]) -> list[tuple[Model, Provider]]:
    """Rotate candidates within each priority tier using model weights."""
    ordered: list[tuple[Model, Provider]] = []
    for tier in sorted({model.tier for model, _ in candidates}):
        group = [(model, provider) for model, provider in candidates if model.tier == tier]
        slots = [pair for pair in group for _ in range(max(1, pair[0].weight))]
        if not slots:
            continue
        cursor = _weighted_cursors.get(tier, 0) % len(slots)
        _weighted_cursors[tier] = cursor + 1
        rotated = slots[cursor:] + slots[:cursor]
        tier_order: list[tuple[Model, Provider]] = []
        seen: set[int] = set()
        for pair in rotated:
            if pair[0].id not in seen:
                seen.add(pair[0].id)
                tier_order.append(pair)
        ordered.extend(tier_order)
    return ordered


def estimate_tokens(payload: dict[str, Any]) -> int:
    """Estimate input and reserved output tokens without retaining prompt text."""
    messages = payload.get("messages", [])
    input_tokens = sum(len(str(message.get("content", ""))) for message in messages) // 4
    output_tokens = int(payload.get("max_tokens") or 1024)
    return max(1, input_tokens + output_tokens)


def provider_key(settings: Settings, env_name: str) -> str | None:
    """Resolve only known configured provider credential names."""
    normalized = env_name.lower()
    value = getattr(settings, normalized, None)
    if value is None:
        return None
    if hasattr(value, "get_secret_value"):
        return str(value.get_secret_value())
    return str(value)


def provider_is_configured(settings: Settings, provider: Provider) -> bool:
    """Check the credential and auxiliary settings needed by an adapter."""
    if provider.slug == "kilo":
        return True  # Kilo permits anonymous requests for its free model routes.
    if provider.slug == "cloudflare" and not settings.cloudflare_account_id:
        return False
    return bool(provider_key(settings, provider.env_key_name))


async def complete_with_fallback(
    session: AsyncSession,
    settings: Settings,
    requested_model: str,
    payload: dict[str, Any],
    laya_client: httpx.AsyncClient | None = None,
    *,
    on_event: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    route_by_task: bool = False,
) -> tuple[dict[str, Any], Model, Provider, int]:
    """Try enabled, credentialed candidates in priority order."""

    async def emit(event: str, **data: Any) -> None:
        if on_event is not None:
            await on_event({"event": event, **data})

    await emit("routing", mode="auto" if requested_model == "auto" else "manual")
    result = await session.execute(
        select(Model, Provider)
        .join(Provider)
        .where(Model.is_enabled.is_(True), Provider.is_enabled.is_(True))
        .options(selectinload(Model.health), selectinload(Model.limits))
        .order_by(Model.tier, Model.priority)
    )
    messages = payload.get("messages", [])
    estimated_context = sum(len(str(message.get("content", ""))) for message in messages) // 4
    estimated_context += int(payload.get("max_tokens") or 1024)
    required = {"text"}
    if payload.get("tools"):
        required.add("tools")
    if payload.get("response_format", {}).get("type") == "json_object":
        required.add("json")
    if any(
        isinstance(message.get("content"), list)
        and any(
            isinstance(part, dict)
            and (part.get("type") in {"image_url", "input_image", "image"} or "image_url" in part)
            for part in message["content"]
        )
        for message in messages
    ):
        required.add("vision")
    candidates = [
        (model, provider)
        for model, provider in result.all()
        if (requested_model in {"auto", model.name, model.alias, f"{provider.slug}/{model.name}"})
        and estimated_context <= model.context_max
        and required.issubset(set(model.capabilities))
        and provider.adapter in {"openai", "google"}
        and (provider.adapter != "google" or not required.intersection({"tools", "json"}))
        and (provider.slug != "ollama" or settings.router_enable_local_fallback)
        and provider_is_configured(settings, provider)
        and (not settings.router_free_only or requested_model != "auto" or model.is_free is True)
        and (
            model.health is None
            or model.health.state != "open"
            or model.health.cooldown_until is not None
            and model.health.cooldown_until <= datetime.now(UTC).replace(tzinfo=None)
        )
        and (
            model.health is None
            or model.health.cooldown_until is None
            or model.health.cooldown_until <= datetime.now(UTC).replace(tzinfo=None)
        )
    ]
    routing_decision: RoutingDecision | None = None
    if (
        route_by_task or settings.router_strategy == "laya" and settings.laya_routing_mode != "off"
    ) and requested_model == "auto":
        routing_decision = await classify_with_laya(
            laya_client, settings, payload.get("messages", [])
        )
        if route_by_task or settings.laya_routing_mode == "active":
            candidates = order_by_decision(candidates, routing_decision)
    elif settings.router_strategy == "weighted_round_robin":
        candidates = _weighted_order(candidates)
    routing_trace = (
        {
            "task": routing_decision.task,
            "complexity": routing_decision.complexity,
            "confidence": routing_decision.confidence,
            "classifier": routing_decision.classifier,
            "classifier_ms": routing_decision.classifier_ms,
            "fallback": routing_decision.fallback,
            "mode": "active" if route_by_task else settings.laya_routing_mode,
        }
        if routing_decision is not None
        else None
    )
    await emit("classified", routing=routing_trace, candidates=len(candidates))
    if not candidates:
        raise ProviderError(
            503, "No compatible model is currently available", routing=routing_trace
        )
    errors: list[ProviderError] = []
    retry_after_values: list[int] = []
    attempts = 0
    for model, provider in candidates:
        if attempts >= settings.router_max_attempts:
            break
        key = (
            ""
            if provider.slug in {"ollama", "kilo"}
            else provider_key(settings, provider.env_key_name)
        )
        if not key and provider.slug not in {"ollama", "kilo"}:
            continue
        try:
            reservation = await reserve_quota(
                session, model.id, model.limits, estimate_tokens(payload)
            )
        except QuotaExceeded as error:
            retry_after_values.append(error.retry_after)
            await emit("unavailable", model=model.name, reason="quota")
            continue
        attempts += 1
        adapter: ProviderAdapter
        if provider.adapter == "google":
            adapter = GoogleAIStudioAdapter(
                provider.base_url, key or "", settings.router_request_timeout_seconds
            )
        elif provider.adapter == "openai":
            base_url = provider.base_url
            if provider.slug == "ollama" and settings.ollama_base_url:
                base_url = settings.ollama_base_url.rstrip("/")
            if provider.slug == "cloudflare":
                base_url = base_url.replace("{account_id}", settings.cloudflare_account_id or "")
            adapter = OpenAICompatibleAdapter(
                base_url,
                key or "",
                settings.router_request_timeout_seconds,
            )
        else:
            continue
        emitted_content = False

        async def delta(
            text: str, model_name: str = model.name, provider_slug: str = provider.slug
        ) -> None:
            nonlocal emitted_content
            emitted_content = True
            await emit("delta", text=text, model=model_name, provider=provider_slug)

        await emit(
            "selected",
            model=model.name,
            provider=provider.slug,
            provider_name=provider.name,
            attempt=attempts,
            routing=routing_trace,
            profile=model.routing_profile,
            tasks=model.routing_tasks,
        )
        try:
            await emit("requesting", model=model.name, provider=provider.slug, attempt=attempts)
            if on_event is not None:
                completion = await adapter.chat_stream(model.name, payload, delta)
            else:
                completion = await adapter.chat(model.name, payload)
            usage = completion.get("usage", {})
            actual_tokens = int(usage.get("total_tokens") or 0)
            if not actual_tokens:
                actual_tokens = int(usage.get("prompt_tokens", 0)) + int(
                    usage.get("completion_tokens", 0)
                )
            if actual_tokens:
                await adjust_token_reservation(session, model.id, reservation, actual_tokens)
            if model.health is not None:
                model.health.state = "closed"
                model.health.consecutive_failures = 0
                model.health.cooldown_until = None
                model.health.last_error = None
                await session.commit()
            if routing_trace is not None:
                completion["_relevo_routing"] = routing_trace
            return completion, model, provider, attempts
        except ProviderError as error:
            errors.append(error)
            if error.status_code in (400, 401, 403, 429):
                await release_quota_reservation(session, model.id, reservation)
            now = datetime.now(UTC).replace(tzinfo=None)
            health = model.health
            if health is None:
                health = ModelHealth(model_id=model.id)
                session.add(health)
                await session.flush()
                model.health = health
            health.last_error = f"HTTP {error.status_code}: provider request failed"
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
            if emitted_content:
                # A retry must never combine responses from two different models.
                error.attempts = attempts
                error.routing = routing_trace
                raise error
            await emit(
                "fallback",
                model=model.name,
                provider=provider.slug,
                attempt=attempts,
                status_code=error.status_code,
            )
            if error.status_code == 400:
                if any(
                    marker in error.message.lower()
                    for marker in ("context", "token limit", "too long")
                ):
                    continue
                error.attempts = attempts
                error.routing = routing_trace
                raise error
            if error.status_code in (401, 403):
                continue
    if errors and all(error.status_code in (401, 403) for error in errors):
        raise ProviderError(
            502,
            "All configured providers rejected authentication",
            attempts=attempts,
            routing=routing_trace,
        )
    retry_after = (
        min(retry_after_values)
        if retry_after_values
        else next((error.retry_after for error in errors if error.retry_after), None)
    )
    raise ProviderError(503, "All available models failed", retry_after, attempts, routing_trace)
