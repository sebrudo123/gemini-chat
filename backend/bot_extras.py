"""Extras del bot de Discord: imagen de bienvenida, registros, menús de
roles y encuestas por botones.

Todo se guarda en la tabla app_settings por servidor (claves
``discord:<guild>:<store>``) usando la API REST de Discord con el token
del bot: los mensajes con componentes funcionan aunque el cliente no
esté encendido; las interacciones las atiende discord_bot.py.
"""

from __future__ import annotations

import json
import math
import random
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from config import settings
from database import SessionLocal
from models import AppSetting, BotReminder
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


def bump_stat(
    counter: str,
    amount: int = 1,
    day: str | None = None,
    guild_id: str = "",
) -> None:
    """Suma un contador diario de actividad del bot.

    ``guild_id`` queda reservado para métricas por servidor: los contadores
    diarios son globales, así que aquí no cambia nada de momento.
    """
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


# --------------------------------------------------------------------------- #
# Sistema de niveles (XP por actividad, /nivel y /top)
# --------------------------------------------------------------------------- #
LEVEL_STORE = "levels"
GIVEAWAY_STORE = "giveaways"
FEED_STORE = "feeds"
TICKET_COMPONENT_PREFIX = "coreia_ticket"
GIVEAWAY_COMPONENT_PREFIX = "coreia_giveaway"

XP_PER_MESSAGE = 15
XP_COOLDOWN_SECONDS = 60.0
LEVEL_XP_FACTOR = 40

_level_cooldown: dict[str, float] = {}

LEVEL_LANGUAGES = {
    "es": "Español",
    "en": "Inglés",
    "pt": "Portugués",
    "fr": "Francés",
    "de": "Alemán",
    "it": "Italiano",
    "ja": "Japonés",
    "ko": "Coreano",
    "zh": "Chino",
    "ar": "Árabe",
    "ru": "Ruso",
    "hi": "Hindi",
}


def level_of(xp: int) -> int:
    """Nivel actual según la XP acumulada (progresión suave)."""
    return int(math.sqrt(max(0, int(xp)) / LEVEL_XP_FACTOR))


def xp_for_level(level: int) -> int:
    return int(level * level * LEVEL_XP_FACTOR)


def level_store_key(guild_id: int | str) -> str:
    return _key(guild_id, LEVEL_STORE)


async def add_level_xp(
    guild_id: int | str,
    user_id: int | str,
    display_name: str,
) -> tuple[int, int, int] | None:
    """Suma XP a un usuario respetando el enfriamiento.

    Devuelve (nivel_anterior, nivel_actual, xp_total) si grantearon puntos,
    o None si estaba dentro del enfriamiento.
    """
    cooldown_key = f"{int(guild_id)}:{int(user_id)}"
    now_ts = time.monotonic()
    last = _level_cooldown.get(cooldown_key, 0.0)
    if now_ts - last < XP_COOLDOWN_SECONDS:
        return None
    _level_cooldown[cooldown_key] = now_ts

    db = SessionLocal()
    try:
        key = level_store_key(guild_id)
        row = db.get(AppSetting, key)
        data: dict[str, Any] = {}
        if row and row.value:
            try:
                data = json.loads(row.value)
            except (ValueError, TypeError):
                data = {}
        if not isinstance(data, dict):
            data = {}
        entry = data.get(str(user_id)) or {}
        before = int(entry.get("xp", 0))
        total = before + XP_PER_MESSAGE
        data[str(user_id)] = {"xp": total, "name": (display_name or "")[:40]}
        value = json.dumps(data, ensure_ascii=False)
        if row is None:
            db.add(AppSetting(key=key, value=value))
        else:
            row.value = value
        db.commit()
        before_level, after_level = level_of(before), level_of(total)
        return (before_level, after_level, total)
    except SQLAlchemyError:
        db.rollback()
        return None
    finally:
        db.close()


def level_top(guild_id: int | str, count: int = 10) -> list[dict[str, Any]]:
    """Top de niveles del servidor."""
    db = SessionLocal()
    try:
        row = db.get(AppSetting, level_store_key(guild_id))
        if not row or not row.value:
            return []
        data = json.loads(row.value)
        if not isinstance(data, dict):
            return []
        items = []
        for user_id, entry in data.items():
            xp = int((entry or {}).get("xp", 0))
            items.append(
                {
                    "user_id": user_id,
                    "name": (entry or {}).get("name") or user_id,
                    "xp": xp,
                    "level": level_of(xp),
                }
            )
        items.sort(key=lambda item: item["xp"], reverse=True)
        return items[:count]
    except (ValueError, TypeError):
        return []
    finally:
        db.close()


def level_user(guild_id: int | str, user_id: int | str) -> dict[str, Any]:
    """Nivel y XP de un usuario concreto."""
    db = SessionLocal()
    try:
        row = db.get(AppSetting, level_store_key(guild_id))
        if not row or not row.value:
            return {"xp": 0, "level": 0, "rank": 0}
        data = json.loads(row.value)
        if not isinstance(data, dict):
            return {"xp": 0, "level": 0, "rank": 0}
        all_items = sorted(
            (
                (uid, int((entry or {}).get("xp", 0)))
                for uid, entry in data.items()
            ),
            key=lambda item: item[1],
            reverse=True,
        )
        xp = int((data.get(str(user_id)) or {}).get("xp", 0))
        rank = next((i + 1 for i, (uid, _) in enumerate(all_items) if uid == str(user_id)), 0)
        return {"xp": xp, "level": level_of(xp), "rank": rank}
    except (ValueError, TypeError):
        return {"xp": 0, "level": 0, "rank": 0}
    finally:
        db.close()


def translate_text_sync(text: str, target: str) -> str:
    """Traduce texto con el endpoint gratuito de Google Translate (sin clave)."""
    import urllib.parse
    import urllib.request

    url = (
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl="
        + urllib.parse.quote(target)
        + "&dt=t&q="
        + urllib.parse.quote(text[:1500])
    )
    request = urllib.request.Request(url, headers={"User-Agent": "CoreIA/2.1"})
    import json as _json

    with urllib.request.urlopen(request, timeout=15) as response:
        data = _json.loads(response.read().decode("utf-8"))
    parts: list[str] = []
    for chunk in (data or [[[]]])[0]:
        if chunk and len(chunk) > 0 and chunk[0]:
            parts.append(str(chunk[0]))
    return "".join(parts).strip()


# --------------------------------------------------------------------------- #
# Sorteos (giveaway con botón de participación)
# --------------------------------------------------------------------------- #
def giveaway_content(entry: dict[str, Any], finished: bool = False) -> str:
    """Texto del mensaje del sorteo (progreso o ganadores)."""
    entrants = len(entry.get("entrants") or [])
    winners = max(1, int(entry.get("winners", 1)))
    if finished:
        text = f"## Sorteo terminado: {entry['prize']}\n\n"
        winners_list = [
            f"- <@{uid}>" for uid in (entry.get("winners_ids") or [])[:winners]
        ]
        if winners_list:
            text += "Felicidades a:\n" + "\n".join(winners_list)
        else:
            text += "Hubo pocos participantes y no se eligió ganador."
        return text
    ends = entry.get("ends_at", "")
    return (
        f"## Sorteo: {entry['prize']}\n"
        f"Premio para **{winners}** ganador(es).\n\n"
        f"Participantes: **{entrants}**\n"
        f"Termina: {ends} UTC\n\n"
        "Toca el botón para entrar (toca otra vez para salir):"
    )


async def post_giveaway(
    guild_id: int | str,
    channel_id: int,
    prize: str,
    minutes: int,
    winners: int = 1,
) -> dict[str, Any]:
    """Publica un mensaje de sorteo con botón para participar."""
    giveaway_id = secrets.token_hex(4)
    ends_at = datetime.now(timezone.utc) + timedelta(minutes=max(1, minutes))
    entry = {
        "giveaway_id": giveaway_id,
        "channel_id": str(channel_id),
        "prize": prize[:120],
        "winners": max(1, min(10, winners)),
        "ends_at": ends_at.isoformat(timespec="seconds"),
        "entrants": [],
        "message_id": "",
        "closed": False,
    }
    payload = {
        "content": giveaway_content(entry),
        "allowed_mentions": {"parse": []},
        "components": [
            {
                "type": 1,
                "components": [
                    {
                        "type": 2,
                        "style": 1,
                        "custom_id": f"{GIVEAWAY_COMPONENT_PREFIX}:{giveaway_id}",
                        "label": "Participar",
                    }
                ],
            }
        ],
    }
    message = await api_request(
        "POST", f"/channels/{int(channel_id)}/messages", json_body=payload
    )
    entry["message_id"] = str(message.get("id", ""))
    store = load_store(guild_id, GIVEAWAY_STORE)
    store[giveaway_id] = entry
    save_store(guild_id, GIVEAWAY_STORE, store)
    record_event("giveaway_create", prize[:100], str(guild_id))
    return entry


async def remove_giveaway(guild_id: int | str, giveaway_id: str) -> bool:
    """Borra el mensaje del sorteo y su estado."""
    store = load_store(guild_id, GIVEAWAY_STORE)
    entry = store.pop(giveaway_id, None)
    if not entry:
        return False
    save_store(guild_id, GIVEAWAY_STORE, store)
    if entry.get("message_id"):
        with suppress_msg_delete():
            await api_request(
                "DELETE",
                f"/channels/{int(entry['channel_id'])}/messages/{entry['message_id']}",
            )
    record_event("giveaway_delete", entry.get("prize", ""), str(guild_id))
    return True


def store_giveaway_ids() -> list[int | str]:
    """IDs de servidores con sorteos activos (para el ciclo de cierres)."""
    db = SessionLocal()
    try:
        rows = (
            db.query(AppSetting.key)
            .filter(AppSetting.key.like("%:giveaways"))
            .all()
        )
        return [row[0].split(":")[1] for row in rows]
    finally:
        db.close()


def collect_due_giveaways(now: datetime) -> dict[str, list[dict[str, Any]]]:
    """Sorteos vencidos por servidor, marcados como cerrados."""
    due: dict[str, list[dict[str, Any]]] = {}
    for guild_id in store_giveaway_ids():
        store = load_store(guild_id, GIVEAWAY_STORE)
        for giveaway_id, entry in list(store.items()):
            if entry.get("closed"):
                continue
            try:
                ends = datetime.fromisoformat(entry["ends_at"])
            except (KeyError, ValueError):
                continue
            if ends.tzinfo is None:
                ends = ends.replace(tzinfo=timezone.utc)
            if ends <= now:
                entrants = list(entry.get("entrants") or [])
                winners_n = max(1, int(entry.get("winners", 1)))
                if entrants:
                    winners_ids = random.sample(
                        entrants, k=min(winners_n, len(entrants))
                    )
                else:
                    winners_ids = []
                entry["closed"] = True
                entry["winners_ids"] = winners_ids
                store[giveaway_id] = entry
                save_store(guild_id, GIVEAWAY_STORE, store)
                due.setdefault(str(guild_id), []).append(entry)
    return due


# --------------------------------------------------------------------------- #
# Avisos de YouTube / Twitch (servicios públicos gratuitos)
# --------------------------------------------------------------------------- #
TOMICRO_CHANNELS_PAGE = "https://www.youtube.com"


def resolve_youtube_channel_id(target: str) -> str:
    """Extrae el ID UC... de una URL de canal o resuelve un @handle."""
    import re
    import urllib.request

    target = (target or "").strip()
    if target.startswith("UC"):
        return target
    match = re.search(r"channel/(UC[\w-]+)", target)
    if match:
        return match.group(1)
    # Página del canal para aclarar el channelId (una sola vez al crear).
    url = target if target.startswith("http") else f"https://www.youtube.com/{target}"
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 CoreIA"})
    html = urllib.request.urlopen(request, timeout=15).read().decode("utf-8", "ignore")
    match = re.search(r"(?:channelId|channel_id)&#34;:&#34;(UC[\w-]+)", html)
    if not match:
        match = re.search(r"(UC[\w-]{22,})", html)
    if match:
        return match.group(1)
    raise ValueError("No se pudo deducir el ID del canal de YouTube.")


async def poll_feed(feed: dict[str, Any]) -> dict[str, Any] | None:
    """Consulta un feed único; devuelve el aviso a publicar si hay novedad.

    YouTube usa el RSS público; Twitch usa decapi.me (gratuito, sin clave).
    """
    kind = feed.get("kind")
    last_iso = feed.get("last_at") or ""
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if kind == "youtube":
        channel_id = feed.get("target", "")
        url = (
            "https://www.youtube.com/feeds/videos.xml?channel_id="
            + urllib_parse_quote(channel_id)
        )
        xml = await _fetch_text(url)
        if not xml:
            feed["last_at"] = now_iso
            return None
        latest = _youtube_latest(xml)
        if not latest:
            feed["last_at"] = now_iso
            return None
        video_id, title, link = latest
        if video_id == feed.get("last_id"):
            feed["last_at"] = now_iso
            return None
        feed["last_id"] = video_id
        feed["last_at"] = now_iso
        if not last_iso:  # primera consulta: no anunciar el video viejo
            return None
        return {
            "content": f"**Nuevo video de {feed.get('name') or 'YouTube'}**\n{title}\n<{link}>",
            "channel_id": feed.get("channel_id", ""),
            "event": f"youtube:{video_id}",
        }
    if kind == "twitch":
        name = feed.get("target", "")
        text = await _fetch_text(f"https://decapi.me/twitch/uptime/{urllib_parse_quote(name)}")
        text = (text or "").strip()[:600]
        was_live = feed.get("live") is True
        is_live = bool(text) and "offline" not in text.lower() and len(text) > 4
        feed["last_at"] = now_iso
        feed["live"] = is_live
        if is_live and not was_live:
            return {
                "content": (
                    f"**{feed.get('name') or name} está en DIRECTO en Twitch**\n"
                    f"https://twitch.tv/{name}"
                ),
                "channel_id": feed.get("channel_id", ""),
                "event": f"twitch:{name}",
            }
        return None
    feed["last_at"] = now_iso
    return None


def urllib_parse_quote(value: str) -> str:
    import urllib.parse

    return urllib.parse.quote(value or "")


async def _fetch_text(url: str) -> str:
    import aiohttp

    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as response:
                if response.status >= 400:
                    return ""
                return await response.text()
    except Exception:  # noqa: BLE001 - un feed caído no debe romper el ciclo
        return ""


def _youtube_latest(xml: str) -> tuple[str, str, str] | None:
    import re

    match_id = re.search(r"<yt:videoId>([^<]+)</yt:videoId>", xml)
    match_title = re.search(r"<title>([^<]+)</title>\s*<link", xml)
    if not match_id:
        return None
    video_id = match_id.group(1)
    title = (match_title.group(1) if match_title else "Nuevo video").strip()
    return video_id, title, f"https://www.youtube.com/watch?v={video_id}"


def all_feed_stores() -> list[tuple[str, dict[str, Any]]]:
    """Todos los almacenes de feeds por servidor."""
    db = SessionLocal()
    try:
        rows = db.query(AppSetting).filter(AppSetting.key.like("%:feeds")).all()
        out = []
        for row in rows:
            guild_id = (row.key or "").split(":")[1]
            try:
                data = json.loads(row.value or "{}")
                if isinstance(data, dict):
                    out.append((guild_id, data))
            except (ValueError, TypeError):
                continue
        return out
    finally:
        db.close()


def save_feed(guild_id: int | str, feed_id: str, entry: dict[str, Any]) -> None:
    store = load_store(guild_id, FEED_STORE)
    store[feed_id] = entry
    save_store(guild_id, FEED_STORE, store)


# --------------------------------------------------------------------------- #
# Recordatorios (tabla bot_reminders)
# --------------------------------------------------------------------------- #
def collect_due_reminders(now: datetime) -> list[dict[str, Any]]:
    """Recordatorios que tocan ahora, marcados como enviados."""
    db = SessionLocal()
    try:
        rows = (
            db.query(BotReminder)
            .filter(BotReminder.sent.is_(False), BotReminder.due_at <= now)  # type: ignore[arg-type]
            .order_by(BotReminder.due_at.asc())
            .limit(20)
            .all()
        )
        due = [
            {
                "id": row.id,
                "guild_id": row.guild_id,
                "channel_id": row.channel_id,
                "user_id": row.user_id,
                "content": row.content,
            }
            for row in rows
        ]
        for row in rows:
            row.sent = True
        db.commit()
        return due
    except SQLAlchemyError:
        db.rollback()
        return []
    finally:
        db.close()


def member_stats_last_days(days: int = 7) -> list[dict[str, Any]]:
    """Bienvenidas y despedidas de los últimos N días (para el panel)."""
    base = datetime.now(timezone.utc)
    out = []
    for offset in range(days):
        day = (base - timedelta(days=offset)).strftime("%Y-%m-%d")
        stats = load_stats(day)
        out.append(
            {
                "day": day,
                "welcomes": int(stats.get("welcomes", 0)),
                "goodbyes": int(stats.get("goodbyes", 0)),
            }
        )
    return out
