"""Quota window boundaries and token estimation tests."""

from datetime import UTC, datetime

import pytest

from app.router.quotas import QuotaExceeded, _window_end, _window_start
from app.router.service import estimate_tokens


@pytest.mark.parametrize(
    ("window", "expected"),
    [
        ("minute", datetime(2026, 10, 8, 12, 34)),
        ("hour", datetime(2026, 10, 8, 12)),
        ("day", datetime(2026, 10, 8)),
        ("month", datetime(2026, 10, 1)),
    ],
)
def test_window_start(window: str, expected: datetime) -> None:
    """Each usage window begins at its UTC calendar boundary."""
    now = datetime(2026, 10, 8, 12, 34, 56, tzinfo=UTC)
    assert _window_start(window, now) == expected


def test_month_window_rolls_over_year() -> None:
    """The December monthly bucket ends on January 1 of the next year."""
    assert _window_end("month", datetime(2026, 12, 1)) == datetime(2027, 1, 1)


def test_estimates_input_and_output_tokens_without_mutating_payload() -> None:
    """Token estimation includes configured output reserve and preserves input."""
    payload = {"messages": [{"role": "user", "content": "x" * 40}], "max_tokens": 25}
    before = payload.copy()
    assert estimate_tokens(payload) == 35
    assert payload == before


def test_quota_exceeded_has_positive_retry_after() -> None:
    """Quota errors always expose a retry delay safe for HTTP headers."""
    error = QuotaExceeded(0)
    assert error.retry_after == 1


def test_unsupported_window_is_rejected() -> None:
    """Unknown quota windows fail explicitly instead of using a wrong bucket."""
    with pytest.raises(ValueError, match="Unsupported quota window"):
        _window_start("week", datetime.now(UTC))
