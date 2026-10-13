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

import base64
import hashlib
import hmac
import re
import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from google import genai
from google.genai import types
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import func
from sqlalchemy.orm import Session

import plans
import rag
from cache import is_enabled as cache_is_enabled
from config import settings
from database import get_db, init_db
from models import (
    Conversation,
    Document,
    DocumentChunk,
    Message,
    Usage,
    User,
    UserSettings,
)
from tools import AVAILABLE_TOOLS

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

GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USER_URL = "https://openidconnect.googleapis.com/v1/userinfo"

SESSION_SALT = "core-ia.session.v1"

PROVIDER_COLUMNS = {
    "discord": "discord_id",
    "google": "google_id",
}

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


def hash_password(password: str) -> str:
    """Deriva un hash PBKDF2-SHA256 con salt aleatorio."""
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"pbkdf2_sha256$200000${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Comprueba una contraseña contra su hash almacenado."""
    try:
        algorithm, iterations, salt_hex, hash_hex = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        derived = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(derived.hex(), hash_hex)


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


def is_admin(profile: dict[str, Any] | None) -> bool:
    """Indica si el perfil pertenece a un fundador/administrador.

    Los fundadores se identifican por su ID de Discord.
    """
    if not profile:
        return False
    provider = (profile.get("provider") or "discord").lower()
    return provider == "discord" and str(profile.get("id")) in settings.founder_ids


def require_admin(profile: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Dependencia que restringe el acceso a los fundadores."""
    if not is_admin(profile):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso reservado al fundador.",
        )
    return profile


def delete_user_data(db: Session, user: User) -> None:
    """Elimina todos los datos asociados a un usuario (y el propio usuario)."""
    conv_ids = [row[0] for row in db.query(Conversation.id).filter(Conversation.user_id == user.id)]
    if conv_ids:
        db.query(Message).filter(Message.conversation_id.in_(conv_ids)).delete(
            synchronize_session=False
        )
    db.query(Conversation).filter(Conversation.user_id == user.id).delete(
        synchronize_session=False
    )

    doc_ids = [row[0] for row in db.query(Document.id).filter(Document.user_id == user.id)]
    if doc_ids:
        db.query(DocumentChunk).filter(DocumentChunk.document_id.in_(doc_ids)).delete(
            synchronize_session=False
        )
    db.query(Document).filter(Document.user_id == user.id).delete(synchronize_session=False)

    db.query(Usage).filter(Usage.user_id == user.id).delete(synchronize_session=False)
    db.query(UserSettings).filter(UserSettings.user_id == user.id).delete(
        synchronize_session=False
    )
    db.delete(user)
    db.commit()


def upsert_user(db: Session, profile: dict[str, Any]) -> User:
    """Crea o actualiza el usuario a partir del perfil de un proveedor OAuth.

    El perfil incluye `provider` (discord/google/email) e `id` (el
    identificador del usuario en ese proveedor). Si el proveedor no viene
    indicado se asume Discord (compatibilidad con tokens antiguos).
    """
    provider = (profile.get("provider") or "discord").lower()
    provider_id = profile.get("id")
    column = PROVIDER_COLUMNS.get(provider)

    user = None
    if column and provider_id:
        user = db.query(User).filter(getattr(User, column) == provider_id).first()

    # Vincula cuentas del mismo correo (Google verifica el email).
    if user is None and profile.get("email"):
        user = db.query(User).filter(User.email == profile.get("email")).first()

    if user is None:
        user = User()
        db.add(user)

    if column and provider_id:
        setattr(user, column, provider_id)
    user.username = profile.get("username") or user.username
    user.display_name = profile.get("display_name") or user.display_name
    user.email = profile.get("email") or user.email
    user.avatar_url = profile.get("avatar_url") or user.avatar_url
    db.commit()
    db.refresh(user)
    return user


def get_settings_row(db: Session, user: User) -> UserSettings:
    """Devuelve las preferencias del usuario, creándolas si no existen."""
    row = db.get(UserSettings, user.id)
    if row is None:
        row = UserSettings(user_id=user.id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def today_str() -> str:
    """Fecha actual en UTC (YYYY-MM-DD) para agrupar el consumo diario."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def get_usage_row(db: Session, user: User) -> Usage:
    """Devuelve (o crea) el registro de consumo del día para el usuario."""
    day = today_str()
    row = db.query(Usage).filter(Usage.user_id == user.id, Usage.day == day).first()
    if row is None:
        row = Usage(user_id=user.id, day=day, messages=0, images=0)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def count_documents(db: Session, user: User) -> int:
    """Número de documentos de conocimiento del usuario."""
    return db.query(Document).filter(Document.user_id == user.id).count()


def check_quota(db: Session, user: User, kind: str) -> Usage:
    """Valida la cuota diaria del plan; lanza 429 si se ha superado.

    Args:
        kind: ``message`` o ``image``.
    """
    limits = plans.limits_for(user.plan)
    limit_key = "messages_per_day" if kind == "message" else "images_per_day"
    limit = limits.get(limit_key)
    row = get_usage_row(db, user)
    used = row.messages if kind == "message" else row.images
    if limit is not None and used >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Has alcanzado el límite diario de tu plan {user.plan} "
                f"({limit}). Mejora tu plan para continuar."
            ),
        )
    return row


def bump_usage(db: Session, row: Usage, kind: str) -> None:
    """Incrementa el contador de consumo tras una operación correcta."""
    if kind == "message":
        row.messages += 1
    else:
        row.images += 1
    db.commit()


def is_transient_error(exc: Exception) -> bool:
    """Determina si un error de Gemini es temporal (saturación, rate limit)."""
    text = str(exc)
    return any(marker in text for marker in TRANSIENT_MARKERS)


def generate_reply(message: str, preferred_model: str | None = None) -> str:
    """Genera una respuesta probando varios modelos, con herramientas y reintentos.

    Primero intenta el *automatic function calling* (fecha/hora, cálculos).
    Si el modelo rechaza las herramientas, reintenta sin ellas para no
    degradar la experiencia.
    """
    primary = preferred_model or settings.ai_model
    models = [primary] + [
        m for m in ([settings.ai_model] + settings.ai_model_fallbacks) if m != primary
    ]
    last_error: Exception | None = None
    attempts = max(1, settings.ai_retries)

    for model in models:
        use_tools = True
        for attempt in range(attempts):
            try:
                config = (
                    types.GenerateContentConfig(tools=AVAILABLE_TOOLS) if use_tools else None
                )
                response = genai_client.models.generate_content(
                    model=model, contents=message, config=config
                )
                return (response.text or "").strip()
            except Exception as exc:  # noqa: BLE001 - se decide según el tipo de error
                last_error = exc
                if use_tools and not is_transient_error(exc):
                    use_tools = False
                    continue
                if not is_transient_error(exc):
                    raise HTTPException(
                        status_code=502,
                        detail=f"Error al contactar con Gemini ({model}): {exc}",
                    ) from exc
                if attempt < attempts - 1:
                    time.sleep(1.2 * (attempt + 1))

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Core IA está experimentando alta demanda. Inténtalo de nuevo en unos segundos.",
    ) from last_error


def retrieve_context(db: Session, user: User, message: str) -> str:
    """Recupera los fragmentos de conocimiento más relevantes para el mensaje."""
    if not settings.rag_enabled or genai_client is None:
        return ""
    rows = (
        db.query(DocumentChunk.id, DocumentChunk.content, DocumentChunk.embedding)
        .join(Document, Document.id == DocumentChunk.document_id)
        .filter(Document.user_id == user.id)
        .all()
    )
    if not rows:
        return ""
    try:
        fragments = rag.rank_chunks(
            message, [(row[0], row[1], row[2]) for row in rows], settings.rag_top_k
        )
    except Exception:  # noqa: BLE001 - RAG nunca debe romper el chat
        return ""
    return "\n\n".join(fragments)


# --------------------------------------------------------------------------- #
# Modelos de entrada/salida
# --------------------------------------------------------------------------- #

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    conversation_id: int | None = None
    use_rag: bool | None = None


class ChatResponse(BaseModel):
    reply: str
    conversation_id: int | None = None
    sources: int = 0


class UserResponse(BaseModel):
    user: dict[str, Any]


class ImageRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)


class ImageResponse(BaseModel):
    image: str
    mime_type: str


class DocumentRequest(BaseModel):
    title: str = Field(default="Documento", max_length=160)
    text: str = Field(..., min_length=1, max_length=50000)


class DocumentResponse(BaseModel):
    id: int
    title: str
    chunks: int


class SettingsRequest(BaseModel):
    theme: str | None = Field(default=None, pattern="^(dark|light)$")
    preferred_model: str | None = Field(default=None, max_length=64)
    use_rag: bool | None = None


class ConversationRenameRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)


# --------------------------------------------------------------------------- #
# Salud
# --------------------------------------------------------------------------- #

@app.get("/")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "core-ia", "cache": cache_is_enabled()}


# --------------------------------------------------------------------------- #
# Autenticación OAuth2 (Discord, Google) y por correo
# --------------------------------------------------------------------------- #

def _oauth_state(return_to: str | None) -> str:
    """Crea un `state` firmado con el nonce y la URL de retorno."""
    return serializer.dumps(
        {"nonce": secrets.token_urlsafe(16), "return_to": allowed_return_url(return_to)}
    )


def _read_state(state: str | None) -> dict[str, Any]:
    """Valida y decodifica el `state` firmado del flujo OAuth."""
    try:
        return serializer.loads(state or "", max_age=settings.state_max_age)
    except (BadSignature, SignatureExpired) as exc:
        raise HTTPException(status_code=400, detail="Estado OAuth inválido o expirado.") from exc


def _provider_env(provider: str) -> tuple[str, str, str]:
    """Devuelve (client_id, client_secret, redirect_uri) del proveedor."""
    if provider == "discord":
        return settings.discord_client_id, settings.discord_client_secret, settings.discord_redirect_uri
    if provider == "google":
        return settings.google_client_id, settings.google_client_secret, settings.google_redirect_uri
    raise HTTPException(status_code=404, detail="Proveedor de login no soportado.")


def enabled_providers() -> list[str]:
    """Proveedores habilitados y totalmente configurados."""
    providers: list[str] = []
    for provider in settings.auth_providers:
        if provider not in PROVIDER_COLUMNS:
            continue
        client_id, client_secret, redirect_uri = _provider_env(provider)
        if client_id and client_secret and redirect_uri:
            providers.append(provider)
    return providers


async def _exchange_code(token_url: str, data: dict[str, Any]) -> str:
    """Intercambia el `code` OAuth por un access token."""
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            token_url,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="No se pudo obtener el token del proveedor.")
    access_token = response.json().get("access_token")
    if not access_token:
        raise HTTPException(status_code=401, detail="El proveedor no devolvió un access token.")
    return access_token


async def _fetch_profile(url: str, access_token: str) -> dict[str, Any]:
    """Obtiene el perfil del usuario desde el endpoint del proveedor."""
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(url, headers={"Authorization": f"Bearer {access_token}"})
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="No se pudo obtener el perfil del proveedor.")
    return response.json()


def _finish_login(db: Session, profile: dict[str, Any], state_data: dict[str, Any]) -> RedirectResponse:
    """Crea/actualiza el usuario, genera la sesión y redirige al frontend."""
    upsert_user(db, profile)
    token = create_session_token(profile)
    return_url = allowed_return_url(state_data.get("return_to"))
    return RedirectResponse(f"{return_url}#token={token}")


@app.get("/api/auth/providers")
def auth_providers() -> dict[str, Any]:
    """Lista de proveedores de login disponibles."""
    return {"providers": enabled_providers()}


@app.get("/api/auth/discord/login")
def discord_login(return_to: str | None = None) -> RedirectResponse:
    """Redirige al usuario a la pantalla de autorización de Discord."""
    client_id = require_config(settings.discord_client_id, "DISCORD_CLIENT_ID")
    redirect_uri = require_config(settings.discord_redirect_uri, "DISCORD_REDIRECT_URI")
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "identify email",
        "state": _oauth_state(return_to),
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
    state_data = _read_state(state)
    client_id = require_config(settings.discord_client_id, "DISCORD_CLIENT_ID")
    client_secret = require_config(settings.discord_client_secret, "DISCORD_CLIENT_SECRET")
    redirect_uri = require_config(settings.discord_redirect_uri, "DISCORD_REDIRECT_URI")

    access_token = await _exchange_code(
        DISCORD_TOKEN_URL,
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        },
    )
    raw = await _fetch_profile(DISCORD_USER_URL, access_token)
    profile = {
        "provider": "discord",
        "id": raw.get("id"),
        "username": raw.get("username"),
        "display_name": raw.get("global_name") or raw.get("username"),
        "email": raw.get("email"),
        "avatar_url": build_avatar_url(raw),
    }
    return _finish_login(db, profile, state_data)


@app.get("/api/auth/google/login")
def google_login(return_to: str | None = None) -> RedirectResponse:
    """Redirige al usuario a la pantalla de autorización de Google."""
    client_id = require_config(settings.google_client_id, "GOOGLE_CLIENT_ID")
    redirect_uri = require_config(settings.google_redirect_uri, "GOOGLE_REDIRECT_URI")
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": _oauth_state(return_to),
        "prompt": "consent",
    }
    return RedirectResponse(f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}")


@app.get("/api/auth/google/callback")
async def google_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Callback OAuth de Google."""
    if error or not code:
        return RedirectResponse(f"{resolve_return_url(state)}?auth=error")
    state_data = _read_state(state)
    client_id = require_config(settings.google_client_id, "GOOGLE_CLIENT_ID")
    client_secret = require_config(settings.google_client_secret, "GOOGLE_CLIENT_SECRET")
    redirect_uri = require_config(settings.google_redirect_uri, "GOOGLE_REDIRECT_URI")

    access_token = await _exchange_code(
        GOOGLE_TOKEN_URL,
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        },
    )
    raw = await _fetch_profile(GOOGLE_USER_URL, access_token)
    profile = {
        "provider": "google",
        "id": raw.get("sub"),
        "username": raw.get("email"),
        "display_name": raw.get("name"),
        "email": raw.get("email"),
        "avatar_url": raw.get("picture"),
    }
    return _finish_login(db, profile, state_data)


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterRequest(BaseModel):
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    name: str | None = Field(default=None, max_length=64)


class LoginRequest(BaseModel):
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=1, max_length=128)


class AuthTokenResponse(BaseModel):
    token: str
    user: dict[str, Any]


def _email_profile(user: User) -> dict[str, Any]:
    """Perfil de sesión para un usuario que entra con correo/contraseña."""
    return {
        "provider": "email",
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "email": user.email,
        "avatar_url": user.avatar_url,
    }


@app.post("/api/auth/register", response_model=AuthTokenResponse)
@limiter.limit(settings.rate_limit)
def email_register(
    request: Request,
    payload: RegisterRequest,
    db: Session = Depends(get_db),
) -> AuthTokenResponse:
    """Registra un usuario con correo y contraseña."""
    email = payload.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Correo electrónico no válido.")

    user = db.query(User).filter(User.email == email).first()
    if user is not None and user.password_hash:
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese correo.")
    if user is None:
        user = User()
        db.add(user)

    user.email = email
    user.username = user.username or email
    user.display_name = payload.name or user.display_name or email.split("@")[0]
    user.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(user)

    profile = _email_profile(user)
    return AuthTokenResponse(token=create_session_token(profile), user=profile)


@app.post("/api/auth/login", response_model=AuthTokenResponse)
@limiter.limit(settings.rate_limit)
def email_login(
    request: Request,
    payload: LoginRequest,
    db: Session = Depends(get_db),
) -> AuthTokenResponse:
    """Inicia sesión con correo y contraseña."""
    email = payload.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if user is None or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos.")

    profile = _email_profile(user)
    return AuthTokenResponse(token=create_session_token(profile), user=profile)


@app.get("/api/auth/me", response_model=UserResponse)
def auth_me(user: dict[str, Any] = Depends(get_current_user)) -> UserResponse:
    """Devuelve el perfil del usuario autenticado."""
    profile = dict(user)
    profile["is_admin"] = is_admin(user)
    return UserResponse(user=profile)


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
    user_settings = get_settings_row(db, user)
    check_quota(db, user, "message")

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
    conversation.updated_at = datetime.now(timezone.utc)
    db.commit()

    use_rag = user_settings.use_rag if payload.use_rag is None else payload.use_rag
    context = retrieve_context(db, user, message) if use_rag else ""
    prompt = message
    if context:
        prompt = (
            "Usa el siguiente contexto del usuario para responder si es relevante. "
            "Si no lo es, responde con tu propio conocimiento.\n\n"
            f"Contexto:\n{context}\n\nPregunta: {message}"
        )

    reply = generate_reply(prompt, preferred_model=user_settings.preferred_model)

    db.add(Message(conversation_id=conversation.id, role="assistant", content=reply))
    conversation.updated_at = datetime.now(timezone.utc)
    db.commit()

    usage = get_usage_row(db, user)
    bump_usage(db, usage, "message")

    sources = context.count("\n\n") + 1 if context else 0
    return ChatResponse(reply=reply, conversation_id=conversation.id, sources=sources)


# --------------------------------------------------------------------------- #
# Generación de imágenes
# --------------------------------------------------------------------------- #

@app.post("/api/image", response_model=ImageResponse)
@limiter.limit(settings.rate_limit)
def generate_image(
    request: Request,
    payload: ImageRequest,
    profile: dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ImageResponse:
    """Genera una imagen a partir de un prompt (requiere IMAGE_MODEL configurado)."""
    if genai_client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="El servidor no tiene configurada AI_API_KEY.",
        )
    model = settings.image_model
    if not model:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="La generación de imágenes no está habilitada en este servidor.",
        )

    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="El prompt no puede estar vacío.")

    user = upsert_user(db, profile)
    check_quota(db, user, "image")

    try:
        response = genai_client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"Error al generar la imagen ({model}): {exc}",
        ) from exc

    try:
        parts = response.parts or []
    except Exception:  # noqa: BLE001 - respuesta sin candidatos
        parts = []

    for part in parts:
        inline = getattr(part, "inline_data", None)
        if inline and inline.data:
            mime_type = inline.mime_type or "image/png"
            data = inline.data
            if isinstance(data, bytes):
                encoded = base64.b64encode(data).decode("ascii")
            else:
                encoded = str(data)
            usage = get_usage_row(db, user)
            bump_usage(db, usage, "image")
            return ImageResponse(image=f"data:{mime_type};base64,{encoded}", mime_type=mime_type)

    raise HTTPException(status_code=502, detail="El modelo no devolvió ninguna imagen.")


# --------------------------------------------------------------------------- #
# RAG: base de conocimiento del usuario
# --------------------------------------------------------------------------- #

@app.post("/api/rag/documents", response_model=DocumentResponse)
@limiter.limit(settings.rate_limit)
def create_document(
    request: Request,
    payload: DocumentRequest,
    profile: dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentResponse:
    """Divide, vectoriza y almacena un documento de conocimiento."""
    if not settings.rag_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="El módulo de conocimiento no está habilitado.",
        )
    if genai_client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="El servidor no tiene configurada AI_API_KEY.",
        )

    chunks = rag.split_text(payload.text)
    if not chunks:
        raise HTTPException(status_code=400, detail="El documento está vacío.")

    user = upsert_user(db, profile)
    doc_limit = plans.limits_for(user.plan).get("documents")
    if doc_limit is not None and count_documents(db, user) >= doc_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Tu plan {user.plan} permite {doc_limit} documentos. "
                "Elimina alguno o mejora tu plan."
            ),
        )

    try:
        vectors = rag.embed_texts(chunks)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Error al vectorizar: {exc}") from exc

    document = Document(user_id=user.id, title=(payload.title or "Documento")[:160])
    db.add(document)
    db.commit()
    db.refresh(document)

    for content, vector in zip(chunks, vectors):
        db.add(
            DocumentChunk(
                document_id=document.id,
                content=content,
                embedding=rag.encode_embedding(vector),
            )
        )
    db.commit()

    return DocumentResponse(id=document.id, title=document.title, chunks=len(chunks))


@app.get("/api/rag/documents")
def list_documents(
    profile: dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Lista los documentos de conocimiento del usuario."""
    user = upsert_user(db, profile)
    documents = (
        db.query(Document)
        .filter(Document.user_id == user.id)
        .order_by(Document.id.desc())
        .all()
    )
    return {
        "documents": [
            {"id": doc.id, "title": doc.title, "chunks": len(doc.chunks)} for doc in documents
        ]
    }


@app.delete("/api/rag/documents/{document_id}")
def delete_document(
    document_id: int,
    profile: dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """Elimina un documento y todos sus fragmentos."""
    user = upsert_user(db, profile)
    document = (
        db.query(Document)
        .filter(Document.id == document_id, Document.user_id == user.id)
        .first()
    )
    if document is None:
        raise HTTPException(status_code=404, detail="Documento no encontrado.")
    db.delete(document)
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Conversaciones (historial en servidor)
# --------------------------------------------------------------------------- #

def _serialize_conversation(conversation: Conversation, detailed: bool = False) -> dict[str, Any]:
    """Convierte una conversación en un diccionario JSON-serializable."""
    data: dict[str, Any] = {
        "id": conversation.id,
        "title": conversation.title,
        "updated_at": conversation.updated_at.isoformat() if conversation.updated_at else None,
        "messages": len(conversation.messages),
    }
    if detailed:
        data["items"] = [
            {
                "id": message.id,
                "role": message.role,
                "content": message.content,
                "created_at": message.created_at.isoformat() if message.created_at else None,
            }
            for message in conversation.messages
        ]
    return data


@app.get("/api/conversations")
def list_conversations(
    profile: dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Lista las conversaciones del usuario (más recientes primero)."""
    user = upsert_user(db, profile)
    conversations = (
        db.query(Conversation)
        .filter(Conversation.user_id == user.id)
        .order_by(Conversation.updated_at.desc())
        .all()
    )
    return {"conversations": [_serialize_conversation(c) for c in conversations]}


@app.get("/api/conversations/{conversation_id}")
def get_conversation(
    conversation_id: int,
    profile: dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Devuelve una conversación con todos sus mensajes."""
    user = upsert_user(db, profile)
    conversation = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.user_id == user.id)
        .first()
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversación no encontrada.")
    return {"conversation": _serialize_conversation(conversation, detailed=True)}


@app.patch("/api/conversations/{conversation_id}")
def rename_conversation(
    conversation_id: int,
    payload: ConversationRenameRequest,
    profile: dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Renombra una conversación del usuario."""
    user = upsert_user(db, profile)
    conversation = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.user_id == user.id)
        .first()
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversación no encontrada.")
    conversation.title = payload.title.strip()
    conversation.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(conversation)
    return {"conversation": _serialize_conversation(conversation)}


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: int,
    profile: dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """Elimina una conversación y sus mensajes."""
    user = upsert_user(db, profile)
    conversation = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.user_id == user.id)
        .first()
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversación no encontrada.")
    db.delete(conversation)
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Ajustes, planes y cuotas
# --------------------------------------------------------------------------- #

def _serialize_settings(row: UserSettings) -> dict[str, Any]:
    return {
        "theme": row.theme,
        "preferred_model": row.preferred_model,
        "use_rag": row.use_rag,
    }


@app.get("/api/settings")
def get_settings(
    profile: dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Devuelve las preferencias del usuario."""
    user = upsert_user(db, profile)
    return {"settings": _serialize_settings(get_settings_row(db, user))}


@app.patch("/api/settings")
def update_settings(
    payload: SettingsRequest,
    profile: dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Actualiza las preferencias del usuario."""
    user = upsert_user(db, profile)
    row = get_settings_row(db, user)
    if payload.theme is not None:
        row.theme = payload.theme
    if payload.preferred_model is not None:
        row.preferred_model = payload.preferred_model.strip() or None
    if payload.use_rag is not None:
        row.use_rag = payload.use_rag
    db.commit()
    db.refresh(row)
    return {"settings": _serialize_settings(row)}


@app.get("/api/plans")
def get_plans() -> dict[str, Any]:
    """Catálogo de planes disponibles."""
    return {"plans": plans.PLANS}


@app.get("/api/usage")
def get_usage(
    profile: dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Resumen de plan y consumo del usuario."""
    user = upsert_user(db, profile)
    limits = plans.limits_for(user.plan)
    row = get_usage_row(db, user)
    return {
        "plan": user.plan,
        "limits": limits,
        "usage": {
            "messages": row.messages,
            "images": row.images,
            "documents": count_documents(db, user),
        },
        "day": today_str(),
    }


@app.delete("/api/account")
def delete_account(
    profile: dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """Elimina la cuenta del usuario y todos sus datos."""
    user = upsert_user(db, profile)
    delete_user_data(db, user)
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Administración (reservado al fundador)
# --------------------------------------------------------------------------- #


class AdminUserUpdate(BaseModel):
    """Cambios que el administrador puede aplicar a un usuario."""

    plan: str | None = Field(default=None, pattern="^(free|pro|enterprise)$")


def _serialize_admin_user(db: Session, user: User) -> dict[str, Any]:
    """Representación de un usuario para el panel de administración."""
    return {
        "id": user.id,
        "discord_id": user.discord_id,
        "username": user.username,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "plan": user.plan,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "is_founder": user.discord_id in settings.founder_ids,
        "conversations": db.query(func.count(Conversation.id))
        .filter(Conversation.user_id == user.id)
        .scalar()
        or 0,
        "documents": db.query(func.count(Document.id))
        .filter(Document.user_id == user.id)
        .scalar()
        or 0,
    }


@app.get("/api/admin/stats")
def admin_stats(
    _: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Métricas globales de la plataforma."""
    day = today_str()
    today_rows = db.query(Usage).filter(Usage.day == day).all()
    plan_rows = db.query(User.plan, func.count(User.id)).group_by(User.plan).all()
    return {
        "users": db.query(func.count(User.id)).scalar() or 0,
        "conversations": db.query(func.count(Conversation.id)).scalar() or 0,
        "messages": db.query(func.count(Message.id)).scalar() or 0,
        "documents": db.query(func.count(Document.id)).scalar() or 0,
        "messages_today": sum(row.messages for row in today_rows),
        "images_today": sum(row.images for row in today_rows),
        "active_today": sum(1 for row in today_rows if row.messages or row.images),
        "plan_breakdown": {plan or "free": count for plan, count in plan_rows},
        "founders": settings.founder_ids,
        "day": day,
    }


@app.get("/api/admin/users")
def admin_users(
    _: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Lista de todos los usuarios registrados."""
    users = db.query(User).order_by(User.created_at.desc()).all()
    return {"users": [_serialize_admin_user(db, user) for user in users]}


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(
    user_id: int,
    payload: AdminUserUpdate,
    _: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Cambia el plan de un usuario."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    if payload.plan is not None:
        user.plan = payload.plan
    db.commit()
    db.refresh(user)
    return {"user": _serialize_admin_user(db, user)}


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(
    user_id: int,
    _: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """Elimina un usuario y todos sus datos (los fundadores están protegidos)."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    if user.discord_id in settings.founder_ids:
        raise HTTPException(status_code=400, detail="No puedes eliminar a un fundador.")
    delete_user_data(db, user)
    return {"ok": True}
