"""Pruebas del bot de Discord (sin conectar a Discord)."""

import asyncio

import discord_bot


def test_split_message_short():
    assert discord_bot._split_message("hola") == ["hola"]


def test_split_message_long():
    text = "\n".join(f"línea {index}" for index in range(500))
    chunks = discord_bot._split_message(text)
    assert len(chunks) > 1
    assert all(len(chunk) <= discord_bot.MAX_MESSAGE for chunk in chunks)
    assert "línea 0" in chunks[0]
    assert "línea 499" in chunks[-1]


def test_build_prompt_with_history():
    prompt = discord_bot.build_prompt(
        "¿Qué es Core IA?",
        [("Usuario", "hola"), ("Core IA", "Hola, ¿en qué ayudo?")],
    )
    assert "hola" in prompt
    assert "¿Qué es Core IA?" in prompt
    assert prompt.endswith("Responde solo al último mensaje del usuario.")


def test_channel_allowed():
    assert discord_bot._channel_allowed(1, set())
    assert discord_bot._channel_allowed(1, {"1"})
    assert not discord_bot._channel_allowed(1, {"2"})


def test_manager_status_without_token():
    manager = discord_bot.BotManager()
    manager.configure(lambda *args, **kwargs: "", "sistema", token="")
    status = manager.status()
    assert status["configured"] is False
    assert status["running"] is False
    assert status["ready"] is False


def test_manager_start_without_token():
    manager = discord_bot.BotManager()
    manager.configure(lambda *args, **kwargs: "", "sistema", token="")
    try:
        asyncio.run(manager.start())
    except discord_bot.BotNotConfigured as exc:
        assert "DISCORD_BOT_TOKEN" in str(exc)
    else:  # pragma: no cover - solo si cambia el comportamiento
        raise AssertionError("start() debió rechazar la falta de token")


def test_manager_stop_when_off():
    manager = discord_bot.BotManager()
    status = asyncio.run(manager.stop())
    assert status["running"] is False


def test_guild_config_key():
    assert (
        discord_bot.guild_config_key(123, "verify_role_id")
        == "discord:123:verify_role_id"
    )


def test_render_template_replaces_known_placeholders():
    rendered = discord_bot._render_template(
        "Hola {user}, bienvenido a {server}. {missing}",
        {"user": "<@1>", "server": "Core IA"},
    )
    assert rendered == "Hola <@1>, bienvenido a Core IA. {missing}"


def test_config_int_handles_invalid_values():
    assert discord_bot._config_int({"days": "7"}, "days") == 7
    assert discord_bot._config_int({"days": "no"}, "days", default=3) == 3
    assert discord_bot._config_int({}, "days", default=5) == 5


def test_guild_config_roundtrip():
    from database import SessionLocal, init_db
    from models import AppSetting

    init_db()
    guild_id = 987654321012345678
    prefix = f"discord:{guild_id}:"
    try:
        discord_bot.save_guild_config(
            guild_id,
            {
                "verify_role_id": "111",
                "welcome_channel_id": "222",
                "min_account_age_days": 7,
                "welcome_message": "Hola {user}",
            },
        )
        config = discord_bot.load_guild_config(guild_id)
        assert config["verify_role_id"] == "111"
        assert config["welcome_channel_id"] == "222"
        assert config["min_account_age_days"] == "7"
        assert config["welcome_message"] == "Hola {user}"
        assert config["goodbye_message"] == discord_bot.DEFAULT_GOODBYE
    finally:
        db = SessionLocal()
        try:
            db.query(AppSetting).filter(AppSetting.key.like(prefix + "%")).delete(
                synchronize_session=False
            )
            db.commit()
        finally:
            db.close()
