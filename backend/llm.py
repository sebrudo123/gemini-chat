"""Motor de chat propio de Core IA.

Core IA puede responder con modelos abiertos (Llama, Qwen, Mistral, DeepSeek…)
a través de cualquier API compatible con OpenAI:

* Groq        → https://api.groq.com/openai/v1
* OpenRouter  → https://openrouter.ai/api/v1
* Cerebras    → https://api.cerebras.ai/v1
* Cloudflare  → .../accounts/{id}/ai/v1
* Ollama      → http://localhost:11434/v1 (modelo autoalojado)

Si no hay ningún proveedor configurado, `resolve()` devuelve `None` y la app
sigue usando Gemini como respaldo (así el cambio es reversible y no rompe la
producción mientras se añaden las claves).
"""

from __future__ import annotations

import base64
import io
import json
from collections.abc import Iterator
from typing import Any

import httpx

from config import settings

DEFAULTS: dict[str, dict[str, str]] = {
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
        "vision_model": "meta-llama/llama-4-scout-17b-16e-instruct",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "model": "minimax/minimax-m3.1-flash:free",
        "vision_model": "minimax/minimax-m3.1-flash:free",
    },
    "cerebras": {
        "base_url": "https://api.cerebras.ai/v1",
        "model": "llama-3.3-70b",
        "vision_model": "",
    },
    "cloudflare": {
        "base_url": "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
        "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        "vision_model": "",
    },
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "model": "llama3.1",
        "vision_model": "",
    },
    "pollinations": {
        "base_url": "https://text.pollinations.ai/openai",
        "model": "openai-fast",
        "vision_model": "",
    },
}


def _provider_key(provider: str) -> str:
    """Clave específica de cada proveedor (si no se usó LLM_API_KEY)."""
    return {
        "groq": settings.groq_api_key,
        "openrouter": settings.openrouter_api_key,
        "cerebras": settings.cerebras_api_key,
        "cloudflare": settings.cloudflare_api_token,
    }.get(provider, "")


def resolve() -> dict[str, Any] | None:
    """Configuración del motor propio, o `None` para usar Gemini."""
    provider = (settings.llm_provider or "auto").lower()
    key = settings.llm_api_key

    if provider == "auto":
        if settings.groq_api_key:
            provider, key = "groq", settings.groq_api_key
        elif settings.openrouter_api_key:
            provider, key = "openrouter", settings.openrouter_api_key
        elif settings.cerebras_api_key:
            provider, key = "cerebras", settings.cerebras_api_key
        elif settings.cloudflare_api_token and settings.cloudflare_account_id:
            provider, key = "cloudflare", settings.cloudflare_api_token
        elif settings.llm_base_url:
            provider, key = "custom", key or "local"
        else:
            return None
    elif not key:
        key = _provider_key(provider)

    if provider == "gemini":
        return None

    preset = DEFAULTS.get(provider, {})
    base_url = settings.llm_base_url or preset.get("base_url", "")
    if provider == "cloudflare":
        base_url = base_url.format(account_id=settings.cloudflare_account_id)
    if not base_url:
        return None
    if not key and provider not in {"ollama", "custom", "pollinations"}:
        return None

    return {
        "provider": provider,
        "base_url": base_url.rstrip("/"),
        "api_key": key,
        "model": settings.llm_model or preset.get("model", ""),
        "vision_model": settings.llm_vision_model or preset.get("vision_model", ""),
    }


def available() -> bool:
    """¿Hay un motor propio configurado?"""
    return resolve() is not None


def provider_name() -> str:
    """Nombre corto del motor activo (para /api/config y diagnósticos)."""
    cfg = resolve()
    return cfg["provider"] if cfg else "gemini"


def _headers(cfg: dict[str, Any]) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if cfg["api_key"]:
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
    if cfg["provider"] == "openrouter":
        headers["HTTP-Referer"] = settings.frontend_url
        headers["X-Title"] = "Core IA"
    return headers


def _image_part(attachment: Any) -> dict[str, Any]:
    encoded = base64.b64encode(attachment.data).decode("ascii")
    return {
        "type": "image_url",
        "image_url": {"url": f"data:{attachment.mime};base64,{encoded}"},
    }


def pdf_text(attachment: Any, max_pages: int = 30, max_chars: int = 60_000) -> str:
    """Extrae el texto de un PDF para los modelos sin visión de documentos."""
    try:
        from pypdf import PdfReader
    except Exception:  # noqa: BLE001 - dependencia opcional
        return ""
    try:
        reader = PdfReader(io.BytesIO(attachment.data))
        pages = [page.extract_text() or "" for page in reader.pages[:max_pages]]
        return "\n\n".join(pages).strip()[:max_chars]
    except Exception:  # noqa: BLE001 - PDF dañado o cifrado
        return ""


def build_messages(
    message: str,
    system_instruction: str | None = None,
    attachment: Any | None = None,
    use_vision: bool = True,
) -> list[dict[str, Any]]:
    """Construye los mensajes en formato OpenAI, con imagen o PDF si lo hay."""
    messages: list[dict[str, Any]] = []
    if system_instruction:
        messages.append({"role": "system", "content": system_instruction})

    content: Any = message
    if attachment is not None:
        mime = (getattr(attachment, "mime", "") or "").lower()
        if mime.startswith("image/") and use_vision:
            content = [
                {"type": "text", "text": message},
                _image_part(attachment),
            ]
        elif mime == "application/pdf":
            text = pdf_text(attachment)
            if text:
                content = f"{message}\n\n[Contenido del PDF]\n{text}"
            else:
                content = (
                    f"{message}\n\n[El usuario adjuntó un PDF que no se pudo "
                    "leer; pídele que lo pegue como texto.]"
                )
        elif mime.startswith("image/"):
            content = (
                f"{message}\n\n[El usuario adjuntó una imagen, pero el motor "
                "actual no admite visión. Explícaselo amablemente.]"
            )
    messages.append({"role": "user", "content": content})
    return messages


def _payload(
    cfg: dict[str, Any],
    messages: list[dict[str, Any]],
    temperature: float | None,
    stream: bool,
    model: str | None = None,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "model": model or cfg["model"],
        "messages": messages,
        "stream": stream,
    }
    if temperature is not None:
        data["temperature"] = temperature
    return data


def _timeout(cfg: dict[str, Any]) -> float:
    """Los modelos gratuitos con razonamiento pueden tardar más en arrancar."""
    return 180.0 if cfg["provider"] == "pollinations" else 120.0


def _stream_line_text(line: str) -> str:
    """Extrae el texto de una línea SSE de un proveedor OpenAI-compatible."""
    data = line[5:].strip() if line.startswith("data:") else line.strip()
    if not data or data == "[DONE]":
        return ""
    try:
        event = json.loads(data)
    except json.JSONDecodeError:
        return ""
    choices = event.get("choices") or []
    if not choices:
        return ""
    delta = choices[0].get("delta") or {}
    return delta.get("content") or ""


def stream_text(
    message: str,
    system_instruction: str | None = None,
    temperature: float | None = None,
    attachment: Any | None = None,
) -> Iterator[str]:
    """Genera texto en streaming con el motor propio."""
    cfg = resolve()
    if cfg is None:
        raise RuntimeError("No hay motor de chat configurado.")

    vision = bool(
        attachment is not None
        and (getattr(attachment, "mime", "") or "").startswith("image/")
        and cfg["vision_model"]
    )
    model = cfg["vision_model"] if vision else cfg["model"]
    messages = build_messages(message, system_instruction, attachment, use_vision=bool(cfg["vision_model"]))
    payload = _payload(cfg, messages, temperature, stream=True, model=model)

    with httpx.stream(
        "POST",
        f"{cfg['base_url']}/chat/completions",
        headers=_headers(cfg),
        json=payload,
        timeout=_timeout(cfg),
    ) as response:
        if response.status_code >= 400:
            detail = response.read().decode("utf-8", "ignore")[:300]
            raise RuntimeError(f"{response.status_code}: {detail}")
        for line in response.iter_lines():
            text = _stream_line_text(line)
            if text:
                yield text


def complete_text(
    message: str,
    system_instruction: str | None = None,
    temperature: float | None = None,
    attachment: Any | None = None,
) -> str:
    """Genera una respuesta completa (sin streaming) con el motor propio."""
    cfg = resolve()
    if cfg is None:
        raise RuntimeError("No hay motor de chat configurado.")

    vision = bool(
        attachment is not None
        and (getattr(attachment, "mime", "") or "").startswith("image/")
        and cfg["vision_model"]
    )
    model = cfg["vision_model"] if vision else cfg["model"]
    messages = build_messages(message, system_instruction, attachment, use_vision=bool(cfg["vision_model"]))
    payload = _payload(cfg, messages, temperature, stream=False, model=model)

    response = httpx.post(
        f"{cfg['base_url']}/chat/completions",
        headers=_headers(cfg),
        json=payload,
        timeout=_timeout(cfg),
    )
    if response.status_code >= 400:
        raise RuntimeError(f"{response.status_code}: {response.text[:300]}")
    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        return ""
    return (choices[0].get("message", {}).get("content") or "").strip()
