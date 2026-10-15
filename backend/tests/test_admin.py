"""Pruebas del panel de administración y de los proveedores de login."""

import pytest
from fastapi.testclient import TestClient

import main
from main import app

FOUNDER_ID = "1439761085040427100"


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


def test_admin_can_ban_and_suspend_user(client):
    founder = auth(FOUNDER_ID)
    member_id = "800000000000000004"
    member = auth(member_id)

    client.post("/api/chat", json={"message": "hola"}, headers=member)
    users = client.get("/api/admin/users", headers=founder).json()["users"]
    target = next(user for user in users if user["discord_id"] == member_id)

    banned = client.patch(
        f"/api/admin/users/{target['id']}", json={"is_banned": True}, headers=founder
    )
    assert banned.status_code == 200
    assert banned.json()["user"]["is_banned"] is True

    blocked = client.get("/api/auth/me", headers=member)
    assert blocked.status_code == 403

    client.patch(
        f"/api/admin/users/{target['id']}",
        json={"is_banned": False, "is_active": True},
        headers=founder,
    )
    client.delete(f"/api/admin/users/{target['id']}", headers=founder)


def test_admin_audit_flags_and_notices(client):
    founder = auth(FOUNDER_ID)

    flags = client.get("/api/admin/flags", headers=founder)
    assert flags.status_code == 200
    keys = {flag["key"] for flag in flags.json()["flags"]}
    assert {"chat", "image_generation", "rag"} <= keys

    toggled = client.patch(
        "/api/admin/flags/image_generation", json={"enabled": False}, headers=founder
    )
    assert toggled.status_code == 200
    assert toggled.json()["flag"]["enabled"] is False
    assert client.get("/api/config").json()["flags"]["image_generation"] is False

    created = client.post(
        "/api/admin/notices",
        json={"message": "Mantenimiento programado", "level": "warning"},
        headers=founder,
    )
    assert created.status_code == 200
    notice_id = created.json()["notice"]["id"]

    public = client.get("/api/notices").json()["notices"]
    assert any(notice["id"] == notice_id for notice in public)

    audit = client.get("/api/admin/audit", headers=founder).json()["logs"]
    actions = {entry["action"] for entry in audit}
    assert "flag.update" in actions
    assert "notice.create" in actions

    deleted = client.delete(f"/api/admin/notices/{notice_id}", headers=founder)
    assert deleted.status_code == 200

    client.patch("/api/admin/flags/image_generation", json={"enabled": True}, headers=founder)


def test_admin_can_update_and_toggle_notice(client):
    founder = auth(FOUNDER_ID)

    created = client.post(
        "/api/admin/notices",
        json={"message": "Aviso inicial", "level": "info"},
        headers=founder,
    )
    notice_id = created.json()["notice"]["id"]
    assert created.json()["notice"]["active"] is True

    updated = client.patch(
        f"/api/admin/notices/{notice_id}",
        json={"level": "success", "message": "Aviso actualizado"},
        headers=founder,
    )
    assert updated.status_code == 200
    assert updated.json()["notice"]["level"] == "success"
    assert updated.json()["notice"]["message"] == "Aviso actualizado"

    hidden = client.patch(
        f"/api/admin/notices/{notice_id}", json={"active": False}, headers=founder
    )
    assert hidden.json()["notice"]["active"] is False
    public = client.get("/api/notices").json()["notices"]
    assert all(notice["id"] != notice_id for notice in public)

    shown = client.patch(
        f"/api/admin/notices/{notice_id}", json={"active": True}, headers=founder
    )
    assert shown.json()["notice"]["active"] is True
    public = client.get("/api/notices").json()["notices"]
    assert any(notice["id"] == notice_id for notice in public)

    audit = client.get("/api/admin/audit", headers=founder).json()["logs"]
    assert "notice.update" in {entry["action"] for entry in audit}

    assert client.patch(
        "/api/admin/notices/999999", json={"active": False}, headers=founder
    ).status_code == 404
    client.delete(f"/api/admin/notices/{notice_id}", headers=founder)


def test_providers_endpoint_returns_configured(client):
    data = client.get("/api/auth/providers").json()
    assert "discord" in data["providers"]
    assert "google" not in data["providers"]


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

