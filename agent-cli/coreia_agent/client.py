"""Cliente HTTP del backend de Core IA."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Iterator
from typing import Any

MODEL_LABEL = "Core Model V1"
USER_AGENT = "coreia-cli/0.1.0"


class AgentError(Exception):
    """Error controlado del backend o de la red."""


class AgentClient:
    """Habla con ``/api/agent/*`` usando la clave del agente."""

    def __init__(self, backend: str, api_key: str, timeout: float = 180.0) -> None:
        self.backend = backend.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    # ------------------------------------------------------------------ #
    # Utilidades
    # ------------------------------------------------------------------ #
    def _headers(self, accept: str = "application/json") -> dict[str, str]:
        return {
            "Accept": accept,
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
            "X-Agent-API-Key": self.api_key,
        }

    def _request(self, path: str, payload: dict | None, accept: str):
        url = f"{self.backend}{path}"
        body = None
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            headers=self._headers(accept),
            method="POST" if body is not None else "GET",
        )
        try:
            return urllib.request.urlopen(request, timeout=self.timeout)
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode("utf-8", "replace")[:300]
            except Exception:  # noqa: BLE001 - cuerpo no legible
                pass
            if exc.code == 401:
                raise AgentError(
                    "La clave del agente no es válida. Configúrala con "
                    "`coreia config --key ...`."
                ) from exc
            if exc.code == 503:
                raise AgentError(
                    "El servidor no tiene configurada la clave del agente."
                ) from exc
            raise AgentError(
                f"El backend respondió {exc.code}. {detail}".strip()
            ) from exc
        except urllib.error.URLError as exc:
            raise AgentError(
                f"No se pudo conectar con {self.backend}: {exc.reason}"
            ) from exc

    # ------------------------------------------------------------------ #
    # API
    # ------------------------------------------------------------------ #
    def health(self) -> dict[str, Any]:
        with self._request("/api/agent/health", None, "application/json") as response:
            return json.loads(response.read().decode("utf-8"))

    def complete(self, messages: list[dict], mode: str = "agent") -> str:
        payload = {"messages": messages, "mode": mode, "stream": False}
        with self._request("/api/agent/chat", payload, "application/json") as response:
            data = json.loads(response.read().decode("utf-8"))
        return str(data.get("message", ""))

    def stream(self, messages: list[dict], mode: str = "agent") -> Iterator[str]:
        """Genera los fragmentos de texto del turno (SSE)."""
        payload = {"messages": messages, "mode": mode, "stream": True}
        response = self._request(
            "/api/agent/chat/stream", payload, "text/event-stream"
        )
        try:
            for raw in response:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data:
                    continue
                try:
                    event = json.loads(data)
                except ValueError:
                    continue
                if event.get("error"):
                    raise AgentError(str(event["error"]))
                delta = event.get("delta")
                if delta:
                    yield str(delta)
                if event.get("done"):
                    return
        finally:
            response.close()
