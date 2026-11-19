"""Pruebas de la API del agente (CLI y app de escritorio)."""

import json

import pytest
from fastapi.testclient import TestClient

import agent_api
import main
from main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def agent_key(monkeypatch):
    monkeypatch.setattr(main.settings, "agent_api_key", "agent-test-key")
    monkeypatch.setattr(main.settings, "vantage_api_key", "")
    # Las pruebas no deben llamar a Gemini ni a ningún proveedor real.
    monkeypatch.setattr(main.settings, "agent_provider", "llm")
    return {"X-Agent-API-Key": "agent-test-key"}


def _body(text="Hola", mode="agent", role="user"):
    return {
        "messages": [{"role": role, "content": text}],
        "mode": mode,
        "stream": False,
    }


def test_agent_requires_configured_key(client, monkeypatch):
    monkeypatch.setattr(main.settings, "agent_api_key", "")
    monkeypatch.setattr(main.settings, "vantage_api_key", "")
    response = client.post("/api/agent/chat", json=_body())
    assert response.status_code == 503


def test_agent_rejects_wrong_key(client, agent_key):
    response = client.post(
        "/api/agent/chat",
        json=_body(),
        headers={"X-Agent-API-Key": "clave-incorrecta"},
    )
    assert response.status_code == 401
    assert "inválida" in response.json()["detail"]


def test_agent_accepts_bearer_token(client, agent_key, monkeypatch):
    def fake(messages):
        return "respuesta"

    monkeypatch.setattr(agent_api.llm, "complete_messages", fake)
    response = client.post(
        "/api/agent/chat",
        json=_body(),
        headers={"Authorization": "Bearer agent-test-key"},
    )
    assert response.status_code == 200


def test_agent_health_hides_provider_name(client, agent_key):
    response = client.get("/api/agent/health", headers=agent_key)
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["model"] == "Core Model V1"
    assert "read_file" in data["tools"]
    # El proveedor real nunca se expone en el mensaje al usuario.
    assert "pollinations" not in json.dumps(data["model"]).lower()


def test_agent_chat_returns_model_label(client, agent_key, monkeypatch):
    captured = {}

    def fake(messages):
        captured["messages"] = messages
        return "Listo, creado."

    monkeypatch.setattr(agent_api.llm, "complete_messages", fake)
    response = client.post("/api/agent/chat", json=_body("Crea una carpeta"), headers=agent_key)
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Listo, creado."
    assert data["model"] == "Core Model V1"
    # El prompt de sistema del agente siempre va primero.
    assert captured["messages"][0]["role"] == "system"
    assert "Core IA Agent" in captured["messages"][0]["content"]


def test_agent_chat_mode_omits_agent_prompt(client, agent_key, monkeypatch):
    captured = {}

    def fake(messages):
        captured["messages"] = messages
        return "ok"

    monkeypatch.setattr(agent_api.llm, "complete_messages", fake)
    response = client.post("/api/agent/chat", json=_body(mode="chat"), headers=agent_key)
    assert response.status_code == 200
    assert captured["messages"][0]["role"] == "user"


def test_agent_wraps_tool_results(client, agent_key, monkeypatch):
    captured = {}

    def fake(messages):
        captured["messages"] = messages
        return "ok"

    monkeypatch.setattr(agent_api.llm, "complete_messages", fake)
    response = client.post(
        "/api/agent/chat",
        json={
            "messages": [
                {"role": "user", "content": "Lee el archivo"},
                {"role": "tool", "content": "contenido del archivo"},
            ],
            "mode": "agent",
        },
        headers=agent_key,
    )
    assert response.status_code == 200
    tool_message = captured["messages"][-1]
    assert tool_message["role"] == "user"
    assert "<tool_result>" in tool_message["content"]


def test_agent_rejects_oversized_history(client, agent_key, monkeypatch):
    monkeypatch.setattr(main.settings, "agent_max_history_chars", 50)
    captured = {}

    def fake(messages):
        captured["messages"] = messages
        return "ok"

    monkeypatch.setattr(agent_api.llm, "complete_messages", fake)
    response = client.post(
        "/api/agent/chat",
        json={
            "messages": [
                {"role": "user", "content": "a" * 400},
                {"role": "assistant", "content": "b" * 400},
                {"role": "user", "content": "consulta final"},
            ],
            "mode": "agent",
        },
        headers=agent_key,
    )
    assert response.status_code == 200
    assert captured["messages"][-1]["content"] == "consulta final"


def test_agent_stream_sends_sse(client, agent_key, monkeypatch):
    def fake(messages):
        yield "Hola"
        yield " mundo"

    monkeypatch.setattr(agent_api.llm, "stream_messages", fake)
    with client.stream(
        "POST",
        "/api/agent/chat/stream",
        json=_body("Hola"),
        headers=agent_key,
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        raw = "".join(response.iter_text())

    events = [
        json.loads(line[5:].strip())
        for line in raw.splitlines()
        if line.startswith("data:")
    ]
    deltas = "".join(event.get("delta", "") for event in events)
    assert deltas == "Hola mundo"
    assert events[-1]["done"] is True


def test_agent_stream_reports_provider_error(client, agent_key, monkeypatch):
    def fake(messages):
        raise RuntimeError("proveedor caído")
        yield ""  # pragma: no cover - convierte la función en generador

    monkeypatch.setattr(agent_api.llm, "stream_messages", fake)
    with client.stream(
        "POST",
        "/api/agent/chat/stream",
        json=_body("Hola"),
        headers=agent_key,
    ) as response:
        raw = "".join(response.iter_text())

    assert "El modelo no respondió" in raw
    assert "proveedor caído" not in raw


def test_agent_validates_payload(client, agent_key):
    response = client.post(
        "/api/agent/chat",
        json={"messages": []},
        headers=agent_key,
    )
    assert response.status_code == 422


def test_agent_uses_gemini_in_auto_mode(client, agent_key, monkeypatch):
    monkeypatch.setattr(main.settings, "agent_provider", "auto")
    monkeypatch.setattr(main.settings, "ai_api_key", "fake-key")
    monkeypatch.setattr(
        agent_api, "_gemini_complete", lambda messages: "respuesta de gemini"
    )
    response = client.post("/api/agent/chat", json=_body(), headers=agent_key)
    assert response.status_code == 200
    assert response.json()["message"] == "respuesta de gemini"


def test_agent_falls_back_to_open_engine(client, agent_key, monkeypatch):
    monkeypatch.setattr(main.settings, "agent_provider", "auto")
    monkeypatch.setattr(main.settings, "ai_api_key", "fake-key")

    def fail(messages):
        raise RuntimeError("gemini caído")

    monkeypatch.setattr(agent_api, "_gemini_complete", fail)
    monkeypatch.setattr(
        agent_api.llm, "complete_messages", lambda messages: "respuesta de respaldo"
    )
    response = client.post("/api/agent/chat", json=_body(), headers=agent_key)
    assert response.status_code == 200
    assert response.json()["message"] == "respuesta de respaldo"


def test_agent_stream_uses_gemini(client, agent_key, monkeypatch):
    monkeypatch.setattr(main.settings, "agent_provider", "auto")
    monkeypatch.setattr(main.settings, "ai_api_key", "fake-key")
    monkeypatch.setattr(
        agent_api,
        "_gemini_stream",
        lambda messages: iter(["Hola", " desde Gemini"]),
    )
    with client.stream(
        "POST",
        "/api/agent/chat/stream",
        json=_body("Hola"),
        headers=agent_key,
    ) as response:
        raw = "".join(response.iter_text())
    events = [
        json.loads(line[5:].strip())
        for line in raw.splitlines()
        if line.startswith("data:")
    ]
    assert "".join(event.get("delta", "") for event in events) == "Hola desde Gemini"


def test_gemini_contents_extracts_system_and_merges_roles():
    system, contents = agent_api._gemini_contents(
        [
            {"role": "system", "content": "Eres un agente."},
            {"role": "user", "content": "uno"},
            {"role": "user", "content": "dos"},
            {"role": "assistant", "content": "tres"},
        ]
    )
    assert system == "Eres un agente."
    assert [content.role for content in contents] == ["user", "model"]
    assert [part.text for part in contents[0].parts] == ["uno", "dos"]
