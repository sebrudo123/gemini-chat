"""Pruebas de compartir conversaciones, adjuntos y sesiones revocables."""

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
            "username": "share-tester",
            "display_name": "Share Tester",
            "email": None,
            "avatar_url": None,
        }
    )
    return {"Authorization": f"Bearer {token}"}


def test_share_link_is_public_and_revocable(client, monkeypatch):
    headers = auth("600000000000000021")
    monkeypatch.setattr(
        main, "generate_reply", lambda message, preferred_model=None, **_: "hola"
    )
    created = client.post(
        "/api/chat", json={"message": "conversacion compartida"}, headers=headers
    )
    conversation_id = created.json()["conversation_id"]

    shared = client.post(
        f"/api/conversations/{conversation_id}/share", headers=headers
    )
    assert shared.status_code == 200
    token = shared.json()["token"]
    assert shared.json()["url"].endswith(f"?share={token}")

    public = client.get(f"/api/share/{token}")
    assert public.status_code == 200
    payload = public.json()["conversation"]
    assert payload["items"][0]["content"] == "conversacion compartida"
    assert payload["views"] >= 1

    assert (
        client.delete(
            f"/api/conversations/{conversation_id}/share", headers=headers
        ).status_code
        == 200
    )
    assert client.get(f"/api/share/{token}").status_code == 404


def test_attachment_upload_and_stream(client, monkeypatch):
    headers = auth("600000000000000022")
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    uploaded = client.post(
        "/api/attachments",
        files={"file": ("foto.png", png, "image/png")},
        headers=headers,
    )
    assert uploaded.status_code == 200
    attachment = uploaded.json()["attachment"]
    assert attachment["mime"] == "image/png"
    assert attachment["size"] == len(png)

    served = client.get(f"/api/attachments/{attachment['token']}")
    assert served.status_code == 200
    assert served.content == png

    monkeypatch.setattr(
        main, "stream_reply", lambda *a, **k: iter(["veo ", "la imagen"])
    )
    with client.stream(
        "POST",
        "/api/chat/stream",
        json={"message": "¿qué ves?", "attachment_token": attachment["token"]},
        headers=headers,
    ) as response:
        body = "".join(response.iter_text())
    assert "veo la imagen" in body
    assert "assistant_message_id" in body

    conversations = client.get("/api/conversations", headers=headers).json()[
        "conversations"
    ]
    conversation_id = conversations[0]["id"]
    detail = client.get(
        f"/api/conversations/{conversation_id}", headers=headers
    ).json()["conversation"]
    assert detail["items"][0]["attachment"]["token"] == attachment["token"]


def test_attachment_type_is_validated(client):
    headers = auth("600000000000000023")
    rejected = client.post(
        "/api/attachments",
        files={"file": ("nota.txt", b"hola", "text/plain")},
        headers=headers,
    )
    assert rejected.status_code == 400


def test_sessions_list_and_revoke(client, monkeypatch):
    monkeypatch.setattr(main, "_send_verification_email", lambda user: False)
    email = "sessions-flow@example.com"
    first = client.post(
        "/api/auth/register",
        json={"email": email, "password": "supersecret", "name": "Sesiones"},
    ).json()["token"]
    second = client.post(
        "/api/auth/login", json={"email": email, "password": "supersecret"}
    ).json()["token"]

    headers = {"Authorization": f"Bearer {first}"}
    listed = client.get("/api/auth/sessions", headers=headers)
    assert listed.status_code == 200
    sessions = listed.json()["sessions"]
    assert len(sessions) == 2
    current = [item for item in sessions if item["current"]]
    assert len(current) == 1

    other = next(item for item in sessions if not item["current"])
    revoked = client.delete(f"/api/auth/sessions/{other['sid']}", headers=headers)
    assert revoked.status_code == 200
    assert (
        client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {second}"}
        ).status_code
        == 401
    )


def test_account_export_contains_messages(client, monkeypatch):
    headers = auth("600000000000000024")
    monkeypatch.setattr(
        main, "generate_reply", lambda message, preferred_model=None, **_: "ok"
    )
    client.post(
        "/api/chat", json={"message": "dato exportable"}, headers=headers
    )
    exported = client.get("/api/account/export", headers=headers)
    assert exported.status_code == 200
    assert "dato exportable" in exported.text
    assert "attachment" in exported.headers.get("content-disposition", "")
