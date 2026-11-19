"""Protocolo de bloques del agente.

El modelo responde con texto normal y, cuando necesita algo, con bloques:

    <tool>{"tool": "read_file", "args": {"path": "a.txt"}, "reason": "..."}</tool>
    <question>{"header": "...", "prompt": "...", "options": [...]}</question>

Funciona con cualquier modelo compatible con OpenAI, incluso si no soporta
function calling nativo.
"""

from __future__ import annotations

import json
import re
from typing import Any

ALLOWED_TOOLS = {
    "read_file",
    "write_file",
    "list_dir",
    "run_command",
    "create_dir",
    "delete_path",
}

# Se captura todo el contenido entre etiquetas (el JSON puede tener llaves
# anidadas) y luego se valida con json.loads.
TOOL_RE = re.compile(r"<tool>\s*(.*?)\s*</tool>", re.DOTALL)
QUESTION_RE = re.compile(r"<question>\s*(.*?)\s*</question>", re.DOTALL)


def _load_json(raw: str) -> dict[str, Any] | None:
    try:
        value = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return value if isinstance(value, dict) else None


def extract_tools(text: str) -> list[dict[str, Any]]:
    """Devuelve las herramientas válidas pedidas por el modelo."""
    tools: list[dict[str, Any]] = []
    for raw in TOOL_RE.findall(text or ""):
        data = _load_json(raw)
        if not data:
            continue
        name = str(data.get("tool", "")).strip()
        args = data.get("args")
        if args is None:
            args = {}
        if name not in ALLOWED_TOOLS or not isinstance(args, dict):
            continue
        tools.append(
            {
                "tool": name,
                "args": args,
                "reason": str(data.get("reason", "")).strip(),
            }
        )
    return tools


def extract_questions(text: str) -> list[dict[str, Any]]:
    """Devuelve las preguntas de opción múltiple del modelo."""
    questions: list[dict[str, Any]] = []
    for raw in QUESTION_RE.findall(text or ""):
        data = _load_json(raw)
        if not data:
            continue
        prompt = str(data.get("prompt", "")).strip()
        if not prompt:
            continue
        raw_options = data.get("options") or []
        options: list[dict[str, str]] = []
        if isinstance(raw_options, list):
            for option in raw_options[:6]:
                if isinstance(option, str) and option.strip():
                    options.append({"label": option.strip(), "description": ""})
                elif isinstance(option, dict) and str(option.get("label", "")).strip():
                    options.append(
                        {
                            "label": str(option["label"]).strip(),
                            "description": str(option.get("description", "")).strip(),
                        }
                    )
        questions.append(
            {
                "header": str(data.get("header", "Pregunta")).strip() or "Pregunta",
                "prompt": prompt,
                "options": options,
            }
        )
    return questions


def visible_text(text: str) -> str:
    """Quita los bloques para mostrar solo la respuesta legible."""
    cleaned = TOOL_RE.sub("", text or "")
    cleaned = QUESTION_RE.sub("", cleaned)
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


def tool_result(name: str, ok: bool, output: str) -> str:
    """Construye el resultado que se devuelve al modelo."""
    status = "ok" if ok else "error"
    return f"Herramienta: {name}\nEstado: {status}\nSalida:\n{output}"
