"""Core IA - Backend FastAPI (Enterprise).

Características:
    - Autenticación OAuth2 con Discord y sesiones firmadas (itsdangerous).
    - Persistencia de usuarios, conversaciones y mensajes (SQLAlchemy).
    - Chat con Google Gemini (SDK oficial google-genai) con reintentos y
      modelos de respaldo ante saturación.
    - Rate limiting por usuario/cliente (slowapi, con soporte de Redis).
    - Observabilidad opcional con Sentry.

Consulta el README para las variables de entorno.
"""

import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from google import genai
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from cache import is_enabled as cache_is_enabled
from config import settings
from database import get_db, init_db
from models import Conversation, Message, User

# --------------------------------------------------------------------------- #
# Observabilidad (Sentry opcional)
# --------------------------------------------------------------------------- #

if settings.sentry_dsn:
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.environment,
            traces_sample_rate=0.1,
            send_default_pii=False,
        )
    except Exception:  # noqa: BLE001 - nunca impedir el arranque
        pass

# --------------------------------------------------------------------------- #
# Constantes
# --------------------------------------------------------------------------- #

DISCORD_API = "https://discord.com/api/v10"
DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
DISCORD_TOKEN_URL = f"{DISCORD_API}/oauth2/token"
DISCORD_USER_URL = f"{DISCORD_API}/users/@me"
SESSION_SALT = "core-ia.session.v1"

TRANSIENT_MARKERS = (
    "503",
    "UNAVAILABLE",
    "429",
    "RESOURCE_EXHAUSTED",
    "500",
    "INTERNAL",
    "overloaded",
    "high demand",
)

serializer = URLSafeTimedSerializer(settings.session_secret, salt=SESSION_SALT)
genai_client = genai.Client(api_key=settings.ai_api_key) if settings.ai_api_key else None


# --------------------------------------------------------------------------- #
# Rate limiting
# --------------------------------------------------------------------------- #

def rate_limit_key(request: Request) -> str:
    """Clave de rate limiting: por token de sesión o, si no, por IP."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return f"tok:{auth.split(' ', 1)[1].strip()[-32:]}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=rate_limit_key, storage_uri=settings.redis_url or "memory://")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    init_db()
    yield


app = FastAPI(title="Core IA API", version="2.1.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
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


def allowed_return_url(return_to: str | None) -> str:
    """Valida que la URL de retorno pertenezca a un origen permitido."""
    if not return_to:
        return f"{settings.frontend_url}/"
    parsed = urlparse(return_to)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in settings.allowed_origins:
        return f"{settings.frontend_url}/"
    path = parsed.path or "/"
    if not path.endswith("/"):
        path = path.rsplit("/", 1)[0] + "/"
    return f"{origin}{path}"


def resolve_return_url(state: str | None) -> str:
    """Obtiene la URL de retorno desde un `state` firmado."""
    try:
        data = serializer.loads(state or "", max_age=settings.state_max_age)
        return allowed_return_url(data.get("return_to"))
    except (BadSignature, SignatureExpired):
        return f"{settings.frontend_url}/"


def create_session_token(profile: dict[str, Any]) -> str:
    """Genera un token firmado con los datos públicos del usuario."""
    return serializer.dumps({"user": profile})


def get_current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Valida el token Bearer y devuelve el perfil del usuario."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = serializer.loads(token, max_age=settings.token_max_age)
    except SignatureExpired as exc:
        raise HTTPException(status_code=401, detail="La sesión ha expirado.") from exc
    except BadSignature as exc:
        raise HTTPException(status_code=401, detail="Token de sesión inválido.") from exc

    user = payload.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Token de sesión inválido.")
    return user


def upsert_user(db: Session, profile: dict[str, Any]) -> User:
    """Crea o actualiza el usuario a partir del perfil de Discord."""
    user = db.query(User).filter(User.discord_id == profile.get("id")).first()
    if user is None:
        user = User(discord_id=profile.get("id"))
        db.add(user)
    user.username = profile.get("username")
    user.display_name = profile.get("display_name")
    user.email = profile.get("email")
    user.avatar_url = profile.get("avatar_url")
    db.commit()
    db.refresh(user)
    return user


def is_transient_error(exc: Exception) -> bool:
    """Determina si un error de Gemini es temporal (saturación, rate limit)."""
    text = str(exc)
    return any(marker in text for marker in TRANSIENT_MARKERS)


def generate_reply(message: str) -> str:
    """Genera una respuesta probando varios modelos y reintentos."""
    models = [settings.ai_model] + [m for m in settings.ai_model_fallbacks if m != settings.ai_model]
    last_error: Exception | None = None

    for model in models:
        for attempt in range(max(1, settings.ai_retries)):
            try:
                response = genai_client.models.generate_content(model=model, contents=message)
                return (response.text or "").strip()
            except Exception as exc:  # noqa: BLE001 - se decide según el tipo de error
                last_error = exc
                if not is_transient_error(exc):
                    raise HTTPException(
                        status_code=502,
                        detail=f"Error al contactar con Gemini ({model}): {exc}",
                    ) from exc
                if attempt < settings.ai_retries - 1:
                    time.sleep(1.2 * (attempt + 1))

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Core IA está experimentando alta demanda. Inténtalo de nuevo en unos segundos.",
    ) from last_error


# --------------------------------------------------------------------------- #
# Modelos de entrada/salida
# --------------------------------------------------------------------------- #

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    conversation_id: int | None = None


class ChatResponse(BaseModel):
    reply: str
    conversation_id: int | None = None


class UserResponse(BaseModel):
    user: dict[str, Any]


# --------------------------------------------------------------------------- #
# Salud
# --------------------------------------------------------------------------- #

@app.get("/")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "core-ia", "cache": cache_is_enabled()}


# --------------------------------------------------------------------------- #
# Autenticación con Discord OAuth2
# --------------------------------------------------------------------------- #

@app.get("/api/auth/discord/login")
def discord_login(return_to: str | None = None) -> RedirectResponse:
    """Redirige al usuario a la pantalla de autorización de Discord."""
    client_id = require_config(settings.discord_client_id, "DISCORD_CLIENT_ID")
    redirect_uri = require_config(settings.discord_redirect_uri, "DISCORD_REDIRECT_URI")

    state = serializer.dumps(
        {"nonce": secrets.token_urlsafe(16), "return_to": allowed_return_url(return_to)}
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
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Intercambia el `code`, obtiene el perfil y crea la sesión."""
    if error or not code:
        return RedirectResponse(f"{resolve_return_url(state)}?auth=error")

    try:
        state_data = serializer.loads(state or "", max_age=settings.state_max_age)
    except (BadSignature, SignatureExpired) as exc:
        raise HTTPException(status_code=400, detail="Estado OAuth inválido o expirado.") from exc

    client_id = require_config(settings.discord_client_id, "DISCORD_CLIENT_ID")
    client_secret = require_config(settings.discord_client_secret, "DISCORD_CLIENT_SECRET")
    redirect_uri = require_config(settings.discord_redirect_uri, "DISCORD_REDIRECT_URI")

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
    upsert_user(db, profile)

    token = create_session_token(profile)
    return_url = allowed_return_url(state_data.get("return_to"))
    return RedirectResponse(f"{return_url}#token={token}")


@app.get("/api/auth/me", response_model=UserResponse)
def auth_me(user: dict[str, Any] = Depends(get_current_user)) -> UserResponse:
    """Devuelve el perfil del usuario autenticado."""
    return UserResponse(user=user)


@app.post("/api/auth/logout")
def auth_logout(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, bool]:
    """Cierre de sesión (el cliente descarta el token)."""
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Chat con Gemini
# --------------------------------------------------------------------------- #

@app.post("/api/chat", response_model=ChatResponse)
@limiter.limit(settings.rate_limit)
def chat(
    request: Request,
    payload: ChatRequest,
    profile: dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    """Genera una respuesta de Gemini y persiste la conversación."""
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío.")
    if genai_client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="El servidor no tiene configurada AI_API_KEY.",
        )

    user = upsert_user(db, profile)

    conversation = None
    if payload.conversation_id is not None:
        conversation = (
            db.query(Conversation)
            .filter(
                Conversation.id == payload.conversation_id,
                Conversation.user_id == user.id,
            )
            .first()
        )
    if conversation is None:
        conversation = Conversation(user_id=user.id, title=message[:60] or "Nuevo chat")
        db.add(conversation)
        db.commit()
        db.refresh(conversation)

    db.add(Message(conversation_id=conversation.id, role="user", content=message))
    db.commit()

    reply = generate_reply(message)

    db.add(Message(conversation_id=conversation.id, role="assistant", content=reply))
    db.commit()

    return ChatResponse(reply=reply, conversation_id=conversation.id)
