"""Pruebas de organización: carpetas, favoritos, búsqueda y edición de turnos."""

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
            "username": "organize-tester",
            "display_name": "Organize Tester",
            "email": None,
            "avatar_url": None,
        }
    )
    return {"Authorization": f"Bearer {token}"}


def test_folders_favorites_and_search(client, monkeypatch):
    headers = auth("600000000000000011")
    monkeypatch.setattr(
        main, "generate_reply", lambda message, preferred_model=None, **_: "ok"
    )
    created = client.post(
        "/api/chat", json={"message": "notas sobre ornitorrincos"}, headers=headers
    )
    assert created.status_code == 200
    conversation_id = created.json()["conversation_id"]

    folder = client.post("/api/folders", json={"name": "Trabajo"}, headers=headers)
    assert folder.status_code == 200
    folder_id = folder.json()["folder"]["id"]

    moved = client.put(
        f"/api/conversations/{conversation_id}/folder",
        json={"folder_id": folder_id},
        headers=headers,
    )
    assert moved.json()["folder_id"] == folder_id

    filtered = client.get(
        f"/api/conversations?folder_id={folder_id}", headers=headers
    ).json()["conversations"]
    assert [item["id"] for item in filtered] == [conversation_id]
    assert filtered[0]["folder_id"] == folder_id

    favorited = client.post(
        f"/api/conversations/{conversation_id}/favorite", headers=headers
    )
    assert favorited.json()["is_favorite"] is True
    favorites = client.get(
        "/api/conversations?favorite=true", headers=headers
    ).json()["conversations"]
    assert favorites[0]["is_favorite"] is True

    found = client.get(
        "/api/conversations?q=ornitorrincos", headers=headers
    ).json()["conversations"]
    assert found and found[0]["id"] == conversation_id
    assert found[0]["snippet"]

    assert client.delete(f"/api/folders/{folder_id}", headers=headers).status_code == 200
    after = client.get("/api/conversations", headers=headers).json()["conversations"]
    match = next(item for item in after if item["id"] == conversation_id)
    assert match["folder_id"] is None


def test_stream_edit_truncates_and_regenerate_replaces(client, monkeypatch):
    headers = auth("600000000000000012")
    monkeypatch.setattr(
        main, "generate_reply", lambda message, preferred_model=None, **_: "primera"
    )
    first = client.post(
        "/api/chat", json={"message": "hola uno"}, headers=headers
    ).json()
    conversation_id = first["conversation_id"]

    client.post(
        "/api/chat",
        json={"message": "hola dos", "conversation_id": conversation_id},
        headers=headers,
    )

    detail = client.get(
        f"/api/conversations/{conversation_id}", headers=headers
    ).json()["conversation"]
    first_user = detail["items"][0]
    assert first_user["role"] == "user"
    assert len(detail["items"]) == 4

    monkeypatch.setattr(
        main, "stream_reply", lambda *a, **k: iter(["nueva ", "respuesta"])
    )
    with client.stream(
        "POST",
        "/api/chat/stream",
        json={
            "message": "hola uno editado",
            "conversation_id": conversation_id,
            "edit_message_id": first_user["id"],
        },
        headers=headers,
    ) as response:
        body = "".join(response.iter_text())
    assert "nueva respuesta" in body

    edited = client.get(
        f"/api/conversations/{conversation_id}", headers=headers
    ).json()["conversation"]
    # Editar descarta la segunda pregunta y su respuesta.
    assert len(edited["items"]) == 2
    assert edited["items"][0]["content"] == "hola uno editado"
    assert edited["items"][1]["role"] == "assistant"

    monkeypatch.setattr(main, "stream_reply", lambda *a, **k: iter(["regenerada"]))
    with client.stream(
        "POST",
        "/api/chat/stream",
        json={
            "message": "hola uno editado",
            "conversation_id": conversation_id,
            "regenerate": True,
        },
        headers=headers,
    ) as response:
        assert response.status_code == 200
        "".join(response.iter_text())

    regenerated = client.get(
        f"/api/conversations/{conversation_id}", headers=headers
    ).json()["conversation"]
    assert len(regenerated["items"]) == 2
    assert regenerated["items"][1]["content"] == "regenerada"


def test_folder_requires_owner(client):
    owner = auth("600000000000000013")
    other = auth("600000000000000014")
    folder = client.post("/api/folders", json={"name": "Privada"}, headers=owner).json()
    folder_id = folder["folder"]["id"]

    listed = client.get("/api/folders", headers=other).json()["folders"]
    assert all(item["id"] != folder_id for item in listed)
    assert client.delete(f"/api/folders/{folder_id}", headers=other).status_code == 404
