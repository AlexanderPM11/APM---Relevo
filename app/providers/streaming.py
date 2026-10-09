"""SSE decoding shared by streaming provider adapters."""

import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import httpx

from app.providers.base import ProviderError

DeltaCallback = Callable[[str], Awaitable[None]]


async def sse_json(response: httpx.Response) -> AsyncIterator[dict[str, Any]]:
    """Read complete SSE frames, including multiline data and a final unterminated frame."""
    data: list[str] = []
    async for line in response.aiter_lines():
        if line.startswith("data:"):
            data.append(line[5:].lstrip())
        elif not line and data:
            raw = "\n".join(data)
            data.clear()
            if raw == "[DONE]":
                return
            yield _decode(raw)
    if data and "\n".join(data) != "[DONE]":
        yield _decode("\n".join(data))


def _decode(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except ValueError as exc:
        raise ProviderError(502, "Provider returned an invalid stream") from exc
    if not isinstance(value, dict):
        raise ProviderError(502, "Provider returned an invalid stream")
    if value.get("error"):
        raise ProviderError(502, "Provider stream failed")
    return value


def text_completion(
    model: str, text: str, usage: dict[str, Any], finish_reason: str | None
) -> dict[str, Any]:
    """Aggregate streamed text into the same completion shape as ordinary chat."""
    if not text:
        raise ProviderError(502, "Provider returned no text content")
    if not finish_reason:
        raise ProviderError(502, "Provider stream ended before completion")
    return {
        "id": "relevo-stream",
        "object": "chat.completion",
        "created": 0,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": finish_reason or "stop",
            }
        ],
        "usage": usage,
    }
