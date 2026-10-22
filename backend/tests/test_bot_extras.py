"""Pruebas de los extras del bot: programados, stats, respaldo, menús de roles
y encuestas."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import bot_extras
import discord_bot
import main
from main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


# Sesión válida: el ID debe estar en FOUNDER_DISCORD_IDS del entorno de test.
FOUNDER_ID = "1439761085040427100"


def auth(user_id: str = FOUNDER_ID) -> dict[str, str]:
    token = main.create_session_token(
        {
            "provider": "discord",
            "id": user_id,
            "username": "admin-tester",
            "display_name": "Admin Tester",
            "email": None,
            "avatar_url": None,
        }
    )
    return {"Authorization": f"Bearer {token}"}


# ---- Programados ----------------------------------------------------------- #
def test_schedule_crud(client, monkeypatch):
    headers = auth()
    created = client.post(
        "/api/admin/discord-bot/schedules",
        json={
            "guild_id": "1551284673165000885",
            "channel_id": "123123123",
            "content": "Buenas noches de Core IA",
            "kind": "daily",
            "hour_utc": 22,
        },
        headers=headers,
    )
    assert created.status_code == 200
    schedule = created.json()["schedule"]
    assert schedule["kind"] == "daily" and schedule["active"] is True

    listed = client.get("/api/admin/discord-bot/schedules", headers=headers).json()
    assert any(item["id"] == schedule["id"] for item in listed["schedules"])

    toggled = client.patch(
        f"/api/admin/discord-bot/schedules/{schedule['id']}",
        json={"active": False},
        headers=headers,
    ).json()
    assert toggled["schedule"]["active"] is False

    deleted = client.delete(
        f"/api/admin/discord-bot/schedules/{schedule['id']}", headers=headers
    )
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True

    again = client.get("/api/admin/discord-bot/schedules", headers=headers).json()
    assert not any(item["id"] == schedule["id"] for item in again["schedules"])


def test_schedule_requires_auth(client):
    assert client.get("/api/admin/discord-bot/schedules").status_code == 401


def test_collect_due_schedules(tmp_path):
    from datetime import datetime, timezone

    import models as db_models
    from database import SessionLocal

    now = datetime(2026, 10, 21, 15, 30, tzinfo=timezone.utc)  # miércoles
    db = SessionLocal()
    try:
        row = db_models.BotSchedule(
            guild_id="1",
            channel_id="2",
            content="hola",
            kind="weekly",
            weekday=2,
            hour_utc=15,
            minute_utc=0,
            active=True,
        )
        db.add(row)
        db.commit()
        schedule_id = row.id
        due = bot_extras.collect_due_schedules(now)
        assert any(item["id"] == schedule_id for item in due)
        # Ya marcado hoy: no se vuelve a publicar.
        due_again = bot_extras.collect_due_schedules(now)
        assert not any(item["id"] == schedule_id for item in due_again)
        db.get(db_models.BotSchedule, schedule_id)
        found = db.get(db_models.BotSchedule, schedule_id)
        if found is not None:
            db.delete(found)
            db.commit()
    finally:
        db.close()


# ---- Stats / eventos / respaldo -------------------------------------------- #
def test_stats_shape(client, monkeypatch):
    headers = auth()
    data = client.get("/api/admin/discord-bot/stats", headers=headers).json()
    for key in (
        "day",
        "messages_today",
        "images_today",
        "users_total",
        "schedules_active",
        "welcomes",
        "verifications",
        "antiraid_triggers",
        "antispam_warn",
        "voice_temp_created",
        "ticket_transcripts",
    ):
        assert key in data


def test_modlog_returns_only_protection_events(client):
    """El endpoint /modlog filtra los eventos de moderación y protección."""
    bot_extras.record_event("antiraid_trigger", "oleada detectada", "111")
    bot_extras.record_event("antispam_timeout", "usuario · flood", "111")
    bot_extras.record_event("test_event", "no es de moderación", "111")

    headers = auth()
    data = client.get("/api/admin/discord-bot/modlog", headers=headers).json()
    kinds = {event["kind"] for event in data["events"]}
    assert "antiraid_trigger" in kinds
    assert "antispam_timeout" in kinds
    assert "test_event" not in kinds

    filtered = client.get(
        "/api/admin/discord-bot/modlog?guild_id=111", headers=headers
    ).json()
    assert all(event["guild"] == "111" for event in filtered["events"])


def test_events_endpoint(client, monkeypatch):
    headers = auth()
    bot_extras.record_event("test_event", "detalle de prueba", "123")
    data = client.get("/api/admin/discord-bot/events", headers=headers).json()
    assert any(event["kind"] == "test_event" for event in data["events"])


def test_backup_download_and_restore(client, monkeypatch):
    headers = auth()
    backup = client.get("/api/admin/discord-bot/backup", headers=headers)
    assert backup.status_code == 200
    body = backup.json()
    assert "guilds" in body and "schedules" in body

    restore = client.post(
        "/api/admin/discord-bot/backup",
        json={"settings": {"system_prompt": "prueba"}, "guilds": {}, "schedules": []},
        headers=headers,
    )
    assert restore.status_code == 200
    assert restore.json()["ok"] is True


# ---- Menús de roles y encuestas -------------------------------------------- #
def test_rolemenu_create_list_delete(client, monkeypatch):
    headers = auth()

    async def fake_post_role_menu(guild_id, channel_id, title, roles):
        return {
            "menu_id": "abcd1234",
            "channel_id": str(channel_id),
            "title": title,
            "roles": roles,
            "message_id": "555",
            "created_at": "2026-10-21T00:00:00+00:00",
        }

    async def fake_inventory(guild_id, token: str = ""):
        return {
            "roles": [
                {"id": "222", "name": "Miembro", "color": 0},
            ]
        }

    async def fake_remove_poll_or_menu(guild_id, menu_id):
        return True

    monkeypatch.setattr(bot_extras, "post_role_menu", fake_post_role_menu)
    monkeypatch.setattr(discord_bot, "fetch_guild_inventory", fake_inventory)
    monkeypatch.setattr(bot_extras, "remove_role_menu", fake_remove_poll_or_menu)

    created = client.post(
        "/api/admin/discord-bot/guilds/111/role-menu",
        json={
            "channel_id": "444",
            "title": "Elije tu rol",
            "role_ids": ["222"],
        },
        headers=headers,
    )
    assert created.status_code == 200
    assert created.json()["menu"]["menu_id"] == "abcd1234"

    deleted = client.delete(
        "/api/admin/discord-bot/guilds/111/role-menu/abcd1234", headers=headers
    )
    assert deleted.status_code == 200 and deleted.json()["ok"] is True


def test_poll_create_rejects_one_option(client, monkeypatch):
    headers = auth()
    response = client.post(
        "/api/admin/discord-bot/guilds/111/polls",
        json={
            "channel_id": "444",
            "question": "¿Sí o no?",
            "options": [{"label": "Sí"}],
        },
        headers=headers,
    )
    assert response.status_code == 422


def test_poll_message_content_bars():
    entry = {
        "question": "¿Sí o no?",
        "options": [
            {"label": "Sí", "emoji": "", "votes": 3, "voters": []},
            {"label": "No", "emoji": "", "votes": 1, "voters": []},
        ],
    }
    text = bot_extras.poll_message_content(entry)
    assert "¿Sí o no?" in text and "75%" in text


def test_welcome_image_render():
    png = bot_extras.render_welcome_image("Core IA", "Sebas", 42, None)
    if png is None:  # Pillow no disponible en el entorno
        pytest.skip("Pillow no instalado")
    assert png.startswith(b"\x89PNG")


# ---- Tanda 2: niveles, sorteos, recordatorios, feeds ----------------------- #
def test_level_xp_and_top(client, monkeypatch):
    import asyncio

    # Primera subida otorga XP; segundos mensajes en menos de 60s no.
    first = asyncio.run(bot_extras.add_level_xp(999, "77", "Tester"))
    assert first is not None  # (nivel_previo, nivel_nuevo, xp)
    second = asyncio.run(bot_extras.add_level_xp(999, "77", "Tester"))
    assert second is None  # dentro del enfriamiento

    bot_extras._level_cooldown.clear()
    asyncio.run(bot_extras.add_level_xp(999, "77", "Tester"))

    top = bot_extras.level_top(999)
    assert top[0]["user_id"] == "77"
    assert top[0]["level"] == bot_extras.level_of(top[0]["xp"])

    me = bot_extras.level_user(999, "77")
    assert me["xp"] > 0 and me["rank"] == 1
    assert bot_extras.level_user(999, "88")["rank"] == 0


def test_levels_endpoint(client, monkeypatch):
    import asyncio

    headers = auth()
    bot_extras._level_cooldown.clear()
    asyncio.run(bot_extras.add_level_xp(999, "77", "Tester"))
    data = client.get("/api/admin/discord-bot/guilds/999/levels", headers=headers).json()
    assert any(entry["user_id"] == "77" for entry in data["top"])


def test_member_stats(client, monkeypatch):
    headers = auth()
    bot_extras.bump_stat("welcomes", guild_id="999")
    data = client.get("/api/admin/discord-bot/member-stats", headers=headers).json()
    assert len(data["days"]) == 7
    assert all("welcomes" in day and "goodbyes" in day for day in data["days"])


def test_parse_duration_and_human():
    assert discord_bot._parse_duration("15m") == 15
    assert discord_bot._parse_duration("2h") == 120
    assert discord_bot._parse_duration("1d") == 1440
    assert discord_bot._parse_duration("90") == 90
    assert discord_bot._parse_duration("basura") is None
    assert discord_bot._human_delta(120) == "2.0 hora(s)"


def test_reminder_due_and_panel(client, monkeypatch, tmp_path):
    from datetime import timedelta

    from models import BotReminder
    from database import SessionLocal

    headers = auth()
    db = SessionLocal()
    try:
        row = BotReminder(
            guild_id="999",
            channel_id="42",
            user_id="77",
            content="Pasar por la tienda",
            due_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        db.add(row)
        db.commit()
        reminder_id = row.id
    finally:
        db.close()

    listed = client.get(
        "/api/admin/discord-bot/reminders", headers=headers
    ).json()
    assert any(item["id"] == reminder_id for item in listed["reminders"])

    due = bot_extras.collect_due_reminders(datetime.now(timezone.utc))
    assert any(item["id"] == reminder_id for item in due)

    deleted = client.delete(
        f"/api/admin/discord-bot/reminders/{reminder_id}", headers=headers
    )
    assert deleted.status_code == 200


def test_giveawy_flow(client, monkeypatch):
    created_messages: list[dict] = []

    async def fake_api_request(method, path, *, json_body=None, token=""):
        if method == "POST" and "/messages" in path:
            response = {"id": "999"}
            created_messages.append(response)
            return response
        if method == "PATCH":
            return {}
        if method == "DELETE":
            return {}
        raise AssertionError("Llamada inesperada " + method + path)

    monkeypatch.setattr(bot_extras, "api_request", fake_api_request)
    headers = auth()

    response = client.post(
        "/api/admin/discord-bot/guilds/999/giveaways",
        json={
            "channel_id": "42",
            "prize": "Nitro x1",
            "minutes": 1,
            "winners": 1,
        },
        headers=headers,
    )
    assert response.status_code == 200
    giveaway = response.json()["giveaway"]
    assert giveaway["message_id"] == "999"
    text = bot_extras.giveaway_content(giveaway)
    assert "Sorteo" in text and "Participantes" in text

    # Apuntar un participante y cerrarlo a mano.
    store = bot_extras.load_store(999, bot_extras.GIVEAWAY_STORE)
    assert store, "el sorteo debe haber quedado guardado"
    giveaway_id, entry = next(iter(store.items()))
    entry["entrants"] = ["77", "88"]
    entry["ends_at"] = (
        datetime.now(timezone.utc) - timedelta(seconds=2)
    ).isoformat(timespec="seconds")
    store[giveaway_id] = entry
    bot_extras.save_store(999, bot_extras.GIVEAWAY_STORE, store)

    bot_extras._level_cooldown.clear()
    due_map = bot_extras.collect_due_giveaways(datetime.now(timezone.utc))
    assert "999" in due_map
    closed = due_map["999"][0]
    assert closed["closed"] is True
    assert len(closed["winners_ids"]) == 1 and closed["winners_ids"][0] in ("77", "88")
    final_text = bot_extras.giveaway_content(closed, finished=True)
    assert "<@" in final_text

    cleanup = client.delete(
        f"/api/admin/discord-bot/guilds/999/giveaways/{giveaway_id}", headers=headers
    )
    assert cleanup.status_code == 200


def test_feed_poll_twitch(monkeypatch):
    import asyncio as _asyncio

    feed = {
        "kind": "twitch",
        "target": "midudev",
        "name": "midudev",
        "channel_id": "42",
        "last_at": "",
        "live": False,
    }

    async def fake_fetch(url):
        return "2 hours 3 minutes"  # canal en vivo

    monkeypatch.setattr(bot_extras, "_fetch_text", fake_fetch)
    announce = _asyncio.run(bot_extras.poll_feed(feed))
    assert announce is not None and "DIRECTO" in announce["content"]
    assert feed["live"] is True

    # Segunda vuelta con el canal ya marcado en vivo: sin aviso.
    announce_again = _asyncio.run(bot_extras.poll_feed(feed))
    assert announce_again is None

    async def fake_fetch_offline(url):
        return ""

    monkeypatch.setattr(bot_extras, "_fetch_text", fake_fetch_offline)
    result = _asyncio.run(bot_extras.poll_feed(feed))
    assert result is None and feed["live"] is False
