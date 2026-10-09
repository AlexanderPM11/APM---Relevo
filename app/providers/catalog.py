"""Discover chat models from configured provider model-list endpoints."""

import asyncio
import time
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.models import Model, Provider
from app.router.service import provider_is_configured, provider_key

_CACHE_SECONDS = 300
_REQUEST_TIMEOUT = 8.0
_catalog_cache: dict[str, tuple[float, list[dict[str, Any]] | None]] = {}
_catalog_lock = asyncio.Lock()
_PROVIDER_TIERS = {
    "groq": 1,
    "cerebras": 1,
    "google-ai-studio": 2,
    "cloudflare": 2,
    "ollama": 4,
    "huggingface": 4,
}
_NON_CHAT_MODEL_MARKERS = (
    "embed",
    "rerank",
    "prompt-guard",
    "whisper",
    "orpheus",
    "transcrib",
    "tts",
    "moderation",
    "content-safety",
    "nemoguard",
    "safety-guard",
    "llama-guard",
    "ocr",
    "reward",
    "diffusion",
    "stable-diffusion",
    "flux.",
    "lyria",
    "audio",
    "speech",
    "realtime",
    "deplot",
    "nvclip",
    "riva-translate",
    "synthetic-video-detector",
)


def _provider_url(provider: Provider, settings: Settings) -> str:
    base_url = provider.base_url.rstrip("/")
    if provider.slug == "cloudflare":
        base_url = base_url.replace("{account_id}", settings.cloudflare_account_id or "")
    return f"{base_url}/models"


def _normalize_models(provider: Provider, payload: Any) -> list[dict[str, Any]]:
    """Normalize common OpenAI and Gemini model-list response shapes."""
    if not isinstance(payload, dict):
        return []
    raw_models = payload.get("data", payload.get("models", []))
    if not isinstance(raw_models, list):
        return []

    models: list[dict[str, Any]] = []
    for item in raw_models:
        if not isinstance(item, dict):
            continue
        name = item.get("id") or item.get("name")
        if not isinstance(name, str) or not name:
            continue
        if name.startswith("models/"):
            name = name.removeprefix("models/")
        if any(marker in name.lower() for marker in _NON_CHAT_MODEL_MARKERS):
            continue

        # Gemini's list includes embeddings and other non-chat models.
        actions = item.get("supportedGenerationMethods") or item.get("supported_actions")
        if actions is not None and "generateContent" not in actions:
            continue
        architecture = item.get("architecture") or {}
        output_modalities = architecture.get("output_modalities") or ["text"]
        if "text" not in output_modalities:
            continue

        capabilities = ["text"]
        parameters = item.get("supported_parameters") or []
        if any(value in parameters for value in ("tools", "tool_choice", "functions")):
            capabilities.append("tools")
        input_modalities = architecture.get("input_modalities") or []
        if "image" in input_modalities:
            capabilities.append("vision")
        pricing = item.get("pricing") or {}
        free_route = name.endswith(":free") or name == "kilo-auto/free"
        free_price = (
            all(
                pricing.get(field) is not None and float(pricing[field]) == 0
                for field in ("prompt", "completion")
            )
            if isinstance(pricing, dict)
            else False
        )
        is_free = free_route or free_price
        # These gateways expose explicit prices. Keep the free-first catalog free-only
        # where the provider gives us reliable pricing metadata.
        if provider.slug in {"openrouter", "kilo"} and not is_free:
            continue
        models.append(
            {
                "name": name[:200],
                "context_max": int(
                    item.get("context_length")
                    or item.get("inputTokenLimit")
                    or item.get("context_window")
                    or 8192
                ),
                "capabilities": capabilities,
                "is_free": is_free,
            }
        )
    return models


async def _fetch_provider_models(
    provider: Provider, settings: Settings
) -> tuple[str, list[dict[str, Any]] | None]:
    """Fetch a provider's live model catalog; None indicates a temporary failure."""
    cached = _catalog_cache.get(provider.slug)
    now = time.monotonic()
    if cached and now - cached[0] < _CACHE_SECONDS:
        return provider.slug, cached[1]

    headers: dict[str, str] = {}
    key = provider_key(settings, provider.env_key_name)
    if key:
        headers["Authorization"] = f"Bearer {key}"
    params: dict[str, str | int] | None = None
    if provider.adapter == "google":
        params = {"pageSize": 1000}
        if key:
            params["key"] = key
    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
            pages: list[Any] = []
            page_token: str | None = None
            for _ in range(10):
                page_params = dict(params or {})
                if page_token:
                    page_params["pageToken"] = page_token
                response = await client.get(
                    _provider_url(provider, settings), headers=headers, params=page_params
                )
                response.raise_for_status()
                page = response.json()
                pages.append(page)
                page_token = page.get("nextPageToken") if isinstance(page, dict) else None
                if not page_token:
                    break
        models = [model for page in pages for model in _normalize_models(provider, page)]
        _catalog_cache[provider.slug] = (now, models)
        return provider.slug, models
    except (httpx.HTTPError, ValueError, TypeError):
        # Keep the last good database snapshot and retry sooner than a successful refresh.
        _catalog_cache[provider.slug] = (now - _CACHE_SECONDS + 30, None)
        return provider.slug, None


async def refresh_provider_catalog(session: AsyncSession, settings: Settings) -> None:
    """Refresh enabled provider model rows from live endpoints, retaining prior data on failure."""
    async with _catalog_lock:
        result = await session.execute(select(Provider).where(Provider.is_enabled.is_(True)))
        providers = [
            provider
            for provider in result.scalars().all()
            if provider.adapter in {"openai", "google"}
            and (provider.slug != "ollama" or settings.router_enable_local_fallback)
            and provider_is_configured(settings, provider)
        ]
        fetched = await asyncio.gather(
            *(_fetch_provider_models(provider, settings) for provider in providers)
        )
        provider_by_slug = {provider.slug: provider for provider in providers}
        for slug, discovered in fetched:
            if discovered is None:
                continue
            provider = provider_by_slug[slug]
            existing_result = await session.execute(
                select(Model).where(Model.provider_id == provider.id)
            )
            existing = {model.name: model for model in existing_result.scalars().all()}
            discovered_names = {item["name"] for item in discovered}

            # Disable stale entries from the old seed while preserving discovered records and
            # operator-disabled models. Existing limits, health, and priority stay attached.
            for existing_model in existing.values():
                if existing_model.name not in discovered_names:
                    existing_model.is_enabled = False

            for item in discovered:
                model = existing.get(item["name"])
                if model is None:
                    model = Model(
                        provider_id=provider.id,
                        name=item["name"],
                        alias=(
                            f"{slug}/{item['name']}"
                            if len(f"{slug}/{item['name']}") <= 100
                            else None
                        ),
                        priority=100,
                        weight=1,
                        context_max=max(1, item["context_max"]),
                        capabilities=item["capabilities"],
                        is_enabled=True,
                        tier=_PROVIDER_TIERS.get(slug, 3),
                    )
                    session.add(model)
                else:
                    # Aliases are provider-qualified to avoid collisions across vendors.
                    qualified_name = f"{slug}/{item['name']}"
                    model.alias = qualified_name if len(qualified_name) <= 100 else None
                    model.context_max = max(1, item["context_max"])
                    model.capabilities = item["capabilities"]
        await session.commit()
