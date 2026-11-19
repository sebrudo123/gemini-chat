"""Sesiones locales del CLI, guardadas como JSON en ``~/.coreia/sessions``."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import config


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_session(title: str = "Nueva sesión") -> dict[str, Any]:
    stamp = _now()
    return {
        "id": uuid.uuid4().hex[:12],
        "title": title,
        "created_at": stamp,
        "updated_at": stamp,
        "messages": [],
    }


class SessionStore:
    """Almacén de sesiones en disco."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or (config.home() / "sessions")
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, session_id: str) -> Path:
        safe = "".join(ch for ch in session_id if ch.isalnum() or ch in "-_")
        if not safe:
            raise ValueError("Identificador de sesión inválido.")
        return self.root / f"{safe}.json"

    def save(self, session: dict[str, Any]) -> None:
        session["updated_at"] = _now()
        target = self.path(str(session["id"]))
        target.write_text(
            json.dumps(session, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def load(self, session_id: str) -> dict[str, Any]:
        target = self.path(session_id)
        if not target.exists():
            raise FileNotFoundError(f"No existe la sesión {session_id}.")
        data = json.loads(target.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or "messages" not in data:
            raise ValueError(f"La sesión {session_id} está dañada.")
        return data

    def list(self) -> list[dict[str, Any]]:
        sessions: list[dict[str, Any]] = []
        for path in self.root.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(data, dict) or "id" not in data:
                continue
            sessions.append(
                {
                    "id": str(data["id"]),
                    "title": str(data.get("title", "Sin título")),
                    "updated_at": str(data.get("updated_at", "")),
                    "messages": len(data.get("messages") or []),
                }
            )
        sessions.sort(key=lambda item: item["updated_at"], reverse=True)
        return sessions

    def delete(self, session_id: str) -> bool:
        target = self.path(session_id)
        if target.exists():
            target.unlink()
            return True
        return False


def default_title(text: str) -> str:
    """Título corto a partir del primer mensaje del usuario."""
    clean = " ".join(str(text).split()).strip()
    if not clean:
        return "Nueva sesión"
    return clean[:48] + ("…" if len(clean) > 48 else "")
