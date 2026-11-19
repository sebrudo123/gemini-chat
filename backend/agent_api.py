"""API del agente de Core IA para el CLI y la app de escritorio.

El cliente (CLI o app Tauri) mantiene las sesiones y ejecuta las
herramientas localmente con confirmación del usuario. El backend solo:

* valida la clave ``X-Agent-API-Key`` (comparación en tiempo constante);
* añade el prompt de sistema del agente;
* completa el turno con el motor gratuito configurado;
* devuelve el texto por streaming (SSE) o de una vez.

Así la clave del proveedor de IA nunca sale del servidor y la app solo
conoce el nombre comercial ``Core Model V1``.
"""

from __future__ import annotations

import hmac
import json
import logging
from collections.abc import Iterator
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

import llm
from config import settings

LOG = logging.getLogger("coreia.agent")

MODEL_LABEL = "Core Model V1"

AGENT_TOOLS = [
    "read_file",
    "write_file",
    "list_dir",
    "run_command",
    "create_dir",
    "delete_path",
]

AGENT_SYSTEM_PROMPT = """Eres Core IA Agent, el agente de programación de Core IA.
Trabajas dentro del CLI y de la app de escritorio Core IA Studio.

Reglas de comportamiento:
- Responde siempre en español, de forma clara y directa.
- Si falta información para hacer bien la tarea, haz UNA sola pregunta con
  2 a 4 opciones. Usa exactamente este formato:
<question>{"header":"Título corto","prompt":"La pregunta","options":[{"label":"Opción A","description":"Qué implica"},{"label":"Opción B","description":"Qué implica"}]}</question>
- Para usar una herramienta escribe SOLO un bloque por acción:
<tool>{"tool":"read_file","args":{"path":"archivo.txt"},"reason":"Para revisar el contenido"}</tool>
- Herramientas disponibles:
  * read_file {"path": "ruta"}
  * write_file {"path": "ruta", "content": "texto completo"}
  * list_dir {"path": "."}
  * run_command {"command": "comando"}
  * create_dir {"path": "ruta"}
  * delete_path {"path": "ruta"}
- Nunca inventes el resultado de una herramienta: espera a recibir un
  bloque <tool_result>.
- Puedes proponer varias herramientas independientes en el mismo turno.
- Antes de escribir o borrar archivos, explica brevemente qué vas a hacer
  dentro del campo "reason"; el usuario debe confirmarlo.
- No muestres rutas absolutas del sistema, tokens ni secretos.
- Si el usuario pide un proyecto, primero pregunta nombre, carpeta y
  tecnología con <question>, y después crea los archivos paso a paso.
- Al terminar, da un resumen breve de lo hecho y los siguientes pasos.
- Si el usuario pide código, entrega el código completo en bloques markdown.
"""


class AgentMessage(BaseModel):
    """Un mensaje del historial enviado por el cliente."""

    role: Literal["user", "assistant", "tool", "system"] = "user"
    content: str = Field(..., min_length=0, max_length=200_000)


class AgentChatRequest(BaseModel):
    """Solicitud de un turno del agente."""

    messages: list[AgentMessage] = Field(..., min_length=1, max_length=100)
    mode: Literal["chat", "agent"] = "agent"
    stream: bool = True


class AgentHealthResponse(BaseModel):
    ok: bool
    model: str
    tools: list[str]


class _PartialStreamError(Exception):
    """El proveedor falló después de enviar texto: no se puede reintentar."""


def _agent_models() -> list[str]:
    """Modelos a probar, en orden y sin duplicados."""
    primary = settings.agent_model or settings.ai_model
    models = [primary, settings.ai_model, *settings.ai_model_fallbacks]
    return list(dict.fromkeys(model for model in models if model))


def _use_gemini() -> bool:
    """¿Debe usarse Gemini (gratuito) para el agente?"""
    provider = (settings.agent_provider or "auto").lower()
    if provider in {"free", "llm", "openai", "pollinations"}:
        return False
    if provider == "gemini":
        return True
    # auto: Gemini primero si hay clave; el motor abierto queda de respaldo.
    return bool(settings.ai_api_key)


def _gemini_contents(
    messages: list[dict[str, str]],
) -> tuple[str, list[types.Content]]:
    """Convierte el historial al formato de Gemini, fusionando roles seguidos."""
    system_parts: list[str] = []
    contents: list[types.Content] = []

    for message in messages:
        role = message["role"]
        text = message["content"]
        if role == "system":
            system_parts.append(text)
            continue
        gemini_role = "model" if role == "assistant" else "user"
        if contents and contents[-1].role == gemini_role:
            contents[-1].parts.append(types.Part(text=text))
        else:
            contents.append(
                types.Content(role=gemini_role, parts=[types.Part(text=text)])
            )

    return "\n\n".join(system_parts).strip(), contents


def _gemini_client() -> genai.Client:
    if not settings.ai_api_key:
        raise RuntimeError("No hay AI_API_KEY configurada.")
    return genai.Client(api_key=settings.ai_api_key)


def _gemini_stream(messages: list[dict[str, str]]) -> Iterator[str]:
    """Genera texto con Gemini probando los modelos de respaldo."""
    system, contents = _gemini_contents(messages)
    if not contents:
        raise RuntimeError("No hay mensajes para enviar.")
    client = _gemini_client()
    config = types.GenerateContentConfig(
        system_instruction=system or None,
        temperature=0.35,
    )

    last_error: Exception | None = None
    for model in _agent_models():
        yielded = False
        try:
            stream = client.models.generate_content_stream(
                model=model, contents=contents, config=config
            )
            for chunk in stream:
                text = getattr(chunk, "text", None)
                if text:
                    yielded = True
                    yield text
            return
        except Exception as exc:  # noqa: BLE001 - se prueba el siguiente modelo
            last_error = exc
            LOG.warning("Gemini falló para el agente (%s): %s", model, exc)
            if yielded:
                raise _PartialStreamError(str(exc)) from exc

    raise RuntimeError("Ningún modelo de Gemini respondió.") from last_error


def _gemini_complete(messages: list[dict[str, str]]) -> str:
    """Completa un turno con Gemini probando los modelos de respaldo."""
    system, contents = _gemini_contents(messages)
    if not contents:
        raise RuntimeError("No hay mensajes para enviar.")
    client = _gemini_client()
    config = types.GenerateContentConfig(
        system_instruction=system or None,
        temperature=0.35,
    )

    last_error: Exception | None = None
    for model in _agent_models():
        try:
            response = client.models.generate_content(
                model=model, contents=contents, config=config
            )
            text = (getattr(response, "text", None) or "").strip()
            if text:
                return text
        except Exception as exc:  # noqa: BLE001 - se prueba el siguiente modelo
            last_error = exc
            LOG.warning("Gemini falló para el agente (%s): %s", model, exc)

    raise RuntimeError("Ningún modelo de Gemini respondió.") from last_error


def _generate_stream(messages: list[dict[str, str]]) -> Iterator[str]:
    """Streaming con Gemini y respaldo al motor abierto."""
    if _use_gemini():
        try:
            yield from _gemini_stream(messages)
            return
        except _PartialStreamError:
            raise
        except Exception as exc:  # noqa: BLE001 - probar el motor abierto
            LOG.warning("Gemini no disponible; se usa el motor abierto: %s", exc)
    yield from llm.stream_messages(messages)


def _generate_complete(messages: list[dict[str, str]]) -> str:
    """Respuesta completa con Gemini y respaldo al motor abierto."""
    if _use_gemini():
        try:
            return _gemini_complete(messages)
        except Exception as exc:  # noqa: BLE001 - probar el motor abierto
            LOG.warning("Gemini no disponible; se usa el motor abierto: %s", exc)
    return llm.complete_messages(messages)


def _expected_key() -> str:
    """Clave válida del agente (AGENT_API_KEY o, si falta, la de Vantage)."""
    return (settings.agent_api_key or settings.vantage_api_key).strip()


def verify_agent_api_key(
    x_agent_api_key: str | None = Header(None, alias="X-Agent-API-Key"),
    authorization: str | None = Header(None),
) -> None:
    """Valida la clave del agente en tiempo constante."""
    expected = _expected_key()
    if not expected:
        if settings.agent_allow_anonymous:
            # Despliegue público sin clave: el limitador por IP protege el uso.
            return
        raise HTTPException(
            status_code=503,
            detail="El servidor no tiene configurada la variable AGENT_API_KEY.",
        )

    provided = (x_agent_api_key or "").strip()
    if not provided and authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer":
            provided = value.strip()

    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(
            status_code=401,
            detail="Clave de agente inválida.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _prepare_messages(
    messages: list[AgentMessage], mode: str
) -> list[dict[str, str]]:
    """Normaliza el historial y lo recorta para no exceder el contexto."""
    prepared: list[dict[str, str]] = []
    for message in messages:
        content = (message.content or "").strip()
        if not content:
            continue
        if message.role == "tool":
            role = "user"
            content = f"<tool_result>\n{content}\n</tool_result>"
        elif message.role == "system":
            # El cliente no puede sobrescribir el prompt del agente.
            continue
        else:
            role = "user" if message.role == "user" else "assistant"
        prepared.append({"role": role, "content": content})

    prepared = prepared[-40:]
    total = sum(len(item["content"]) for item in prepared)
    while total > settings.agent_max_history_chars and len(prepared) > 1:
        total -= len(prepared[0]["content"])
        prepared.pop(0)

    if mode == "agent":
        prepared.insert(0, {"role": "system", "content": AGENT_SYSTEM_PROMPT})
    return prepared


def _sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _stream_sse(messages: list[dict[str, str]]) -> Iterator[str]:
    """Genera los eventos SSE del turno del agente."""
    try:
        for delta in _generate_stream(messages):
            yield _sse_event({"delta": delta})
        yield _sse_event({"done": True, "model": MODEL_LABEL})
    except Exception:  # noqa: BLE001 - el detalle queda solo en el servidor
        LOG.exception("Fallo el motor de IA del agente")
        yield _sse_event(
            {
                "error": "El modelo no respondió. Inténtalo de nuevo.",
                "done": True,
            }
        )


def build_router(limiter) -> APIRouter:
    """Construye el router con el limitador de peticiones de la app."""
    router = APIRouter(prefix="/api/agent", tags=["agent"])

    @router.get("/health", response_model=AgentHealthResponse)
    @limiter.limit(settings.agent_rate_limit)
    async def agent_health(
        request: Request,
        _: None = Depends(verify_agent_api_key),
    ) -> AgentHealthResponse:
        """Comprueba la clave y devuelve la información pública del agente."""
        return AgentHealthResponse(
            ok=True,
            model=MODEL_LABEL,
            tools=AGENT_TOOLS,
        )

    @router.post("/chat")
    @limiter.limit(settings.agent_rate_limit)
    async def agent_chat(
        request: Request,
        payload: AgentChatRequest,
        _: None = Depends(verify_agent_api_key),
    ) -> dict:
        """Completa un turno sin streaming."""
        messages = _prepare_messages(payload.messages, payload.mode)
        try:
            text = _generate_complete(messages)
        except Exception as exc:  # noqa: BLE001 - no filtrar detalles internos
            LOG.warning("Fallo el motor de IA del agente: %s", exc)
            raise HTTPException(
                status_code=502,
                detail="El modelo no respondió. Inténtalo de nuevo.",
            ) from exc

        return {
            "message": text,
            "model": MODEL_LABEL,
            "ok": True,
        }

    @router.post("/chat/stream")
    @limiter.limit(settings.agent_rate_limit)
    async def agent_chat_stream(
        request: Request,
        payload: AgentChatRequest,
        _: None = Depends(verify_agent_api_key),
    ) -> StreamingResponse:
        """Completa un turno devolviendo eventos SSE."""
        messages = _prepare_messages(payload.messages, payload.mode)
        return StreamingResponse(
            _stream_sse(messages),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return router
