"""Configuración local del CLI.

Se guarda en ``~/.coreia/config.json`` (o en ``COREIA_HOME``).
La clave de API nunca se escribe en los repositorios ni en los logs.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

DEFAULT_BACKEND = "https://gemini-chat-backend-vyrz.onrender.com"


def home() -> Path:
    """Carpeta de datos del CLI."""
    return Path(os.environ.get("COREIA_HOME", "~/.coreia")).expanduser()


def config_path() -> Path:
    return home() / "config.json"


def _defaults() -> dict[str, Any]:
    return {
        "backend": os.environ.get("COREIA_BACKEND", DEFAULT_BACKEND).rstrip("/"),
        "api_key": "",
        "workspace": str(Path.cwd()),
    }


def load() -> dict[str, Any]:
    """Carga la configuración, completando valores por defecto."""
    data = _defaults()
    path = config_path()
    if path.exists():
        try:
            stored = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            stored = {}
        if isinstance(stored, dict):
            data.update({k: v for k, v in stored.items() if v is not None})
    # Una variable de entorno siempre gana sobre el archivo.
    env_backend = os.environ.get("COREIA_BACKEND")
    if env_backend:
        data["backend"] = env_backend.rstrip("/")
    return data


def save(config: dict[str, Any]) -> None:
    """Guarda la configuración con permisos solo para el usuario."""
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    try:
        path.chmod(0o600)
    except OSError:
        pass


def api_key(config: dict[str, Any] | None = None) -> str:
    """Clave de API: entorno > archivo de configuración."""
    env_key = os.environ.get("COREIA_API_KEY", "").strip()
    if env_key:
        return env_key
    return str((config or load()).get("api_key", "")).strip()


def workspace(config: dict[str, Any] | None = None) -> Path:
    """Carpeta de trabajo donde el agente puede leer y escribir."""
    raw = str((config or load()).get("workspace", "")).strip() or str(Path.cwd())
    return Path(os.path.expandvars(os.path.expanduser(raw))).resolve()
