"""Pruebas de la publicación y comprobación de actualizaciones del APK."""

import base64

import pytest
from fastapi.testclient import TestClient

import main
from main import app

APK_BYTES = b"PK\x03\x04coreia-apk-de-prueba" + b"\x00" * 1024
APK_B64 = base64.b64encode(APK_BYTES).decode()


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def upload_token(monkeypatch):
    monkeypatch.setattr(main.settings, "bot_update_upload_token", "tok-test-123")
    return {"x-upload-token": "tok-test-123"}


def publish(client, headers, version_code=9, version_name="1.0.9", changelog="Bugfixes."):
    return client.post(
        "/api/bot/update/upload",
        json={
            "version_code": version_code,
            "version_name": version_name,
            "changelog": changelog,
            "apk_base64": APK_B64,
        },
        headers=headers,
    )


def test_upload_requires_token(client, monkeypatch):
    monkeypatch.setattr(main.settings, "bot_update_upload_token", "")
    response = client.post(
        "/api/bot/update/upload",
        json={
            "version_code": 1,
            "version_name": "1.0.1",
            "changelog": "",
            "apk_base64": APK_B64,
        },
        headers={"x-upload-token": ""},
    )
    assert response.status_code == 403


def test_upload_rejects_wrong_token(client, upload_token):
    response = client.post(
        "/api/bot/update/upload",
        json={
            "version_code": 1,
            "version_name": "1.0.1",
            "changelog": "",
            "apk_base64": APK_B64,
        },
        headers={"x-upload-token": "incorrecto"},
    )
    assert response.status_code == 403


def test_upload_rejects_invalid_base64(client, upload_token):
    response = client.post(
        "/api/bot/update/upload",
        json={
            "version_code": 1,
            "version_name": "1.0.1",
            "changelog": "",
            "apk_base64": "/" * 200,
        },
        headers=upload_token,
    )
    assert response.status_code == 400


def test_upload_publishes_and_check_serves_apk(client, upload_token, monkeypatch):
    published: dict[str, int] = {"count": 0}

    async def fake_notify(manifest):
        published["count"] += 1
        return 0

    async def fake_guilds(token: str = ""):
        return []

    monkeypatch.setattr(main, "_notify_bot_update", fake_notify)
    monkeypatch.setattr(main.discord_bot, "fetch_bot_guilds", fake_guilds)

    response = publish(client, upload_token)
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["notified_guilds"] == 0
    assert published["count"] == 1

    check = client.get("/bot/update/check?current=8").json()
    assert check["has_update"] is True
    assert check["version_name"] == "1.0.9"
    assert check["version_code"] == 9
    assert check["changelog"] == "Bugfixes."
    assert check["apk_url"].endswith("/bot/update/latest.apk")

    same = client.get("/bot/update/check?current=9").json()
    assert same["has_update"] is False

    apk = client.get("/bot/update/latest.apk")
    assert apk.status_code == 200
    assert apk.content == APK_BYTES
    assert apk.headers["content-type"].startswith("application/vnd.android.package-archive")


def test_update_check_without_manifest(client, monkeypatch, tmp_path):
    from database import SessionLocal
    from sqlalchemy import select

    import models

    # Elimina cualquier manifest previo para probar el estado vacío.
    session = SessionLocal()
    for key in (main.BOT_UPDATE_MANIFEST_KEY, main.BOT_UPDATE_APK_KEY):
        for row in session.execute(
            select(models.AppSetting).where(models.AppSetting.key == key)
        ).scalars():
            session.delete(row)
    session.commit()
    session.close()

    data = client.get("/bot/update/check?current=3").json()
    assert data["has_update"] is False

    apk = client.get("/bot/update/latest.apk")
    assert apk.status_code == 404
