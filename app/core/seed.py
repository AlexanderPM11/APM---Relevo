"""Idempotent provider and model catalog loading."""

import asyncio
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.models import Provider


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
        # Model inventories are discovered from provider APIs at runtime. The legacy
        # ``models`` field in old seed files is deliberately ignored.
        data.pop("models", None)
        adapter = data.pop("adapter", "openai")
        data.pop("tier", None)
        provider_slug = data["slug"]
        key = getattr(settings, data["env_key_name"].lower(), None)
        if key is not None and hasattr(key, "get_secret_value"):
            key = key.get_secret_value()
        enabled = bool(key)
        if provider_slug == "cloudflare":
            enabled = bool(key and settings.cloudflare_account_id)
        elif provider_slug == "ollama":
            enabled = bool(key and settings.router_enable_local_fallback)
        elif provider_slug == "kilo":
            enabled = True  # Anonymous access is allowed for Kilo's free model routes.
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
    await session.commit()
