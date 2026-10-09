"""Periodic maintenance tasks: expired quota cleanup and cooldown recovery."""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import ModelHealth, ModelUsage

logger = logging.getLogger(__name__)


async def cleanup_expired_usage_windows(session: AsyncSession) -> int:
    """Delete expired ModelUsage rows according to window retention policies."""
    now = datetime.now(UTC).replace(tzinfo=None)
    thresholds = {
        "minute": now - timedelta(minutes=15),
        "hour": now - timedelta(hours=48),
        "day": now - timedelta(days=60),
        "month": now - timedelta(days=365),
    }
    deleted = 0
    for window_type, cutoff in thresholds.items():
        stmt = delete(ModelUsage).where(
            ModelUsage.window == window_type,
            ModelUsage.window_start < cutoff,
        )
        result = await session.execute(stmt)
        deleted += int(getattr(result, "rowcount", 0) or 0)
    if deleted:
        await session.commit()
    return deleted


async def recover_cooled_down_models(session: AsyncSession) -> int:
    """Close circuits and clear cooldown for models whose cooldown period has elapsed."""
    now = datetime.now(UTC).replace(tzinfo=None)
    stmt = (
        update(ModelHealth)
        .where(
            ModelHealth.cooldown_until.is_not(None),
            ModelHealth.cooldown_until <= now,
        )
        .values(
            state="closed",
            cooldown_until=None,
            consecutive_failures=0,
            last_error=None,
        )
    )
    result = await session.execute(stmt)
    updated = int(getattr(result, "rowcount", 0) or 0)
    if updated:
        await session.commit()
    return updated


async def run_maintenance_cycle(
    session_factory: async_sessionmaker[AsyncSession],
) -> dict[str, int]:
    """Run a single maintenance pass across usage and health tables."""
    async with session_factory() as session:
        try:
            cleaned = await cleanup_expired_usage_windows(session)
            recovered = await recover_cooled_down_models(session)
            return {"cleaned_usage_rows": cleaned, "recovered_models": recovered}
        except Exception:
            logger.exception("Error executing maintenance cycle")
            return {"cleaned_usage_rows": 0, "recovered_models": 0}


async def maintenance_loop(
    session_factory: async_sessionmaker[AsyncSession],
    interval_seconds: float = 60.0,
) -> None:
    """Continuous background loop executing maintenance periodically."""
    logger.info("Starting background maintenance loop with interval %ss", interval_seconds)
    while True:
        try:
            await asyncio.sleep(interval_seconds)
            await run_maintenance_cycle(session_factory)
        except asyncio.CancelledError:
            logger.info("Background maintenance loop cancelled")
            break
        except Exception:
            logger.exception("Unexpected error in background maintenance loop")
