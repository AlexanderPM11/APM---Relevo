"""Single-process sliding-window limits for the single-worker deployment."""

import asyncio
import time
from collections import defaultdict, deque

_events: defaultdict[str, deque[float]] = defaultdict(deque)
_lock = asyncio.Lock()


async def allow_request(key: str, limit: int, window_seconds: int) -> bool:
    """Record an event and report whether it stays within a sliding window."""
    now = time.monotonic()
    async with _lock:
        events = _events[key]
        while events and now - events[0] >= window_seconds:
            events.popleft()
        if len(events) >= limit:
            return False
        events.append(now)
        return True
