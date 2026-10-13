"""Pruebas de integración del backend de Core IA."""

import pytest
from fastapi.testclient import TestClient

import main
from main import app, create_session_token


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def auth_header() -> dict[str, str]:
    token = create_session_token(
        {
            "id": "999999999999999999",
            "username": "tester",
            "display_name": "Tester",
            "email": None,
            "avatar_url": None,
        }
    )
    return {"Authorization": f"Bearer {token}"}


def test_health(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_login_redirect(client):
    response = client.get("/api/auth/discord/login", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert "discord.com/oauth2/authorize" in response.headers["location"]


def test_me_requires_auth(client):
    assert client.get("/api/auth/me").status_code == 401


def test_chat_requires_auth(client):
    assert client.post("/api/chat", json={"message": "hola"}).status_code == 401


def test_chat_persists_conversation(client, monkeypatch):
    monkeypatch.setattr(main, "generate_reply", lambda message, preferred_model=None: "respuesta de prueba")
    response = client.post("/api/chat", json={"message": "hola"}, headers=auth_header())
    assert response.status_code == 200
    data = response.json()
    assert data["reply"] == "respuesta de prueba"
    assert data["conversation_id"] is not None


def test_chat_rate_limit_headers(client, monkeypatch):
    monkeypatch.setattr(main, "generate_reply", lambda message, preferred_model=None: "ok")
    response = client.post("/api/chat", json={"message": "hola"}, headers=auth_header())
    assert response.status_code == 200
