"""Common provider errors and adapter contract."""

from dataclasses import dataclass
from typing import Any, Protocol

import httpx


@dataclass(slots=True)
class ProviderError(Exception):
    """Normalized upstream error used by routing and fallback."""

    status_code: int
    message: str
    retry_after: int | None = None


class ProviderAdapter(Protocol):
    """Async chat interface implemented by provider adapters."""

    async def chat(self, model: str, payload: dict[str, Any]) -> dict[str, Any]: ...


class OpenAICompatibleAdapter:
    """Adapter for providers implementing the OpenAI chat completions protocol."""

    def __init__(self, base_url: str, api_key: str, timeout: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    async def chat(self, model: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Send one completion request and normalize HTTP failures."""
        body = {**payload, "model": model, "stream": False}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    json=body,
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
        except httpx.TimeoutException as exc:
            raise ProviderError(504, "Provider timed out") from exc
        except httpx.HTTPError as exc:
            raise ProviderError(502, "Provider network error") from exc
        if response.is_error:
            retry_after = response.headers.get("Retry-After")
            message = "Provider request failed"
            try:
                message = str(response.json().get("error", {}).get("message", message))
            except (ValueError, AttributeError):
                pass
            raise ProviderError(
                response.status_code,
                message,
                int(retry_after) if retry_after and retry_after.isdigit() else None,
            )
        result = response.json()
        if not isinstance(result, dict):
            raise ProviderError(502, "Provider returned an invalid response")
        return result
