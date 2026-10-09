"""Common provider errors and adapter contract."""

from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any, Protocol

import httpx


@dataclass(slots=True)
class ProviderError(Exception):
    """Normalized upstream error used by routing and fallback."""

    status_code: int
    message: str
    retry_after: int | None = None
    attempts: int = 0
    routing: dict[str, Any] | None = None


class ProviderAdapter(Protocol):
    """Async chat interface implemented by provider adapters."""

    async def chat(self, model: str, payload: dict[str, Any]) -> dict[str, Any]: ...


def parse_retry_after(value: str | None) -> int | None:
    """Parse Retry-After as seconds or an HTTP date."""
    if not value:
        return None
    if value.isdigit():
        return max(1, int(value))
    try:
        retry_at = parsedate_to_datetime(value)
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=UTC)
        return max(1, int((retry_at - datetime.now(UTC)).total_seconds()))
    except (TypeError, ValueError, OverflowError):
        return None


class OpenAICompatibleAdapter:
    """Adapter for providers implementing the OpenAI chat completions protocol."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float,
        additional_headers: dict[str, str] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.additional_headers = additional_headers or {}

    async def chat(self, model: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Send one completion request and normalize HTTP failures."""
        body = {**payload, "model": model, "stream": False}
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        headers.update(self.additional_headers)
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    json=body,
                    headers=headers,
                )
        except httpx.TimeoutException as exc:
            raise ProviderError(504, "Provider timed out") from exc
        except httpx.HTTPError as exc:
            raise ProviderError(502, "Provider network error") from exc
        if response.is_error:
            retry_after = parse_retry_after(response.headers.get("Retry-After"))
            raise ProviderError(
                response.status_code,
                "Provider rejected the request"
                if response.status_code < 500
                else "Provider request failed",
                retry_after,
            )
        try:
            result = response.json()
        except ValueError as exc:
            raise ProviderError(502, "Provider returned invalid JSON") from exc
        if not isinstance(result, dict):
            raise ProviderError(502, "Provider returned an invalid response")
        return result


class GoogleAIStudioAdapter:
    """Adapter translating chat messages to the Gemini generateContent API."""

    def __init__(self, base_url: str, api_key: str, timeout: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    async def chat(self, model: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Translate a basic text chat request and normalize the Gemini response."""
        messages = payload.get("messages", [])

        def google_parts(content: Any) -> list[dict[str, Any]]:
            if isinstance(content, str):
                return [{"text": content}]
            parts: list[dict[str, Any]] = []
            for part in content if isinstance(content, list) else []:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    parts.append({"text": str(part.get("text", ""))})
                    continue
                if part.get("type") != "image_url":
                    continue
                image = part.get("image_url", {})
                url = image.get("url", "") if isinstance(image, dict) else ""
                if not isinstance(url, str) or not url.startswith("data:") or "," not in url:
                    raise ProviderError(400, "Google image requests require a base64 data URL")
                header, data = url[5:].split(",", maxsplit=1)
                mime_type = header.split(";", maxsplit=1)[0]
                if "base64" not in header or not mime_type.startswith("image/"):
                    raise ProviderError(
                        400, "Google image requests require a base64 image data URL"
                    )
                parts.append({"inlineData": {"mimeType": mime_type, "data": data}})
            return parts

        system_parts = [
            {"text": str(message.get("content", ""))}
            for message in messages
            if message.get("role") == "system"
        ]
        contents = [
            {
                "role": "model" if message.get("role") == "assistant" else "user",
                "parts": google_parts(message.get("content", "")),
            }
            for message in messages
            if message.get("role") != "system"
        ]
        body: dict[str, Any] = {"contents": contents}
        if system_parts:
            body["systemInstruction"] = {"parts": system_parts}
        generation_config: dict[str, Any] = {}
        if "temperature" in payload:
            generation_config["temperature"] = payload["temperature"]
        if "max_tokens" in payload:
            generation_config["maxOutputTokens"] = payload["max_tokens"]
        if generation_config:
            body["generationConfig"] = generation_config
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/models/{model}:generateContent",
                    params={"key": self.api_key},
                    json=body,
                )
        except httpx.TimeoutException as exc:
            raise ProviderError(504, "Provider timed out") from exc
        except httpx.HTTPError as exc:
            raise ProviderError(502, "Provider network error") from exc
        if response.is_error:
            retry_after = parse_retry_after(response.headers.get("Retry-After"))
            raise ProviderError(
                response.status_code,
                "Provider rejected the request"
                if response.status_code < 500
                else "Provider request failed",
                retry_after,
            )
        try:
            result = response.json()
            candidate = result["candidates"][0]
            text = "".join(part.get("text", "") for part in candidate["content"]["parts"])
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ProviderError(502, "Provider returned an invalid response") from exc
        usage = result.get("usageMetadata", {})
        prompt_tokens = int(usage.get("promptTokenCount", 0))
        completion_tokens = int(usage.get("candidatesTokenCount", 0))
        return {
            "id": result.get("responseId", "relevo-gemini"),
            "object": "chat.completion",
            "created": 0,
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": text},
                    "finish_reason": candidate.get("finishReason", "STOP").lower(),
                }
            ],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
        }
