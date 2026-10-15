"""Configuración común para las pruebas (se ejecuta antes de importar main)."""

import os

# Base de datos de pruebas limpia en cada ejecución (evita conflictos 409 en local).
_TEST_DB = "test_coreia.db"
if os.path.exists(_TEST_DB):
    os.remove(_TEST_DB)

os.environ["SESSION_SECRET"] = "test-secret-key"
os.environ["DISCORD_CLIENT_ID"] = "1234567890"
os.environ["DISCORD_CLIENT_SECRET"] = "test-secret"
os.environ["DISCORD_REDIRECT_URI"] = "http://testserver/api/auth/discord/callback"
os.environ["AI_API_KEY"] = "test-key"
os.environ["DATABASE_URL"] = "sqlite:///./test_coreia.db"
os.environ["ALLOWED_ORIGINS"] = "http://localhost:5500"
os.environ["REDIS_URL"] = ""
os.environ["SENTRY_DSN"] = ""
# Neutralizar transportes de correo para que las pruebas no hagan llamadas de red
# (config.py llama a load_dotenv(), que no sobrescribe variables ya definidas).
os.environ["EMAIL_RELAY_URL"] = ""
os.environ["EMAIL_RELAY_TOKEN"] = ""
os.environ["BREVO_API_KEY"] = ""
os.environ["RESEND_API_KEY"] = ""
os.environ["SMTP_HOST"] = ""
os.environ["SMTP_USER"] = ""
os.environ["SMTP_PASSWORD"] = ""
