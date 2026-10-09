"""Laya HTTP integration and conservative local routing decisions."""

import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import Settings

TASKS: dict[str, str] = {
    "conversation": "General conversation, questions, or advice",
    "writing": "Writing, editing, translation, or tone changes",
    "summarization": "Summarizing, extracting, or organizing information",
    "programming": "Writing, explaining, debugging, or reviewing code",
    "reasoning": "Multi-step analysis, planning, or decisions with constraints",
    "other": "Anything not covered by the other categories",
}
COMPLEXITIES: dict[str, str] = {
    "simple": "One clear step; short answer; no substantial reasoning",
    "intermediate": "Several details or steps, but a bounded and familiar task",
    "complex": "Many constraints, deep reasoning, difficult code, or high ambiguity",
}
PROFILE_LEVEL = {"light": 1, "balanced": 2, "advanced": 3}


@dataclass(frozen=True, slots=True)
class RoutingDecision:
    """Task classification plus trace metadata safe to expose in request logs."""

    task: str
    complexity: str
    confidence: float
    classifier: str
    classifier_ms: int
    fallback: str | None = None


def _state_from_messages(messages: list[dict[str, Any]]) -> str:
    """Serialize a small text-only tail; never forward image payloads or base64."""
    parts: list[str] = []
    for message in messages[-6:]:
        content = message.get("content", "")
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            text = " ".join(
                str(item.get("text", ""))
                for item in content
                if isinstance(item, dict) and item.get("type") in {"text", "input_text"}
            )
        else:
            text = ""
        if text.strip():
            parts.append(f"{message.get('role', 'user')}: {text}")
    return "\n".join(parts)[-6000:]


def _local_decision(state: str, elapsed_ms: int, reason: str) -> RoutingDecision:
    """Use conservative, deterministic rules when Laya cannot classify."""
    lowered = state.lower()
    programming_terms = (
        "```",
        "def ",
        "class ",
        "stack trace",
        "exception",
        "typescript",
        "python",
    )
    if any(term in lowered for term in programming_terms):
        task = "programming"
    elif any(term in lowered for term in ("summarize", "summary", "resume", "resumen", "extract")):
        task = "summarization"
    elif any(
        term in lowered for term in ("translate", "traduce", "traducción", "rewrite", "redacta")
    ):
        task = "writing"
    else:
        task = "conversation"
    complexity = "complex" if len(state) > 2400 or state.count("\n") > 14 else "intermediate"
    return RoutingDecision(task, complexity, 0.0, "rules", elapsed_ms, reason)


async def classify_with_laya(
    client: httpx.AsyncClient | None,
    settings: Settings,
    messages: list[dict[str, Any]],
) -> RoutingDecision:
    """Classify a request via Laya; degrade to local rules on any service failure."""
    started = time.monotonic()
    state = _state_from_messages(messages)

    def elapsed() -> int:
        return int((time.monotonic() - started) * 1000)

    if client is None or not state:
        return _local_decision(
            state, elapsed(), "laya_client_unavailable" if client is None else "empty_text"
        )
    body = {
        "state": state,
        "model": settings.laya_classifier_model,
        "max_len": 2048,
        "head_max_len": 384,
        "min_confidence": settings.laya_min_confidence,
        "questions": {
            "task": {
                "type": "choice",
                "instructions": "Classify the user's primary task.",
                "criteria": TASKS,
            },
            "complexity": {
                "type": "choice",
                "instructions": "Estimate reasoning difficulty, not message length alone.",
                "criteria": COMPLEXITIES,
            },
        },
    }
    headers = {}
    if settings.laya_api_key:
        headers["Authorization"] = f"Bearer {settings.laya_api_key.get_secret_value()}"
    try:
        response = await client.post(
            f"{settings.laya_base_url.rstrip('/')}/v1/systemone",
            json=body,
            headers=headers,
            timeout=settings.laya_timeout_seconds,
        )
        response.raise_for_status()
        result = response.json()
        answers = result.get("answers", {})
        task_answer = answers.get("task", {})
        complexity_answer = answers.get("complexity", {})
        task = task_answer.get("choice")
        complexity = complexity_answer.get("choice")
        confidence = min(
            float(task_answer.get("answer_confidence", 0.0)),
            float(complexity_answer.get("answer_confidence", 0.0)),
        )
        if (
            task not in TASKS
            or complexity not in COMPLEXITIES
            or confidence < settings.laya_min_confidence
            or result.get("usage", {}).get("truncated")
        ):
            return _local_decision(state, elapsed(), "low_confidence_or_truncated")
        return RoutingDecision(task, complexity, confidence, "laya", elapsed())
    except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError):
        return _local_decision(state, elapsed(), "laya_unavailable_or_invalid")


def order_by_decision(
    candidates: list[tuple[Any, Any]], decision: RoutingDecision
) -> list[tuple[Any, Any]]:
    """Prefer a task-compatible model at the least profile meeting complexity."""
    required = {"simple": 1, "intermediate": 2, "complex": 3}[decision.complexity]

    def score(pair: tuple[Any, Any]) -> tuple[int, int, int, int, int]:
        model, _provider = pair
        profile = PROFILE_LEVEL.get(model.routing_profile or "", 0)
        tasks = model.routing_tasks or []
        task_match = bool(tasks and decision.task in tasks)
        profile_match = profile >= required
        # Preserve existing order for unconfigured catalog entries.
        profile_distance = abs(profile - required) if profile else 10
        return (
            0 if profile_match or profile == 0 else 1,
            0 if task_match or not tasks else 1,
            0 if profile_match else 1,
            profile_distance,
            model.tier * 10000 + model.priority,
        )

    return sorted(candidates, key=score)
