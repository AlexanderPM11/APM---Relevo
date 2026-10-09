"""Basic process health endpoint checks."""

import pytest

from app.main import health


@pytest.mark.asyncio
async def test_health_reports_process_liveness() -> None:
    """The liveness endpoint must respond without database dependencies."""
    assert await health() == {"status": "ok"}
