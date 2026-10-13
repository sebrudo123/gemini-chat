"""Pruebas de las funciones de la sección 6: herramientas, RAG e imágenes."""

import pytest
from fastapi.testclient import TestClient

import main
import rag
import tools


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as test_client:
        yield test_client


def auth_header(monkeypatch=None) -> dict[str, str]:
    token = main.create_session_token(
        {
            "id": "888888888888888888",
            "username": "feature-tester",
            "display_name": "Feature Tester",
            "email": None,
            "avatar_url": None,
        }
    )
    return {"Authorization": f"Bearer {token}"}


def test_calculate_tools():
    assert tools.calculate("2 * (3 + 4)") == "14"
    assert tools.calculate("2 ** 5") == "32"
    assert tools.calculate("10 / 4") == "2.5"
    assert "Error" in tools.calculate("__import__('os')")


def test_other_tools():
    assert "palabras" in tools.get_word_count("hola mundo")
    assert "T" in tools.get_current_time()


def test_split_text_overlap():
    text = " ".join(str(i) for i in range(500))
    chunks = rag.split_text(text, size=100, overlap=20)
    assert len(chunks) > 1
    assert rag.split_text("") == []


def test_cosine_similarity():
    assert rag.cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert rag.cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)


def test_embedding_roundtrip():
    vector = [0.1, 0.2, 0.3]
    assert rag.decode_embedding(rag.encode_embedding(vector)) == vector


def test_image_disabled_without_model(client):
    response = client.post(
        "/api/image", json={"prompt": "un gato"}, headers=auth_header()
    )
    assert response.status_code == 503


def test_rag_document_lifecycle(client, monkeypatch):
    monkeypatch.setattr(rag, "embed_texts", lambda texts: [[0.1, 0.2] for _ in texts])
    monkeypatch.setattr(rag, "embed_text", lambda text: [0.1, 0.2])

    created = client.post(
        "/api/rag/documents",
        json={"title": "Manual", "text": "Core IA es un asistente con RAG."},
        headers=auth_header(),
    )
    assert created.status_code == 200
    body = created.json()
    assert body["title"] == "Manual"
    assert body["chunks"] >= 1

    listed = client.get("/api/rag/documents", headers=auth_header())
    assert listed.status_code == 200
    ids = [doc["id"] for doc in listed.json()["documents"]]
    assert body["id"] in ids

    deleted = client.delete(f"/api/rag/documents/{body['id']}", headers=auth_header())
    assert deleted.status_code == 200

    missing = client.delete(f"/api/rag/documents/{body['id']}", headers=auth_header())
    assert missing.status_code == 404


def test_rag_documents_requires_auth(client):
    assert client.get("/api/rag/documents").status_code == 401
    assert client.post("/api/rag/documents", json={"text": "x"}).status_code == 401
