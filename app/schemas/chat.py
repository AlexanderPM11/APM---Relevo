"""OpenAI-compatible chat request and response models."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ChatMessage(BaseModel):
    """A single chat message."""

    role: Literal["system", "user", "assistant", "tool"]
    content: str | list[dict[str, Any]]
    name: str | None = None
    tool_call_id: str | None = None


class ChatCompletionRequest(BaseModel):
    """Supported subset of the OpenAI chat completion request."""

    model: str = "auto"
    messages: list[ChatMessage] = Field(min_length=1)
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, ge=0, le=1)
    max_tokens: int | None = Field(default=None, gt=0)
    stream: bool = False
    tools: list[dict[str, Any]] | None = None
    response_format: dict[str, Any] | None = None
    model_config = ConfigDict(extra="allow")


class ChatCompletionResponse(BaseModel):
    """OpenAI-shaped completion envelope."""

    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[dict[str, Any]]
    usage: dict[str, int] = Field(default_factory=dict)
