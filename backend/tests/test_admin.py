"""Pruebas del panel de administración y de los proveedores de login."""

import pytest
from fastapi.testclient import TestClient

import main
from main import app

FOUNDER_ID = "719050307593830440"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def auth(user_id: str, provider: str = "discord") -> dict[str, str]:
    token = main.create_session_token(
        {
            "provider": provider,
            "id": user_id,
            "username": "admin-tester",
            "display_name": "Admin Tester",
            "email": None,
            "avatar_url": None,
        }
    )
    return {"Authorization": f"Bearer {token}"}


def test_auth_me_reports_admin_flag(client):
    founder = client.get("/api/auth/me", headers=auth(FOUNDER_ID)).json()["user"]
    assert founder["is_admin"] is True

    normal = client.get("/api/auth/me", headers=auth("800000000000000001")).json()["user"]
    assert normal["is_admin"] is False


def test_admin_endpoints_require_auth(client):
    assert client.get("/api/admin/stats").status_code == 401
    assert client.get("/api/admin/users").status_code == 401


def test_admin_endpoints_forbidden_for_normal_user(client):
    headers = auth("800000000000000002")
    assert client.get("/api/admin/stats", headers=headers).status_code == 403
    assert client.get("/api/admin/users", headers=headers).status_code == 403


def test_admin_stats_and_user_management(client, monkeypatch):
    monkeypatch.setattr(main, "generate_reply", lambda message, preferred_model=None: "ok")
    founder = auth(FOUNDER_ID)
    member_id = "800000000000000003"
    member = auth(member_id)

    client.post("/api/chat", json={"message": "hola"}, headers=member)

    stats = client.get("/api/admin/stats", headers=founder)
    assert stats.status_code == 200
    body = stats.json()
    assert body["users"] >= 1
    assert body["messages"] >= 2
    assert FOUNDER_ID in body["founders"]

    users = client.get("/api/admin/users", headers=founder).json()["users"]
    target = next(user for user in users if user["discord_id"] == member_id)
    assert target["plan"] == "free"
    assert target["is_founder"] is False

    changed = client.patch(
        f"/api/admin/users/{target['id']}", json={"plan": "pro"}, headers=founder
    )
    assert changed.status_code == 200
    assert changed.json()["user"]["plan"] == "pro"

    invalid = client.patch(
        f"/api/admin/users/{target['id']}", json={"plan": "gold"}, headers=founder
    )
    assert invalid.status_code == 422

    deleted = client.delete(f"/api/admin/users/{target['id']}", headers=founder)
    assert deleted.status_code == 200
    remaining = client.get("/api/admin/users", headers=founder).json()["users"]
    assert all(user["discord_id"] != member_id for user in remaining)


def test_providers_endpoint_returns_configured(client):
    data = client.get("/api/auth/providers").json()
    assert "discord" in data["providers"]


def test_unconfigured_provider_returns_503(client):
    assert client.get("/api/auth/google/login", follow_redirects=False).status_code == 503


def test_google_provider_user_can_chat(client, monkeypatch):
    monkeypatch.setattr(main, "generate_reply", lambda message, preferred_model=None: "ok")
    headers = auth("google-user-1", provider="google")
    response = client.post("/api/chat", json={"message": "hola"}, headers=headers)
    assert response.status_code == 200


def test_email_register_and_login(client):
    email = "correo-test@example.com"

    register = client.post(
        "/api/auth/register",
        json={"email": email, "password": "supersecret", "name": "Correo"},
    )
    assert register.status_code == 200
    token = register.json()["token"]
    assert token

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["user"]["email"] == email
    assert me.json()["user"]["is_admin"] is False

    duplicate = client.post("/api/auth/register", json={"email": email, "password": "another123"})
    assert duplicate.status_code == 409

    login = client.post("/api/auth/login", json={"email": email, "password": "supersecret"})
    assert login.status_code == 200
    assert login.json()["token"]

    wrong = client.post("/api/auth/login", json={"email": email, "password": "incorrecta"})
    assert wrong.status_code == 401

    unknown = client.post(
        "/api/auth/login", json={"email": "nadie@example.com", "password": "cualquiera1"}
    )
    assert unknown.status_code == 401


def test_email_register_validation(client):
    invalid_email = client.post(
        "/api/auth/register", json={"email": "no-es-correo", "password": "supersecret"}
    )
    assert invalid_email.status_code == 400
    short_password = client.post(
        "/api/auth/register", json={"email": "ok@example.com", "password": "corta"}
    )
    assert short_password.status_code == 422

