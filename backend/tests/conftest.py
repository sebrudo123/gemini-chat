"""Configuración común para las pruebas (se ejecuta antes de importar main)."""

import os

os.environ["SESSION_SECRET"] = "test-secret-key"
os.environ["DISCORD_CLIENT_ID"] = "1234567890"
os.environ["DISCORD_CLIENT_SECRET"] = "test-secret"
os.environ["DISCORD_REDIRECT_URI"] = "http://testserver/api/auth/discord/callback"
os.environ["AI_API_KEY"] = "test-key"
os.environ["DATABASE_URL"] = "sqlite:///./test_coreia.db"
os.environ["ALLOWED_ORIGINS"] = "http://localhost:5500"
os.environ["REDIS_URL"] = ""
os.environ["SENTRY_DSN"] = ""
