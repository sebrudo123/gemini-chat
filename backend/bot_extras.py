"""Extras del bot de Discord: imagen de bienvenida, registros, menús de
roles y encuestas por botones.

Todo se guarda en la tabla app_settings por servidor (claves
``discord:<guild>:<store>``) usando la API REST de Discord con el token
del bot: los mensajes con componentes funcionan aunque el cliente no
esté encendido; las interacciones las atiende discord_bot.py.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Any

from config import settings
from database import SessionLocal
from models import AppSetting
from sqlalchemy.exc import SQLAlchemyError

DISCORD_API = "https://discord.com/api/v10"

ROLEMENU_STORE = "role_menus"
POLL_STORE = "polls"
ROLEMENU_COMPONENT_PREFIX = "coreia_rolemenu"
POLL_COMPONENT_PREFIX = "coreia_poll"

MAX_COMPONENT_STORES = 20
MAX_VOTERS_PER_OPTION = 500


def _key(guild_id: int | str, name: str) -> str:
    return f"discord:{int(guild_id)}:{name}"


async def api_request(
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
    token: str = "",
) -> Any:
    """Llamada REST directa a Discord con el token del bot."""
    import aiohttp  # lo trae discord.py

    token = token or settings.discord_bot_token.strip()
    headers: dict[str, str] = {"Authorization": f"Bot {token}"}
    if json_body is not None:
        headers["Content-Type"] = "application/json"
    timeout = aiohttp.ClientTimeout(total=20)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.request(
            method, f"{DISCORD_API}{path}", headers=headers, json=json_body
        ) as response:
            raw = await response.text()
            if response.status >= 400:
                raise RuntimeError(
                    f"Discord respondió {response.status}: {raw[:200] or 'sin detalle'}"
                )
            try:
                return json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                return raw


# --------------------------------------------------------------------------- #
# Almacenes de componentes (menús de roles y encuestas)
# --------------------------------------------------------------------------- #
def load_store(guild_id: int | str, name: str) -> dict[str, Any]:
    """Lee un almacén JSON del servidor (dict vacío si no existe)."""
    db = SessionLocal()
    try:
        row = db.get(AppSetting, _key(guild_id, name))
        if not row or not row.value:
            return {}
        data = json.loads(row.value)
        return data if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        return {}
    finally:
        db.close()


def save_store(guild_id: int | str, name: str, data: dict[str, Any]) -> None:
    """Guarda un almacén JSON del servidor con límite de componentes."""
    trimmed = list(data.items())[-MAX_COMPONENT_STORES:]
    db = SessionLocal()
    try:
        row = db.get(AppSetting, _key(guild_id, name))
        value = json.dumps(dict(trimmed), ensure_ascii=False)
        if row is None:
            db.add(AppSetting(key=_key(guild_id, name), value=value))
        else:
            row.value = value
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# Registros (eventos recientes del bot) y estadísticas
# --------------------------------------------------------------------------- #
EVENTS_KEY = "bot:events"
MAX_EVENTS = 150


def load_events() -> list[dict[str, Any]]:
    """Devuelve los últimos eventos del bot (más nuevos primero)."""
    db = SessionLocal()
    try:
        row = db.get(AppSetting, EVENTS_KEY)
        if not row or not row.value:
            return []
        events = json.loads(row.value)
        return events if isinstance(events, list) else []
    except (ValueError, TypeError):
        return []
    finally:
        db.close()


def record_event(kind: str, detail: str = "", guild_id: str = "") -> None:
    """Registra un evento del bot en la lista circular de app_settings."""
    events = load_events()
    events.insert(
        0,
        {
            "t": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "kind": kind,
            "detail": (detail or "")[:300],
            "guild": str(guild_id or ""),
        },
    )
    events = events[:MAX_EVENTS]
    db = SessionLocal()
    try:
        row = db.get(AppSetting, EVENTS_KEY)
        value = json.dumps(events, ensure_ascii=False)
        if row is None:
            db.add(AppSetting(key=EVENTS_KEY, value=value))
        else:
            row.value = value
        db.commit()
    except SQLAlchemyError:
        db.rollback()
    finally:
        db.close()


def stats_key(day: str) -> str:
    return f"bot:stats:{day}"


def bump_stat(counter: str, amount: int = 1, day: str | None = None) -> None:
    """Suma un contador diario de actividad del bot."""
    day = day or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    db = SessionLocal()
    try:
        key = stats_key(day)
        row = db.get(AppSetting, key)
        data: dict[str, Any] = {}
        if row and row.value:
            try:
                data = json.loads(row.value)
            except (ValueError, TypeError):
                data = {}
        if not isinstance(data, dict):
            data = {}
        try:
            data[counter] = int(data.get(counter, 0)) + amount
        except (TypeError, ValueError):
            data[counter] = amount
        value = json.dumps(data, ensure_ascii=False)
        if row is None:
            db.add(AppSetting(key=key, value=value))
        else:
            row.value = value
        db.commit()
    except SQLAlchemyError:
        db.rollback()
    finally:
        db.close()


def load_stats(day: str) -> dict[str, Any]:
    db = SessionLocal()
    try:
        row = db.get(AppSetting, stats_key(day))
        if not row or not row.value:
            return {}
        data = json.loads(row.value)
        return data if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        return {}
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# Imagen de bienvenida (Pillow, sin recursos externos)
# --------------------------------------------------------------------------- #
def _welcome_fonts() -> tuple[Any, Any]:  # pragma: no cover - depende del host
    from PIL import ImageFont

    bold_candidates = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    )
    regular_candidates = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    )
    import os

    bold = next((p for p in bold_candidates if os.path.isfile(p)), None)
    regular = next((p for p in regular_candidates if os.path.isfile(p)), None)
    if bold and regular:
        return (
            ImageFont.truetype(bold, 72),
            ImageFont.truetype(bold, 44),
            ImageFont.truetype(regular, 34),
        )
    return (ImageFont.load_default(size=72), None, None)


def render_welcome_image(
    server: str,
    member_name: str,
    member_count: int | str,
    avatar_bytes: bytes | None = None,
) -> bytes | None:
    """Genera una imagen de bienvenida con degradado morado.

    Devuelve los bytes PNG o None si Pillow no está disponible.
    """
    try:
        from io import BytesIO

        from PIL import Image, ImageDraw
    except Exception:  # noqa: BLE001 - Pillow opcional
        return None

    width, height = 1024, 480
    img = Image.new("RGB", (width, height), "#15152A")
    top = (109, 93, 252)
    bottom = (143, 123, 255)
    for y in range(height):
        t = y / height
        img.paste(
            tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
            (0, y, width, y + 1),
        )
    draw = ImageDraw.Draw(img)

    # Círculos decorativos
    draw.ellipse((860, -120, 1180, 200), fill=(255, 255, 255, 20))
    draw.ellipse((-90, 320, 190, 600), outline=(255, 255, 255), width=3)

    big_font, mid_font, small_font = _welcome_fonts()

    header = "¡Bienvenido!"
    draw.text((64, 70), header, fill="#FFFFFF", font=big_font)
    label = f"A {server[:28].upper() or 'CORE IA'}"
    draw.text((66, 168), label, fill="#E7E2FF", font=(mid_font or small_font))

    card_top = 236
    draw.rounded_rectangle((56, card_top, width - 56, height - 56), radius=28, fill="#1C1338")
    avatar_cx, avatar_cy, avatar_r = 148, card_top + 108, 64
    if avatar_bytes:
        avatar = _circle_avatar(avatar_bytes, avatar_r * 2)
        if avatar is not None:
            img.paste(
                avatar, (avatar_cx - avatar_r, avatar_cy - avatar_r), avatar
            )
    else:
        draw.ellipse(
            (avatar_cx - avatar_r, avatar_cy - avatar_r, avatar_cx + avatar_r, avatar_cy + avatar_r),
            fill="#3A2C6B",
        )
        draw.text(
            (avatar_cx - 18, avatar_cy - 24),
            "\u276F",
            fill="#B9A9F5",
            font=(small_font or big_font),
        )

    name_x = 240
    draw.text(
        (name_x, card_top + 46),
        member_name[:20] or "Nuevo miembro",
        fill="#FFFFFF",
        font=(mid_font or big_font),
    )
    count_text = f"Miembro n.º {member_count} de {server[:24]}"
    draw.text((name_x, card_top + 128), count_text, fill="#B9B0E8", font=(small_font or big_font))

    buffer = BytesIO()
    img.save(buffer, "PNG")
    return buffer.getvalue()


def _circle_avatar(raw: bytes, size: int) -> Any | None:
    """Recorta el avatar en círculo con borde crudo; None si falla."""
    try:
        from io import BytesIO

        from PIL import Image, ImageDraw, ImageOps

        avatar = Image.open(BytesIO(raw)).convert("RGBA")
        avatar = ImageOps.fit(avatar, (size, size))
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
        avatar.putalpha(mask)
        ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(ring).ellipse(
            (1, 1, size - 2, size - 2), outline=(255, 255, 255, 235), width=5
        )
        avatar.alpha_composite(ring)
        return avatar
    except Exception:  # noqa: BLE001 - la imagen es opcional
        return None


# --------------------------------------------------------------------------- #
# Menús de roles y encuestas (componentes nativos vía API REST)
# --------------------------------------------------------------------------- #
def _rolemenu_components(menu_id: str, roles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Componentes del select multi de roles."""
    options = []
    for role in roles[:25]:
        opt = {"label": role["label"][:100], "value": str(role["id"])}
        if role.get("description"):
            opt["description"] = role["description"][:100]
        options.append(opt)
    return [
        {
            "type": 1,
            "components": [
                {
                    "type": 3,
                    "custom_id": f"{ROLEMENU_COMPONENT_PREFIX}:{menu_id}",
                    "placeholder": "Elige tus roles…",
                    "min_values": 0,
                    "max_values": len(options) or 1,
                    "options": options,
                }
            ],
        }
    ]


def _poll_components(poll_id: str, options: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Botones de las opciones de una encuesta (con emoji opcional)."""
    rows = []
    buttons = []
    for index, option in enumerate(options[:25]):
        button: dict[str, Any] = {
            "type": 2,
            "style": 2,
            "custom_id": f"{POLL_COMPONENT_PREFIX}:{poll_id}:{index}",
            "label": option.get("label", f"Opción {index + 1}")[:80],
        }
        emoji = (option.get("emoji") or "").strip()
        if emoji:
            button["emoji"] = {"name": emoji}
        buttons.append(button)
    for chunk_start in range(0, len(buttons), 5):
        rows.append({"type": 1, "components": buttons[chunk_start : chunk_start + 5]})
    return rows


async def post_role_menu(
    guild_id: int | str,
    channel_id: int,
    title: str,
    roles: list[dict[str, Any]],
) -> dict[str, Any]:
    """Publica un mensaje con select de roles y guarda el menú."""
    menu_id = secrets.token_hex(4)
    payload = {
        "content": f"## {title}\nSelecciona los roles que quieras (toca de nuevo para quitarlos).",
        "allowed_mentions": {"parse": []},
        "components": _rolemenu_components(menu_id, roles),
    }
    message = await api_request("POST", f"/channels/{int(channel_id)}/messages", json_body=payload)
    entry = {
        "menu_id": menu_id,
        "channel_id": str(channel_id),
        "title": title[:150],
        "roles": [{"id": str(role["id"]), "label": role["label"][:100]} for role in roles][:25],
        "message_id": str(message.get("id", "")),
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    store = load_store(guild_id, ROLEMENU_STORE)
    store[menu_id] = entry
    save_store(guild_id, ROLEMENU_STORE, store)
    record_event("rolemenu_create", f"{title} · {len(roles)} roles", str(guild_id))
    return entry


async def remove_role_menu(guild_id: int | str, menu_id: str) -> bool:
    """Borra el mensaje del menú y su registro. False si no existía."""
    store = load_store(guild_id, ROLEMENU_STORE)
    entry = store.pop(menu_id, None)
    if not entry:
        return False
    save_store(guild_id, ROLEMENU_STORE, store)
    if entry.get("message_id"):
        with suppress_msg_delete():
            await api_request(
                "DELETE",
                f"/channels/{int(entry['channel_id'])}/messages/{entry['message_id']}",
            )
    record_event("rolemenu_delete", entry.get("title", ""), str(guild_id))
    return True


async def post_poll(
    guild_id: int | str,
    channel_id: int,
    question: str,
    options: list[dict[str, Any]],
) -> dict[str, Any]:
    """Publica una encuesta con botones y guarda su estado."""
    poll_id = secrets.token_hex(4)
    payload = {
        "content": (
            f"## {question}\n\nToca una opción para votar (toca otra para cambiar tu voto):"
        ),
        "allowed_mentions": {"parse": []},
        "components": _poll_components(poll_id, options),
    }
    message = await api_request("POST", f"/channels/{int(channel_id)}/messages", json_body=payload)
    entry = {
        "poll_id": poll_id,
        "channel_id": str(channel_id),
        "question": question[:150],
        "message_id": str(message.get("id", "")),
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "options": [
            {
                "label": option.get("label", f"Opción {i + 1}")[:80],
                "emoji": (option.get("emoji") or "")[:12],
                "votes": 0,
                "voters": [],
            }
            for i, option in enumerate(options[:25])
        ],
    }
    store = load_store(guild_id, POLL_STORE)
    store[poll_id] = entry
    save_store(guild_id, POLL_STORE, store)
    record_event("poll_create", question[:120], str(guild_id))
    return entry


async def remove_poll(guild_id: int | str, poll_id: str) -> bool:
    """Borra el mensaje y el estado de una encuesta."""
    store = load_store(guild_id, POLL_STORE)
    entry = store.pop(poll_id, None)
    if not entry:
        return False
    save_store(guild_id, POLL_STORE, store)
    if entry.get("message_id"):
        with suppress_msg_delete():
            await api_request(
                "DELETE",
                f"/channels/{int(entry['channel_id'])}/messages/{entry['message_id']}",
            )
    record_event("poll_delete", entry.get("question", ""), str(guild_id))
    return True


def poll_message_content(entry: dict[str, Any]) -> str:
    """Texto actualizado de la encuesta con votos y barras."""
    total = sum(int(option.get("votes", 0)) for option in entry["options"]) or 0
    lines = [f"## {entry['question']}", "", f"Votos: **{total}**", ""]
    bar_width = 18
    for index, option in enumerate(entry["options"], start=1):
        votes = int(option.get("votes", 0))
        percent = int(round(votes * 100 / total)) if total else 0
        filled = int(round(percent * bar_width / 100)) if total else 0
        emoji = f"{option['emoji']} " if option.get("emoji") else ""
        lines.append(
            f"**{index}.** {emoji}{option['label'][:64]} — **{votes}** "
            f"({percent}%)  `{'▰' * filled}{'▱' * (bar_width - filled)}`"
        )
    return "\n".join(lines)


def _suppress_delete() -> Any:  # pragma: no cover - helper tipado
    """Intencionalmente vacío: mantenido por compatibilidad tipada."""
    return None


class _SilentDelete:
    """Contexto que silencia fallos al borrar mensajes en Discord."""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None


def suppress_msg_delete() -> _SilentDelete:
    return _SilentDelete()


# --------------------------------------------------------------------------- #
# Mensajes programados (services tabla bot_schedules)
# --------------------------------------------------------------------------- #
def collect_due_schedules(now: datetime) -> list[dict[str, Any]]:
    """Programaciones activas que toca ejecutar ahora (y marca su día)."""
    from models import BotSchedule

    today = now.strftime("%Y-%m-%d")
    weekday = now.weekday()
    due: list[dict[str, Any]] = []
    db = SessionLocal()
    try:
        rows = (
            db.query(BotSchedule)
            .filter(BotSchedule.active.is_(True))
            .all()
        )
        for schedule in rows:
            if schedule.last_run_day == today:
                continue
            if now.hour < schedule.hour_utc:
                continue
            if now.hour == schedule.hour_utc and now.minute < schedule.minute_utc:
                continue
            if schedule.kind == "weekly" and schedule.weekday != weekday:
                continue
            due.append(
                {
                    "id": schedule.id,
                    "guild_id": schedule.guild_id,
                    "channel_id": schedule.channel_id,
                    "content": schedule.content,
                }
            )
        for item in due:
            row = db.get(BotSchedule, item["id"])
            if row:
                row.last_run_day = today
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        return []
    finally:
        db.close()
    return due
