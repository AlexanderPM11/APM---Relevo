"""Laya HTTP integration and conservative local routing decisions."""

import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import Settings

TASKS: dict[str, str] = {
    "conversation": (
        "Preguntas, charla o consejos generales. No la uses para solicitudes concretas de un plan."
    ),
    "writing": (
        "Redactar, editar, traducir o cambiar el tono de un texto; por ejemplo, traducir una frase."
    ),
    "summarization": "Resumir, extraer datos u organizar información ya proporcionada.",
    "programming": (
        "La petición principal trata de código fuente, funciones, errores de software o pruebas"
        " de código. Una API mencionada en un plan no significa programación."
    ),
    "reasoning": (
        "La petición principal es analizar, planificar o decidir con varios pasos; por ejemplo,"
        " plan de migración, riesgos, dependencias o alternativas. No requiere que la tarea sea"
        " de código."
    ),
    "other": "Tarea concreta que no encaja en las demás categorías.",
}
COMPLEXITIES: dict[str, str] = {
    "simple": (
        "Una sola acción directa, como traducir una frase o responder un dato. No la uses solo"
        " porque el mensaje sea corto."
    ),
    "intermediate": (
        "Dos o tres pasos relacionados y acotados, como resumir y ordenar información o corregir"
        " un error sencillo."
    ),
    "complex": (
        "Plan multietapa con varias dependencias o restricciones, evaluar riesgos y"
        " alternativas, diseñar una migración o resolver un problema difícil."
    ),
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
    """Use deterministic, task-aware rules when Laya cannot classify."""
    task = _rule_task(state) or "conversation"
    complexity = _rule_complexity(state)
    return RoutingDecision(task, complexity, 0.0, "rules", elapsed_ms, reason)


def _rule_task(state: str) -> str | None:
    """Return only high-signal lexical categories; leave ambiguous text to Laya."""
    lowered = state.lower()
    if any(term in lowered for term in ("resume", "resumen", "summarize", "summary", "extract")):
        return "summarization"
    if any(
        term in lowered for term in ("traduce", "traducir", "traducción", "translate", "redacta")
    ):
        return "writing"
    code_signals = (
        "```",
        "def ",
        "class ",
        "stack trace",
        "traceback",
        "exception",
        "depura",
        "debug",
        "corrige el bug",
        "error de sintaxis",
        "revisa esta función",
    )
    if any(term in lowered for term in code_signals):
        return "programming"
    planning_signals = (
        "planifica",
        "planificar",
        "plan de ",
        "migración",
        "migracion",
        "dependencias",
        "riesgos",
        "reversión",
        "reversion",
        "alternativas",
        "compara opciones",
        "evalúa opciones",
        "evalua opciones",
    )
    if any(term in lowered for term in planning_signals):
        return "reasoning"
    return None


def _rule_complexity(state: str) -> str:
    """Estimate workload from explicit multi-step signals, independent of text size."""
    lowered = state.lower()
    complex_signals = (
        "migración",
        "migracion",
        "varios servicios",
        "varias dependencias",
        "riesgos",
        "reversión",
        "reversion",
        "alternativas",
        "restricciones",
        "paso a paso",
        "plan multietapa",
        "planifica una migración",
        "planifica una migracion",
    )
    if sum(term in lowered for term in complex_signals) >= 2:
        return "complex"
    multi_step_signals = (
        "incluye",
        "conserva",
        "explica",
        "propone",
        "caso de prueba",
        "tres viñetas",
        "three bullets",
        "and a ",
    )
    if len(state) >= 120 or sum(term in lowered for term in multi_step_signals) >= 2:
        return "intermediate"
    return "simple"


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
                "instructions": (
                    "Clasifica la acción que el usuario quiere que hagas, no los temas que"
                    " menciona. Si pide planificar, analizar riesgos o comparar opciones, usa"
                    " reasoning aunque mencione software o APIs. Solo usa programming si pide"
                    " trabajar directamente sobre código."
                ),
                "criteria": TASKS,
            },
            "complexity": {
                "type": "choice",
                "instructions": (
                    "Clasifica el trabajo solicitado, no el tamaño del texto. Reserva simple para"
                    " una única acción breve; un plan con dependencias, riesgos, varios servicios"
                    " y reversión es complex."
                ),
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
        rule_task = _rule_task(state)
        rule_complexity = _rule_complexity(state)
        adjusted_task = rule_task or task
        adjusted_complexity = rule_complexity
        if adjusted_task != task or adjusted_complexity != complexity:
            return RoutingDecision(
                adjusted_task,
                adjusted_complexity,
                confidence,
                "laya+rules",
                elapsed(),
                "decision_adjusted_by_rules",
            )
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
