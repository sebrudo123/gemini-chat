"""Core IA - Backend FastAPI (Enterprise).

Módulos:
    - Autenticación OAuth2 con Discord.
    - Sesiones firmadas de forma segura (itsdangerous).
    - Chat con Google Gemini mediante el SDK oficial google-genai.

Variables de entorno requeridas:
    SESSION_SECRET         Clave para firmar los tokens de sesión.
    AI_API_KEY             Clave de la API de Google Gemini.
    DISCORD_CLIENT_ID      Client ID de la aplicación de Discord.
    DISCORD_CLIENT_SECRET  Client Secret de la aplicación de Discord.
    DISCORD_REDIRECT_URI   URL de callback registrada en Discord.

Variables opcionales:
    AI_MODEL               Modelo de Gemini (por defecto gemini-3.8-flash).
    FRONTEND_URL           URL del frontend para redirecciones post-login.
    ALLOWED_ORIGINS        Orígenes CORS permitidos (separados por coma).
    TOKEN_MAX_AGE          Vigencia del token de sesión en segundos.
"""

import os
import secrets
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from google import genai
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, Field

load_dotenv()

# --------------------------------------------------------------------------- #
# Configuración
# --------------------------------------------------------------------------- #

AI_API_KEY = os.environ.get("AI_API_KEY", "")
AI_MODEL = os.environ.get("AI_MODEL", "gemini-3.8-flash")

DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI = os.environ.get("DISCORD_REDIRECT_URI", "")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5500").rstrip("/")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")
TOKEN_MAX_AGE = int(os.environ.get("TOKEN_MAX_AGE", str(60 * 60 * 24 * 7)))
STATE_MAX_AGE = 600

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", FRONTEND_URL).split(",")
    if origin.strip()
]

DISCORD_API = "https://discord.com/api/v10"
DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
DISCORD_TOKEN_URL = f"{DISCORD_API}/oauth2/token"
DISCORD_USER_URL = f"{DISCORD_API}/users/@me"
SESSION_SALT = "core-ia.session.v1"

if not SESSION_SECRET:
    raise RuntimeError("Debes definir SESSION_SECRET en el entorno.")

serializer = URLSafeTimedSerializer(SESSION_SECRET, salt=SESSION_SALT)
genai_client = genai.Client(api_key=AI_API_KEY) if AI_API_KEY else None

app = FastAPI(title="Core IA API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# --------------------------------------------------------------------------- #
# Utilidades
# --------------------------------------------------------------------------- #

def require_config(value: str, name: str) -> str:
    """Devuelve `value` o lanza un 503 si la configuración falta."""
    if not value:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"El servidor no tiene configurada la variable {name}.",
        )
    return value


def allowed_return_url(return_to: str | None) -> str:
    """Valida que la URL de retorno pertenezca a un origen permitido."""
    if not return_to:
        return f"{FRONTEND_URL}/"
    parsed = urlparse(return_to)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in ALLOWED_ORIGINS:
        return f"{FRONTEND_URL}/"
    path = parsed.path or "/"
    if not path.endswith("/"):
        path = path.rsplit("/", 1)[0] + "/"
    return f"{origin}{path}"


def resolve_return_url(state: str | None) -> str:
    """Obtiene la URL de retorno desde un `state` firmado (con valor por defecto)."""
    try:
        data = serializer.loads(state or "", max_age=STATE_MAX_AGE)
        return allowed_return_url(data.get("return_to"))
    except (BadSignature, SignatureExpired):
        return f"{FRONTEND_URL}/"


def build_avatar_url(user: dict[str, Any]) -> str | None:
    """Construye la URL del avatar del usuario de Discord."""
    user_id = user.get("id")
    avatar = user.get("avatar")
    if not user_id:
        return None
    if avatar:
        ext = "gif" if str(avatar).startswith("a_") else "png"
        return f"https://cdn.discordapp.com/avatars/{user_id}/{avatar}.{ext}?size=128"
    index = (int(user_id) >> 22) % 6
    return f"https://cdn.discordapp.com/embed/avatars/{index}.png"


def create_session_token(user: dict[str, Any]) -> str:
    """Genera un token firmado con los datos públicos del usuario."""
    return serializer.dumps({"user": user})


def get_current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Dependencia que valida el token Bearer y devuelve el usuario."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = serializer.loads(token, max_age=TOKEN_MAX_AGE)
    except SignatureExpired as exc:
        raise HTTPException(status_code=401, detail="La sesión ha expirado.") from exc
    except BadSignature as exc:
        raise HTTPException(status_code=401, detail="Token de sesión inválido.") from exc

    user = payload.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Token de sesión inválido.")
    return user


# --------------------------------------------------------------------------- #
# Modelos
# --------------------------------------------------------------------------- #

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)


class ChatResponse(BaseModel):
    reply: str


class UserResponse(BaseModel):
    user: dict[str, Any]


# --------------------------------------------------------------------------- #
# Salud
# --------------------------------------------------------------------------- #

@app.get("/")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "core-ia"}


# --------------------------------------------------------------------------- #
# Autenticación con Discord OAuth2
# --------------------------------------------------------------------------- #

@app.get("/api/auth/discord/login")
def discord_login(return_to: str | None = None) -> RedirectResponse:
    """Redirige al usuario a la pantalla de autorización de Discord."""
    client_id = require_config(DISCORD_CLIENT_ID, "DISCORD_CLIENT_ID")
    redirect_uri = require_config(DISCORD_REDIRECT_URI, "DISCORD_REDIRECT_URI")

    state = serializer.dumps(
        {
            "nonce": secrets.token_urlsafe(16),
            "return_to": allowed_return_url(return_to),
        }
    )
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "identify email",
        "state": state,
        "prompt": "consent",
    }
    return RedirectResponse(f"{DISCORD_AUTHORIZE_URL}?{urlencode(params)}")


@app.get("/api/auth/discord/callback")
async def discord_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Intercambia el `code` por un token, obtiene el perfil y crea la sesión."""
    if error or not code:
        return RedirectResponse(f"{resolve_return_url(state)}?auth=error")

    try:
        state_data = serializer.loads(state or "", max_age=STATE_MAX_AGE)
    except (BadSignature, SignatureExpired) as exc:
        raise HTTPException(status_code=400, detail="Estado OAuth inválido o expirado.") from exc

    client_id = require_config(DISCORD_CLIENT_ID, "DISCORD_CLIENT_ID")
    client_secret = require_config(DISCORD_CLIENT_SECRET, "DISCORD_CLIENT_SECRET")
    redirect_uri = require_config(DISCORD_REDIRECT_URI, "DISCORD_REDIRECT_URI")

    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(
            DISCORD_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if token_resp.status_code != 200:
            raise HTTPException(status_code=401, detail="No se pudo obtener el token de Discord.")

        access_token = token_resp.json().get("access_token")
        if not access_token:
            raise HTTPException(status_code=401, detail="Discord no devolvió un access token.")

        user_resp = await client.get(
            DISCORD_USER_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_resp.status_code != 200:
            raise HTTPException(status_code=401, detail="No se pudo obtener el perfil de Discord.")
        discord_user = user_resp.json()

    profile = {
        "id": discord_user.get("id"),
        "username": discord_user.get("username"),
        "display_name": discord_user.get("global_name") or discord_user.get("username"),
        "email": discord_user.get("email"),
        "avatar_url": build_avatar_url(discord_user),
    }

    token = create_session_token(profile)
    return_url = allowed_return_url(state_data.get("return_to"))
    return RedirectResponse(f"{return_url}#token={token}")


@app.get("/api/auth/me", response_model=UserResponse)
def auth_me(user: dict[str, Any] = Depends(get_current_user)) -> UserResponse:
    """Devuelve el perfil del usuario autenticado."""
    return UserResponse(user=user)


@app.post("/api/auth/logout")
def auth_logout(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, bool]:
    """Punto de cierre de sesión (el cliente descarta el token)."""
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Chat con Gemini
# --------------------------------------------------------------------------- #

@app.post("/api/chat", response_model=ChatResponse)
def chat(
    payload: ChatRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> ChatResponse:
    """Genera una respuesta de Gemini para el mensaje del usuario autenticado."""
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío.")
    if genai_client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="El servidor no tiene configurada AI_API_KEY.",
        )

    try:
        response = genai_client.models.generate_content(
            model=AI_MODEL,
            contents=message,
        )
    except Exception as exc:  # noqa: BLE001 - se propaga el detalle a la API
        raise HTTPException(status_code=502, detail=f"Error al contactar con Gemini: {exc}") from exc

    return ChatResponse(reply=(response.text or "").strip())
