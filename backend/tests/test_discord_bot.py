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
