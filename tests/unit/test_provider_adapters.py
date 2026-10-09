"""HTTP adapter contract tests using simulated provider responses."""

import httpx
import pytest
import respx

from app.providers.base import (
    GoogleAIStudioAdapter,
    OpenAICompatibleAdapter,
    ProviderError,
    parse_retry_after,
)


def test_parse_retry_after_seconds_and_invalid_values() -> None:
    """Retry-After supports seconds and rejects malformed values."""
    assert parse_retry_after("17") == 17
    assert parse_retry_after("invalid") is None


@pytest.mark.asyncio
async def test_openai_compatible_adapter_returns_provider_json() -> None:
    """The generic adapter sends model and bearer auth and returns JSON."""
    with respx.mock(assert_all_called=True) as mock:
        route = mock.post("https://provider.example/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": [], "usage": {}})
        )
        adapter = OpenAICompatibleAdapter("https://provider.example/v1", "secret", 5)
        result = await adapter.chat("model-a", {"messages": [{"role": "user", "content": "Hi"}]})
    assert result["choices"] == []
    assert route.calls[0].request.headers["Authorization"] == "Bearer secret"
    assert route.calls[0].request.read() == (
        b'{"messages":[{"role":"user","content":"Hi"}],"model":"model-a","stream":false}'
    )


@pytest.mark.asyncio
async def test_openai_compatible_adapter_normalizes_rate_limit() -> None:
    """Rate-limit responses preserve Retry-After without leaking upstream body."""
    with respx.mock(assert_all_called=True) as mock:
        mock.post("https://provider.example/v1/chat/completions").mock(
            return_value=httpx.Response(
                429,
                headers={"Retry-After": "17"},
                json={"error": {"message": "private"}},
            )
        )
        adapter = OpenAICompatibleAdapter("https://provider.example/v1", "secret", 5)
        with pytest.raises(ProviderError) as raised:
            await adapter.chat("model-a", {"messages": []})
    assert raised.value.status_code == 429
    assert raised.value.retry_after == 17
    assert "private" not in raised.value.message


@pytest.mark.asyncio
async def test_google_adapter_translates_chat_messages() -> None:
    """Gemini adapter translates system and user messages to generateContent."""
    with respx.mock(assert_all_called=True) as mock:
        route = mock.post(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "responseId": "r1",
                    "candidates": [
                        {
                            "content": {"parts": [{"text": "Hello"}]},
                            "finishReason": "STOP",
                        }
                    ],
                    "usageMetadata": {"promptTokenCount": 2, "candidatesTokenCount": 1},
                },
            )
        )
        adapter = GoogleAIStudioAdapter(
            "https://generativelanguage.googleapis.com/v1beta", "secret", 5
        )
        result = await adapter.chat(
            "gemini-test",
            {
                "messages": [
                    {"role": "system", "content": "Be concise"},
                    {"role": "user", "content": "Hi"},
                ],
                "temperature": 0.2,
            },
        )
    assert result["choices"][0]["message"]["content"] == "Hello"
    assert result["usage"]["total_tokens"] == 3
    payload = route.calls[0].request.content
    assert b'"systemInstruction"' in payload
    assert b'"generationConfig"' in payload
