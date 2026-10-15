"""Pruebas de la sección 4: conversaciones, ajustes, planes y cuotas."""

import pytest
from fastapi.testclient import TestClient

import main
from main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def auth(user_id: str) -> dict[str, str]:
    token = main.create_session_token(
        {
            "id": user_id,
            "username": "product-tester",
            "display_name": "Product Tester",
            "email": None,
            "avatar_url": None,
        }
    )
    return {"Authorization": f"Bearer {token}"}


def test_conversations_lifecycle(client, monkeypatch):
    monkeypatch.setattr(
        main, "generate_reply", lambda message, preferred_model=None, **_: "ok"
    )
    headers = auth("600000000000000001")

    created = client.post("/api/chat", json={"message": "primer mensaje"}, headers=headers)
    assert created.status_code == 200
    conversation_id = created.json()["conversation_id"]

    listed = client.get("/api/conversations", headers=headers).json()["conversations"]
    assert any(item["id"] == conversation_id for item in listed)

    detail = client.get(f"/api/conversations/{conversation_id}", headers=headers).json()
    assert len(detail["conversation"]["items"]) == 2

    renamed = client.patch(
        f"/api/conversations/{conversation_id}", json={"title": "Renombrado"}, headers=headers
    )
    assert renamed.status_code == 200
    assert renamed.json()["conversation"]["title"] == "Renombrado"

    assert client.delete(f"/api/conversations/{conversation_id}", headers=headers).status_code == 200
    assert client.get(f"/api/conversations/{conversation_id}", headers=headers).status_code == 404


def test_conversations_isolated_between_users(client):
    headers = auth("600000000000000002")
    assert client.get("/api/conversations/999999", headers=headers).status_code == 404


def test_settings_defaults_and_update(client):
    headers = auth("600000000000000003")

    defaults = client.get("/api/settings", headers=headers).json()["settings"]
    assert defaults == {"theme": "dark", "preferred_model": None, "use_rag": True}

    updated = client.patch(
        "/api/settings",
        json={"theme": "light", "preferred_model": "gemini-3.5-flash", "use_rag": False},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["settings"] == {
        "theme": "light",
        "preferred_model": "gemini-3.5-flash",
        "use_rag": False,
    }


def test_settings_validation(client):
    headers = auth("600000000000000008")
    assert client.patch("/api/settings", json={"theme": "blue"}, headers=headers).status_code == 422


def test_plans_catalog(client):
    catalog = client.get("/api/plans").json()["plans"]
    assert set(catalog) == {"free", "pro", "enterprise"}


def test_usage_endpoint(client):
    headers = auth("600000000000000004")
    data = client.get("/api/usage", headers=headers).json()
    assert data["plan"] == "free"
    assert data["usage"] == {"messages": 0, "images": 0, "documents": 0}
    assert data["limits"]["messages_per_day"] == 100


def test_message_quota_enforced(client, monkeypatch):
    monkeypatch.setattr(
        main.plans,
        "limits_for",
        lambda plan: {"messages_per_day": 1, "images_per_day": 0, "documents": 0},
    )
    monkeypatch.setattr(
        main, "generate_reply", lambda message, preferred_model=None, **_: "ok"
    )
    headers = auth("600000000000000005")

    assert client.post("/api/chat", json={"message": "uno"}, headers=headers).status_code == 200
    assert client.post("/api/chat", json={"message": "dos"}, headers=headers).status_code == 429


def test_document_quota_enforced(client, monkeypatch):
    monkeypatch.setattr(
        main.plans,
        "limits_for",
        lambda plan: {"messages_per_day": 100, "images_per_day": 100, "documents": 0},
    )
    headers = auth("600000000000000006")
    response = client.post(
        "/api/rag/documents", json={"title": "x", "text": "contenido"}, headers=headers
    )
    assert response.status_code == 429


def test_delete_account(client, monkeypatch):
    monkeypatch.setattr(
        main, "generate_reply", lambda message, preferred_model=None, **_: "ok"
    )
    headers = auth("600000000000000007")

    client.post("/api/chat", json={"message": "hola"}, headers=headers)
    client.patch("/api/settings", json={"theme": "light"}, headers=headers)

    assert client.delete("/api/account", headers=headers).status_code == 200
    assert client.get("/api/conversations", headers=headers).json()["conversations"] == []
    assert client.get("/api/settings", headers=headers).json()["settings"]["theme"] == "dark"


def test_endpoints_require_auth(client):
    for method, path in [
        ("get", "/api/conversations"),
        ("get", "/api/settings"),
        ("get", "/api/usage"),
        ("delete", "/api/account"),
    ]:
        assert getattr(client, method)(path).status_code == 401
    assert client.get("/api/plans").status_code == 200
