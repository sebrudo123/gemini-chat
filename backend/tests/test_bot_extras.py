"""Pruebas de los extras del bot: programados, stats, respaldo, menús de roles
y encuestas."""

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
    ):
        assert key in data


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
