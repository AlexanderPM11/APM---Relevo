"""Idempotent provider and model catalog loading."""

import asyncio
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.models import Model, Provider


async def load_seed(session: AsyncSession, settings: Settings | None = None) -> None:
    """Upsert provider catalog records without overwriting operator limits."""
    settings = settings or get_settings()
    seed_path = Path("config/models.seed.yaml")
    if not await asyncio.to_thread(seed_path.is_file):
        return
    raw_content = await asyncio.to_thread(seed_path.read_text, encoding="utf-8")
    content = yaml.safe_load(raw_content) or {}
    for provider_data in content.get("providers", []):
        data = dict(provider_data)
        models = data.pop("models", [])
        adapter = data.pop("adapter", "openai")
        tier = data.pop("tier", 3)
        provider_slug = data["slug"]
        key = getattr(settings, data["env_key_name"].lower(), None)
        if key is not None and hasattr(key, "get_secret_value"):
            key = key.get_secret_value()
        enabled = bool(key)
        if provider_slug == "cloudflare":
            enabled = bool(key and settings.cloudflare_account_id)
        elif provider_slug == "ollama":
            enabled = bool(key and settings.router_enable_local_fallback)
        requires_card = data.get("requires_card")
        requires_phone = data.get("requires_phone")
        if requires_card == "unknown":
            requires_card = None
        if requires_phone == "unknown":
            requires_phone = None
        result = await session.execute(select(Provider).where(Provider.slug == provider_slug))
        provider = result.scalar_one_or_none()
        values: dict[str, Any] = {
            "name": data["name"],
            "base_url": data["base_url"],
            "env_key_name": data["env_key_name"],
            "is_enabled": enabled,
            "requires_card": requires_card,
            "requires_phone": requires_phone,
            "uses_data_for_training": str(data.get("uses_data_for_training", "unknown")),
            "adapter": adapter,
        }
        if provider is None:
            provider = Provider(slug=provider_slug, **values)
            session.add(provider)
            await session.flush()
        else:
            for name, value in values.items():
                setattr(provider, name, value)
        for model_data in models:
            result = await session.execute(
                select(Model).where(
                    Model.provider_id == provider.id, Model.name == model_data["name"]
                )
            )
            model = result.scalar_one_or_none()
            model_values = {
                "alias": model_data.get("alias"),
                "priority": model_data.get("priority", 100),
                "weight": model_data.get("weight", 1),
                "context_max": model_data.get("context_max", 8192),
                "capabilities": model_data.get("capabilities", ["text"]),
                "is_enabled": True,
                "tier": tier,
            }
            if model is None:
                session.add(Model(provider_id=provider.id, name=model_data["name"], **model_values))
            else:
                for name, value in model_values.items():
                    setattr(model, name, value)
    await session.commit()
