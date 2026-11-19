"""App ASGI mínima con el router del agente, para Vercel.

Solo importa `agent_api`, `llm` y `config`: no toca la base de datos ni el
login de Discord, así que puede desplegarse como función serverless sin
necesitar Postgres.

En Vercel cada archivo de `api/` es una función; los tres puntos de entrada
(`api/agent/health.py`, `api/agent/chat.py` y `api/agent/chat/stream.py`)
exportan la misma app y el router decide qué ruta responder.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from agent_api import build_router  # noqa: E402  (requiere el sys.path de arriba)
from config import settings  # noqa: E402


def create_agent_app() -> FastAPI:
    """Crea la app con el router del agente y su limitador de peticiones."""
    app = FastAPI(
        title="Core IA Agent",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    limiter = Limiter(key_func=get_remote_address)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins
        + [
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
            "http://localhost:1420",
        ],
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Agent-API-Key"],
    )

    app.include_router(build_router(limiter))
    return app


app = create_agent_app()
