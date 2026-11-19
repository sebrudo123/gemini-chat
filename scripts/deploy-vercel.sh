#!/usr/bin/env bash
# Publica el backend del agente en Vercel.
#
#   VERCEL_TOKEN=... ./scripts/deploy-vercel.sh
#
# Opcionales:
#   VERCEL_PROJECT=gemini-chat-backend-six
#   AI_API_KEY=...        (si falta, el agente usa el motor abierto)
#   AGENT_API_KEY=...     (si falta, el endpoint es público con rate limit)
#
# Necesita Node.js (usa `npx vercel`). No guarda el token en el repositorio.
set -euo pipefail

: "${VERCEL_TOKEN:?Define VERCEL_TOKEN con un token de https://vercel.com/account/tokens}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT="${VERCEL_PROJECT:-gemini-chat-backend-six}"
VERCEL="npx --yes vercel@latest"

echo "· Autenticando…"
$VERCEL whoami --token "$VERCEL_TOKEN"

echo "· Vinculando el proyecto $PROJECT…"
$VERCEL link --yes --project "$PROJECT" --token "$VERCEL_TOKEN"

add_env() {
  local name="$1" value="${2:-}"
  if [ -z "$value" ]; then
    echo "  (omitido) $name"
    return
  fi
  printf '%s' "$value" | $VERCEL env add "$name" production --force --token "$VERCEL_TOKEN" >/dev/null
  echo "  ✓ $name"
}

echo "· Variables de entorno…"
add_env AI_API_KEY "${AI_API_KEY:-}"
add_env AI_MODEL "gemini-3.5-flash"
add_env AI_MODEL_FALLBACKS "gemini-3.5-flash,gemini-3.5-flash-lite"
add_env AGENT_API_KEY "${AGENT_API_KEY:-}"
add_env AGENT_RATE_LIMIT "40/minute"
add_env ALLOWED_ORIGINS "https://${PROJECT}.vercel.app,tauri://localhost,http://tauri.localhost"

echo "· Desplegando en producción…"
$VERCEL deploy --prod --yes --token "$VERCEL_TOKEN"

echo
echo "Comprueba:  curl https://${PROJECT}.vercel.app/api/agent/health"
