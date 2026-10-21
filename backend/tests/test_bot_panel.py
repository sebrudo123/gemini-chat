"""Pruebas del panel de administración del bot (REST y formulario)."""

import pytest
from fastapi.testclient import TestClient

import discord_bot
import main
from main import app

FOUNDER_ID = "1439761085040427100"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def auth(user_id: str) -> dict[str, str]:
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


def test_serve_bot_panel(client):
    response = client.get("/bot")
    assert response.status_code == 200
    assert "Core IA Bot" in response.text


def test_serve_bot_js(client):
    response = client.get("/bot/bot.js")
    assert response.status_code == 200
    assert "coreia_bot_token" in response.text


def test_bot_panel_endpoints_require_auth(client):
    assert client.get("/api/admin/discord-bot/guilds").status_code == 401
    assert client.get("/api/admin/discord-bot/guilds/123/inventory").status_code == 401
    assert client.get("/api/admin/discord-bot/guilds/123/config").status_code == 401


def test_bot_panel_forbidden_for_normal_user(client):
    headers = auth("800000000000000010")
    assert client.get("/api/admin/discord-bot/guilds", headers=headers).status_code == 403


def test_bot_guilds_lists_shared_guilds(client, monkeypatch):
    async def fake_fetch(token: str = "") -> list[dict]:
        return [
            {"id": "111", "name": "Core IA", "permissions": "8", "owner": True},
            {"id": "222", "name": "Otro Server", "permissions": "0", "owner": False},
        ]

    monkeypatch.setattr(discord_bot, "fetch_bot_guilds", fake_fetch)
    data = client.get("/api/admin/discord-bot/guilds", headers=auth(FOUNDER_ID)).json()
    names = [item["name"] for item in data["guilds"]]
    assert names == ["Core IA", "Otro Server"]


def test_bot_guild_inventory_returns_channels_and_roles(client, monkeypatch):
    async def fake_inventory(guild_id: int, token: str = "") -> dict:
        assert guild_id == 111
        return {
            "guild": {"id": "111", "name": "Core IA", "member_count": 12},
            "channels": [
                {"id": "900", "name": "general", "type": 0, "text": True, "category": None},
            ],
            "roles": [
                {"id": "800", "name": "Miembro", "color": 0, "managed": False, "default": False},
            ],
        }

    monkeypatch.setattr(discord_bot, "fetch_guild_inventory", fake_inventory)
    data = client.get(
        "/api/admin/discord-bot/guilds/111/inventory", headers=auth(FOUNDER_ID)
    ).json()
    assert data["guild"]["name"] == "Core IA"
    assert data["channels"][0]["name"] == "general"
    assert data["roles"][0]["name"] == "Miembro"


def test_bot_guild_config_roundtrip(client):
    headers = auth(FOUNDER_ID)
    response = client.patch(
        "/api/admin/discord-bot/guilds/111/config",
        json={
            "values": {
                "verify_role_id": "800",
                "verify_channel_id": "900",
                "welcome_message": "Bienvenido {user} a {server}!",
            }
        },
        headers=headers,
    )
    assert response.status_code == 200
    config = response.json()["config"]
    assert config["verify_role_id"] == "800"
    assert config["verify_channel_id"] == "900"
    assert "{user}" in config["welcome_message"]

    stored = client.get(
        "/api/admin/discord-bot/guilds/111/config", headers=headers
    ).json()["config"]
    assert stored["verify_role_id"] == "800"


def test_bot_guild_config_rejects_unknown_keys(client):
    response = client.patch(
        "/api/admin/discord-bot/guilds/111/config",
        json={"values": {"unknown_key": "1"}},
        headers=auth(FOUNDER_ID),
    )
    assert response.status_code == 400


def test_bot_test_message(client, monkeypatch):
    sent: list[tuple[int, str]] = []

    async def fake_send(channel_id: int, content: str, token: str = "") -> None:
        sent.append((channel_id, content))

    monkeypatch.setattr(discord_bot, "send_channel_message", fake_send)
    response = client.post(
        "/api/admin/discord-bot/guilds/111/test-message",
        json={"channel_id": "900", "content": "Prueba de Core IA"},
        headers=auth(FOUNDER_ID),
    )
    assert response.status_code == 200
    assert sent == [(900, "Prueba de Core IA")]


def test_bot_sync_when_bot_off(client):
    response = client.post("/api/admin/discord-bot/sync", headers=auth(FOUNDER_ID))
    assert response.status_code == 409


def _fake_oauth(monkeypatch, discord_id: str) -> None:
    async def fake_exchange(url: str, data: dict) -> str:
        return "access-token"

    async def fake_profile(url: str, access_token: str) -> dict:
        return {"id": discord_id, "username": "tester", "verified": True}

    monkeypatch.setattr(main, "_exchange_code", fake_exchange)
    monkeypatch.setattr(main, "_fetch_profile", fake_profile)


def test_bot_discord_login_redirects_to_discord(client):
    response = client.get(
        "/api/admin/discord-bot/login", follow_redirects=False
    )
    assert response.status_code == 307
    assert "discord.com" in response.headers["location"]


def test_bot_discord_login_denied_for_non_founder(client, monkeypatch):
    _fake_oauth(monkeypatch, "999888777666555444")
    state = main._panel_oauth_state("https://testserver")
    response = client.get(
        "/api/auth/discord/callback",
        params={"code": "abc", "state": state},
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert response.headers["location"].startswith("https://testserver/bot/")
    assert "denied=1" in response.headers["location"]


def test_bot_discord_login_grants_founder(client, monkeypatch):
    _fake_oauth(monkeypatch, FOUNDER_ID)
    state = main._panel_oauth_state("https://testserver")
    response = client.get(
        "/api/auth/discord/callback",
        params={"code": "abc", "state": state},
        follow_redirects=False,
    )
    assert response.status_code == 307
    location = response.headers["location"]
    assert location.startswith("https://testserver/bot/")
    assert "#token=" in location


def test_bot_discord_login_redirects_with_panel_state(client):
    # El login del panel pasa por el OAuth global y comparte redirect_uri.
    response = client.get("/api/admin/discord-bot/login", follow_redirects=False)
    assert response.status_code == 307
    assert "discord.com" in response.headers["location"]
