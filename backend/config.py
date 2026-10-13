"""Configuración central de Core IA.

Todas las variables se leen desde el entorno (o desde `.env` en local)
y se exponen mediante el objeto `settings`.
"""

import os

from dotenv import load_dotenv

load_dotenv()

DEFAULT_FALLBACKS = "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.7-flash,gemini-flash-latest"


class Settings:
    """Contenedor tipado de la configuración de la aplicación."""

    def __init__(self) -> None:
        # --- IA ---
        self.ai_api_key = os.environ.get("AI_API_KEY", "")
        self.ai_model = os.environ.get("AI_MODEL", "gemini-3.8-flash")
        self.ai_model_fallbacks = [
            model.strip()
            for model in os.environ.get("AI_MODEL_FALLBACKS", DEFAULT_FALLBACKS).split(",")
            if model.strip()
        ]
        self.ai_retries = int(os.environ.get("AI_RETRIES", "2"))
        self.image_model = os.environ.get("IMAGE_MODEL", "")
        self.embedding_model = os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001")
        self.rag_enabled = os.environ.get("RAG_ENABLED", "true").lower() in ("1", "true", "yes")
        self.rag_top_k = int(os.environ.get("RAG_TOP_K", "4"))

        # --- Discord OAuth2 ---
        self.discord_client_id = os.environ.get("DISCORD_CLIENT_ID", "")
        self.discord_client_secret = os.environ.get("DISCORD_CLIENT_SECRET", "")
        self.discord_redirect_uri = os.environ.get("DISCORD_REDIRECT_URI", "")

        # --- Sesión / frontend ---
        self.session_secret = os.environ.get("SESSION_SECRET", "")
        self.token_max_age = int(os.environ.get("TOKEN_MAX_AGE", str(60 * 60 * 24 * 7)))
        self.state_max_age = 600
        self.frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:5500").rstrip("/")
        self.allowed_origins = [
            origin.strip()
            for origin in os.environ.get("ALLOWED_ORIGINS", self.frontend_url).split(",")
            if origin.strip()
        ]

        # --- Infraestructura ---
        self.database_url = os.environ.get("DATABASE_URL", "sqlite:///./coreia.db")
        self.redis_url = os.environ.get("REDIS_URL", "")
        self.sentry_dsn = os.environ.get("SENTRY_DSN", "")
        self.environment = os.environ.get("ENVIRONMENT", "production")
        self.rate_limit = os.environ.get("RATE_LIMIT", "30/minute")

        if not self.session_secret:
            raise RuntimeError("Debes definir SESSION_SECRET en el entorno.")


settings = Settings()
