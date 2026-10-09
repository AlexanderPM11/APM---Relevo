"""Transactional provider-quota reservations persisted in MySQL."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ModelLimit, ModelUsage


@dataclass(frozen=True, slots=True)
class ReservedCounter:
    """One counter increment reserved for an outbound request."""

    window: str
    metric: str
    window_start: datetime
    amount: int


class QuotaExceeded(Exception):
    """Raised when at least one configured quota window is exhausted."""

    def __init__(self, retry_after: int) -> None:
        self.retry_after = max(1, retry_after)
        super().__init__("Provider quota exhausted")


def _window_start(window: str, now: datetime) -> datetime:
    """Return a naive UTC start timestamp for a provider quota bucket."""
    current = now.astimezone(UTC).replace(tzinfo=None)
    if window == "minute":
        return current.replace(second=0, microsecond=0)
    if window == "hour":
        return current.replace(minute=0, second=0, microsecond=0)
    if window == "day":
        return current.replace(hour=0, minute=0, second=0, microsecond=0)
    if window == "month":
        return current.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    raise ValueError(f"Unsupported quota window: {window}")


def _window_end(window: str, start: datetime) -> datetime:
    """Return the next quota reset boundary."""
    if window == "minute":
        return start + timedelta(minutes=1)
    if window == "hour":
        return start + timedelta(hours=1)
    if window == "day":
        return start + timedelta(days=1)
    if window == "month":
        return start.replace(year=start.year + (start.month == 12), month=start.month % 12 + 1)
    raise ValueError(f"Unsupported quota window: {window}")


async def reserve_quota(
    session: AsyncSession,
    model_id: int,
    limits: list[ModelLimit],
    estimated_tokens: int,
) -> list[ReservedCounter]:
    """Atomically check and reserve request/token counters across all windows.

    The insert-ignore and row locks make reservations safe across concurrent
    requests and application processes sharing the same MySQL database.
    """
    now = datetime.now(UTC)
    counters = [
        ReservedCounter(
            limit.window,
            limit.metric,
            _window_start(limit.window, now),
            1 if limit.metric == "requests" else max(1, estimated_tokens),
        )
        for limit in limits
    ]
    if not counters:
        return []

    try:
        for counter in counters:
            insert = mysql_insert(ModelUsage).values(
                model_id=model_id,
                window=counter.window,
                window_start=counter.window_start,
                metric=counter.metric,
                consumed=0,
            )
            await session.execute(insert.prefix_with("IGNORE"))

        conditions = [
            (ModelUsage.window == counter.window)
            & (ModelUsage.window_start == counter.window_start)
            & (ModelUsage.metric == counter.metric)
            for counter in counters
        ]
        result = await session.execute(
            select(ModelUsage)
            .where(ModelUsage.model_id == model_id)
            .where(or_(*conditions))
            .order_by(ModelUsage.window, ModelUsage.metric)
            .with_for_update()
        )
        rows = {(row.window, row.metric): row for row in result.scalars()}
        for counter, limit in zip(counters, limits, strict=True):
            row = rows[(counter.window, counter.metric)]
            if row.consumed + counter.amount > limit.max_value:
                end = _window_end(counter.window, counter.window_start)
                raise QuotaExceeded(int((end - now.replace(tzinfo=None)).total_seconds()))
        for counter in counters:
            row = rows[(counter.window, counter.metric)]
            row.consumed += counter.amount
        await session.commit()
        return counters
    except Exception:
        await session.rollback()
        raise


async def adjust_token_reservation(
    session: AsyncSession,
    model_id: int,
    reservations: list[ReservedCounter],
    actual_tokens: int,
) -> None:
    """Reconcile estimated token reservations to the provider's actual usage."""
    delta = actual_tokens - sum(
        counter.amount for counter in reservations if counter.metric in {"tokens", "neurons"}
    )
    if delta:
        for counter in reservations:
            if counter.metric in {"tokens", "neurons"}:
                await session.execute(
                    update(ModelUsage)
                    .where(
                        ModelUsage.model_id == model_id,
                        ModelUsage.window == counter.window,
                        ModelUsage.window_start == counter.window_start,
                        ModelUsage.metric == counter.metric,
                    )
                    .values(consumed=ModelUsage.consumed + delta)
                )
    await session.commit()


async def release_quota_reservation(
    session: AsyncSession, model_id: int, reservations: list[ReservedCounter]
) -> None:
    """Release a reservation when a provider definitively rejects the request."""
    for counter in reservations:
        await session.execute(
            update(ModelUsage)
            .where(
                ModelUsage.model_id == model_id,
                ModelUsage.window == counter.window,
                ModelUsage.window_start == counter.window_start,
                ModelUsage.metric == counter.metric,
            )
            .values(consumed=ModelUsage.consumed - counter.amount)
        )
    await session.commit()
