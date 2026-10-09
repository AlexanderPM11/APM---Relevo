"""Unit tests for periodic maintenance of quotas and model health."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.models import Model, ModelHealth, ModelUsage, Provider
from app.router.maintenance import (
    cleanup_expired_usage_windows,
    recover_cooled_down_models,
    run_maintenance_cycle,
)


@pytest.mark.asyncio
async def test_maintenance_cleans_expired_usage_windows() -> None:
    """Old quota windows are removed while recent windows are preserved."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    now = datetime.now(UTC).replace(tzinfo=None)

    async with session_factory() as session:
        provider = Provider(
            slug="p1",
            name="Provider 1",
            base_url="https://api.example.com",
            env_key_name="P1_KEY",
        )
        session.add(provider)
        await session.flush()
        model = Model(provider_id=provider.id, name="m1")
        session.add(model)
        await session.flush()

        # Expired minute usage (> 15m ago)
        old_minute = ModelUsage(
            model_id=model.id,
            window="minute",
            window_start=now - timedelta(minutes=20),
            metric="requests",
            consumed=10,
        )
        # Fresh minute usage (< 15m ago)
        fresh_minute = ModelUsage(
            model_id=model.id,
            window="minute",
            window_start=now - timedelta(minutes=2),
            metric="requests",
            consumed=5,
        )
        session.add_all([old_minute, fresh_minute])
        await session.commit()

        deleted = await cleanup_expired_usage_windows(session)
        assert deleted == 1

    await engine.dispose()


@pytest.mark.asyncio
async def test_maintenance_recovers_cooled_down_models() -> None:
    """Models whose cooldown period has passed are reset to closed circuit state."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    now = datetime.now(UTC).replace(tzinfo=None)

    async with session_factory() as session:
        provider = Provider(
            slug="p2",
            name="Provider 2",
            base_url="https://api.example.com",
            env_key_name="P2_KEY",
        )
        session.add(provider)
        await session.flush()
        model1 = Model(provider_id=provider.id, name="m-cooldown-expired")
        model2 = Model(provider_id=provider.id, name="m-cooldown-active")
        session.add_all([model1, model2])
        await session.flush()

        health1 = ModelHealth(
            model_id=model1.id,
            state="open",
            consecutive_failures=3,
            cooldown_until=now - timedelta(seconds=10),
            last_error="HTTP 429",
        )
        health2 = ModelHealth(
            model_id=model2.id,
            state="open",
            consecutive_failures=2,
            cooldown_until=now + timedelta(seconds=60),
            last_error="HTTP 500",
        )
        session.add_all([health1, health2])
        await session.commit()

        recovered = await recover_cooled_down_models(session)
        assert recovered == 1

        await session.refresh(health1)
        await session.refresh(health2)
        assert health1.state == "closed"
        assert health1.cooldown_until is None
        assert health1.consecutive_failures == 0

        assert health2.state == "open"
        assert health2.cooldown_until is not None

    await engine.dispose()


@pytest.mark.asyncio
async def test_run_maintenance_cycle_runs_safely() -> None:
    """Full cycle runs without error on session factory."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    stats = await run_maintenance_cycle(session_factory)
    assert stats["cleaned_usage_rows"] == 0
    assert stats["recovered_models"] == 0
    await engine.dispose()
