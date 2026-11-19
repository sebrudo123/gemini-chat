#!/usr/bin/env bash
# Arranca el backend de Core IA en tu equipo con SQLite.
#
#   ./scripts/start-backend.sh
#
# La primera vez crea .env.local con SESSION_SECRET y AGENT_API_KEY, prepara un
# entorno virtual en backend/.venv e instala las dependencias. Después solo
# arranca uvicorn en http://127.0.0.1:8000.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"
BACKEND="$ROOT/backend"

gen() { python3 -c "import secrets; print(secrets.token_urlsafe(32))"; }

if [ ! -f "$ENV_FILE" ]; then
  echo "· Creando $ENV_FILE con claves nuevas…"
  cat > "$ENV_FILE" <<EOF
# Configuración local de Core IA. No subas este archivo al repositorio.
SESSION_SECRET=$(gen)
AGENT_API_KEY=$(gen)
# Clave gratuita de Google AI Studio (https://aistudio.google.com/apikey).
# Si la dejas vacía, se usa el motor abierto con límite de velocidad.
AI_API_KEY=
AI_MODEL=gemini-3.5-flash
RAG_ENABLED=false
DISCORD_BOT_AUTOSTART=false
EOF
  chmod 600 "$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

export DATABASE_URL="${DATABASE_URL:-sqlite:///$BACKEND/coreia.db}"

cd "$BACKEND"

if [ ! -d ".venv" ]; then
  echo "· Creando entorno virtual e instalando dependencias (una sola vez)…"
  python3 -m venv .venv
  ./.venv/bin/python -m pip install --upgrade pip >/dev/null
  ./.venv/bin/pip install -r requirements.txt
fi

KEY="$(grep '^AGENT_API_KEY=' "$ENV_FILE" | cut -d= -f2-)"

echo
echo "  Core IA — backend local"
echo "  URL        http://127.0.0.1:8000"
echo "  Clave      $KEY"
echo "  Base       $DATABASE_URL"
echo
echo "  Configura el CLI:  coreia config --backend http://127.0.0.1:8000 --key $KEY"
echo

exec ./.venv/bin/python -m uvicorn main:app \
  --host 127.0.0.1 --port "${PORT:-8000}" --proxy-headers
