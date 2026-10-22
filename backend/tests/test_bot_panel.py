"""Pruebas del panel de administración del bot (REST y formulario)."""

import pytest
from collections import deque

from fastapi.testclient import TestClient

import discord_bot
import bot_extras
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


def test_bot_panel_redirects_slashless_to_slash(client):
    """/bot sin barra debe redirigir a /bot/: el HTML carga bot.js relativo
    y sin la barra el WebView resuelve /bot.js (404) sin JavaScript."""
    response = client.get("/bot", follow_redirects=False)
    assert response.status_code == 301
    assert response.headers["location"].endswith("/bot/")


def test_bot_panel_pwa_assets(client):
    """El panel expone manifest y favicon (PWA instalable) y solo esos assets."""
    """El panel expone manifest y favicon (PWA instalable) y solo esos assets."""
    manifest = client.get("/bot/manifest.json", follow_redirects=False)
    assert manifest.status_code == 200
    assert manifest.headers["content-type"].startswith("application/manifest")
    assert '"Core IA Bot"' in manifest.text
    favicon = client.get("/bot/favicon.svg", follow_redirects=False)
    assert favicon.status_code == 200
    assert favicon.headers["content-type"].startswith("image/svg")
    # Lista cerrada: paths fuera de la whitelist no se sirven.
    assert client.get("/bot/secrets.txt").status_code == 404


def test_bot_app_home_shape(client):
    """Endpoint agregado del Resumen nativo de la APK (una sola llamada)."""
    response = client.get("/api/admin/discord-bot/app-home", headers=auth(FOUNDER_ID))
    assert response.status_code == 200
    data = response.json()
    assert set(data.keys()) == {"bot", "guilds", "stats", "modlog"}
    assert "running" in data["bot"]
    assert "messages_today" in data["stats"]


def test_aimod_verdict_parsing(client, monkeypatch):
    """Veredicto IA moderadora: JSON con tolerancia y fallos silenciosos."""
    import llm


    monkeypatch.setattr(
        llm, "complete_text",
        lambda message, system_instruction=None:
            'bla {"toxic": true, "score": 88, "reason": "insulto"} fin',
    )
    verdict = discord_bot.aimod_verdict("texto")
    assert verdict == {"toxic": True, "score": 88, "reason": "insulto"}

    monkeypatch.setattr(
        llm, "complete_text",
        lambda message, system_instruction=None: "sin json aqui",
    )
    assert discord_bot.aimod_verdict("texto")["toxic"] is False
    assert discord_bot.aimod_verdict("texto")["score"] == 0

    def boom(message, system_instruction=None):
        raise RuntimeError("motor caído")

    monkeypatch.setattr(llm, "complete_text", boom)
    assert discord_bot.aimod_verdict("texto")["toxic"] is False


def test_panel_roles_read_write_levels(client, monkeypatch):
    """Item 8: moderator lee el panel; admin escribe; user normal no entra."""
    async def fake_fetch(token: str = "") -> list:
        return []

    monkeypatch.setattr(discord_bot, "fetch_bot_guilds", fake_fetch)
    member_id = "800000000000000090"
    headers = {
        "Authorization": "Bearer " + main.create_session_token(
            {
                "provider": "discord",
                "id": member_id,
                "username": "panel-mod",
                "display_name": "Panel Mod",
                "email": None,
                "avatar_url": None,
            }
        )
    }
    up = client.get("/api/auth/me", headers=headers)
    assert up.status_code == 200

    users = client.get("/api/admin/users", headers=auth(FOUNDER_ID)).json()["users"]
    target = next(user for user in users if user["discord_id"] == member_id)

    # sin rol de equipo: 403 incluso en lectura
    assert client.get("/api/admin/discord-bot/stats", headers=headers).status_code == 403

    client.patch(
        f"/api/admin/users/{target['id']}", json={"role": "moderator"}, headers=auth(FOUNDER_ID)
    )
    # moderator: lectura ok, escritura 403
    assert client.get("/api/admin/discord-bot/stats", headers=headers).status_code == 200
    assert client.post("/api/admin/discord-bot/stop", headers=headers).status_code == 403

    resp = client.patch(
        f"/api/admin/users/{target['id']}", json={"role": "admin"}, headers=auth(FOUNDER_ID)
    )
    assert resp.status_code == 200
    # admin: escritura permitida (sync puede 400/409 por el bot, pero no 403)
    sync = client.post("/api/admin/discord-bot/sync", headers=headers)
    assert sync.status_code != 403

    # auditoría registra el cambio de rol
    audit = client.get("/api/admin/audit?limit=50", headers=auth(FOUNDER_ID)).json()["logs"]
    assert any("role=" in log["detail"] for log in audit)


def test_bot_translate_helper(client, monkeypatch):
    """Traducción con IA: limpia espacios y falla en silencio (item 9)."""
    import llm

    monkeypatch.setattr(
        llm,
        "complete_text",
        lambda message, system_instruction=None: "  Hola mundo  ",
    )
    assert discord_bot._bot_translate("Hello world", "es") == "Hola mundo"
    assert "español" not in discord_bot._bot_translate("Hello", "es")

    def boom(message, system_instruction=None):
        raise RuntimeError("motor caído")

    monkeypatch.setattr(llm, "complete_text", boom)
    assert discord_bot._bot_translate("Hello", "es") == ""


def test_bot_guild_stats_shape(client):
    """Métricas por servidor: total y última actividad (item 7)."""
    bot_extras.bump_guild_stat(987654321, "messages")
    bot_extras.flush_guild_stats()
    response = client.get(
        "/api/admin/discord-bot/guild-stats?days=14", headers=auth(FOUNDER_ID)
    )
    assert response.status_code == 200
    data = response.json()
    assert data["days"] == 14
    server = (data["servers"] or {}).get("987654321") or {}
    assert server.get("messages", 0) >= 1
    assert "total" in server


def test_bot_modlog_csv(client):
    """CSV de moderación: descarga anexada y filas de eventos."""
    bot_extras.record_event("antiraid_block", "prueba csv", "123")
    response = client.get("/api/admin/discord-bot/modlog.csv", headers=auth(FOUNDER_ID))
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    body = response.text
    assert "fecha,tipo,servidor,detalle" in body
    assert "antiraid_block" in body
    # requiere admin
    assert client.get("/api/admin/discord-bot/modlog.csv").status_code == 401


def test_bot_series_shape(client):
    """Serie histórica: días cronológicos con contadores por defecto a cero."""
    response = client.get("/api/admin/discord-bot/series?days=7", headers=auth(FOUNDER_ID))
    assert response.status_code == 200
    data = response.json()
    assert data["days"] == 7
    s = data["series"]
    assert len(s) == 7
    assert s[0]["day"] <= s[-1]["day"]  # cronológico asc
    for entry in s:
        assert {"day", "label", "messages", "welcomes", "verifications", "mods"} == set(entry.keys())
    # clamp de días
    assert client.get("/api/admin/discord-bot/series?days=999", headers=auth(FOUNDER_ID)).json()["days"] == 30


def test_bot_panel_endpoints_require_auth(client):
    assert client.get("/api/admin/discord-bot/guilds").status_code == 401
    assert client.get("/api/admin/discord-bot/guilds/123/inventory").status_code == 401
    assert client.get("/api/admin/discord-bot/guilds/123/config").status_code == 401


def test_bot_panel_forbidden_for_normal_user(client):
    headers = auth("800000000000000010")
    assert client.get("/api/admin/discord-bot/guilds", headers=headers).status_code == 403


def test_bot_panel_allows_admin_email(client, monkeypatch):
    monkeypatch.setattr(main.settings, "admin_emails", ["admin@coreia.com"])
    token = main.create_session_token(
        {
            "provider": "email",
            "id": 777,
            "username": "admin",
            "display_name": "Core IA Admin",
            "email": "admin@coreia.com",
            "avatar_url": None,
            "email_verified": True,
        }
    )
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["user"]
    assert me["is_admin"] is True
    assert client.get("/api/admin/discord-bot", headers={"Authorization": f"Bearer {token}"}).status_code == 200


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


def test_bot_guild_config_new_protection_keys(client):
    """Las llaves de anti-raid/anti-spam/voz/transcript pasan el PATCH."""
    values = {
        "antiraid_enabled": "1",
        "antiraid_joins": "5",
        "antiraid_secs": "60",
        "antiraid_min_age_days": "7",
        "antiraid_action": "kick",
        "antispam_enabled": "1",
        "antispam_msgs": "6",
        "antispam_secs": "8",
        "antispam_mentions": "6",
        "voice_temp_enabled": "1",
        "voice_lobby_id": "12345",
        "ticket_transcript_enabled": "1",
    }
    response = client.patch(
        "/api/admin/discord-bot/guilds/222/config",
        json={"values": values},
        headers=auth(FOUNDER_ID),
    )
    assert response.status_code == 200
    stored = client.get(
        "/api/admin/discord-bot/guilds/222/config", headers=auth(FOUNDER_ID)
    ).json()["config"]
    for key, value in values.items():
        assert stored[key] == value


def test_antispam_level_escalates():
    assert discord_bot.antispam_level(0) == "warn"
    assert discord_bot.antispam_level(1) == "warn"
    assert discord_bot.antispam_level(2) == "timeout"
    assert discord_bot.antispam_level(3) == "kick"


def test_join_burst_window():
    burst: deque[float] = deque()
    now = 1000.0
    for offset in (50.0, 40.0, 30.0, 20.0):
        burst.append(now - offset)
    # 5 entradas dentro de la ventana de 60 s
    burst.append(now)
    assert discord_bot.evaluate_join_burst(burst, now, 60, 5) is True
    assert discord_bot.evaluate_join_burst(burst, now, 60, 6) is False
    # vencidas todas: fuera de ventana
    assert discord_bot.evaluate_join_burst(deque([now - 500]), now, 60, 1) is False


def test_config_bool_parses_flags():
    config = {"a": "1", "b": "true", "c": "ON", "d": "sí", "e": "0", "f": "no", "g": ""}
    assert discord_bot._config_bool(config, "a") is True
    assert discord_bot._config_bool(config, "b") is True
    assert discord_bot._config_bool(config, "c") is True
    assert discord_bot._config_bool(config, "d") is True
    assert discord_bot._config_bool(config, "e") is False
    assert discord_bot._config_bool(config, "f") is False
    assert discord_bot._config_bool(config, "g") is False
    assert discord_bot._config_bool(config, "ausente", default=True) is True


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


def test_panel_login_honors_whitelisted_origin(client, monkeypatch):
    """El login del panel vuelve al host del panel si está en ALLOWED_ORIGINS."""
    monkeypatch.setattr(main.settings, "allowed_origins", ["https://panel-vercel.ejemplo"])

    state = main._trusted_panel_origin("https://panel-vercel.ejemplo")
    assert state == "https://panel-vercel.ejemplo"

    _fake_oauth(monkeypatch, FOUNDER_ID)
    signed = main._panel_oauth_state("https://panel-vercel.ejemplo")
    response = client.get(
        "/api/auth/discord/callback",
        params={"code": "abc", "state": signed},
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert response.headers["location"].startswith("https://panel-vercel.ejemplo/bot/")
    assert "#token=" in response.headers["location"]


def test_panel_login_rejects_unknown_origin(client, monkeypatch):
    """Un origen no listado no puede robar la redirección del panel."""
    monkeypatch.setattr(main.settings, "allowed_origins", [])
    assert main._trusted_panel_origin("https://malicioso.ejemplo") == main._panel_origin()


def test_events_endpoint_filters_by_since(client, monkeypatch):
    """El poller de la APK lee eventos nuevos filtrados por fecha."""
    monkeypatch.setattr(
        bot_extras, "load_events",
        lambda: [
            {"t": "2026-10-22T12:00:00+00:00", "kind": "welcome",
             "detail": "lauti", "guild": "1551284673165000885"},
            {"t": "2026-10-22T10:00:00+00:00", "kind": "moderation",
             "detail": "timeout", "guild": "1551284673165000885"},
        ],
    )
    token_h = auth(FOUNDER_ID)

    todo = client.get("/api/admin/discord-bot/events", headers=token_h).json()
    assert len(todo["events"]) == 2

    nuevos = client.get(
        "/api/admin/discord-bot/events",
        params={"since": "2026-10-22T11:00:00+00:00"},
        headers=token_h,
    ).json()
    assert [e["kind"] for e in nuevos["events"]] == ["welcome"]

    requerido = client.get("/api/admin/discord-bot/events")
    assert requerido.status_code in (401, 403)


def test_config_theme_validation(client, monkeypatch):
    """El tema acepta dark/light y un acento del preset; lo demás no pasa."""
    guardadas: dict[str, str] = {}

    monkeypatch.setattr(main.discord_bot, "save_guild_config",
                        lambda gid, values: guardadas.update(values))
    monkeypatch.setattr(main.discord_bot, "load_guild_config",
                        lambda gid: {})
    token_h = auth(FOUNDER_ID)

    ok = client.patch(
        "/api/admin/discord-bot/guilds/1551284673165000885/config",
        json={"values": {"theme_mode": "light",
                         "accent_color": "#22c55e"}},
        headers=token_h,
    )
    assert ok.status_code == 200
    assert guardadas["theme_mode"] == "light"
    assert guardadas["accent_color"] == "#22c55e"

    rechazo = client.patch(
        "/api/admin/discord-bot/guilds/1551284673165000885/config",
        json={"values": {"theme_mode": "neón", "accent_color": "#ff00ff"}},
        headers=token_h,
    )
    # Ningún valor del preset válido → nada que guardar → 400 y sin cambios.
    assert rechazo.status_code == 400
    assert guardadas.get("accent_color") in ("", "#22c55e")




def test_ai_welcome_uses_generated_text(client, monkeypatch):
    """Con welcome_ai_enabled el saludo sale redactado por IA (item 5)."""
    import asyncio
    import discord_bot
    import main as m

    enviado: dict[str, list] = {"embeds": []}

    monkeypatch.setattr(discord_bot, "_ai_welcome_text",
                        lambda memb: "¡Hola Laurita! Me alegro verte por acá")

    import asyncio as _asyncio

    class FakeChannel:
        async def send(self, **kw):
            enviado["embeds"].append(kw)
    canal = FakeChannel()

    class FakeGuild:
        name = "Core IA"
        id = 1551284673165000885
        member_count = 5

        def get_channel(self, cid):
            return canal if cid == 100 else None

        def get_role(self, rid):
            return None

    FakeGuild.__name__ = "FakeGuild"

    class FakeMember:
        guild = FakeGuild()
        mention = "@lauti"
        display_name = "lauti"
        display_avatar = type("FakeAvatar", (), {"url": "http://a/x.png"})()
        created_at = None
        joined_at = None
        roles = []

    monkeypatch.setattr(discord_bot, "load_guild_config", lambda gid: {
        "welcome_channel_id": "100",
        "welcome_ai_enabled": "1",
        "welcome_message": "plantilla fija",
    })
    monkeypatch.setattr(discord_bot, "_resolve_channel",
                        lambda guild, cfg, key: canal
                        if key == "welcome_channel_id" else None)
    monkeypatch.setattr(m.bot_extras, "bump_stat", lambda *a, **k: None)
    monkeypatch.setattr(m.bot_extras, "bump_guild_stat", lambda *a, **k: None)
    monkeypatch.setattr(m.bot_extras, "record_event", lambda *a, **k: None)

    manager = discord_bot.BotManager()
    async def noop_log(*a, **k):
        return None
    manager._send_log = noop_log

    asyncio.run(manager._on_member_join(FakeMember()))
    assert enviado["embeds"], "debía enviar el embed de bienvenida"
    desc = enviado["embeds"][0]["embed"].description
    assert "Laurita" in desc
    assert "plantilla fija" not in desc
