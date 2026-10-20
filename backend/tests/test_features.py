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


def test_calculator_detection():
    assert tools.maybe_calculate("¿cuánto es 2 + 3 * 4?") == ("2 + 3 * 4", "14")
    assert tools.maybe_calculate("hola") is None


def test_memory_extraction():
    assert tools.extract_memory("recuerda que me llamo Sebas") == "me llamo Sebas"
    assert (
        tools.extract_memory("recuerda: prefiero respuestas cortas")
        == "prefiero respuestas cortas"
    )
    assert tools.extract_memory("hola") is None


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


def test_image_uses_free_engine_without_model(client, monkeypatch):
    class FakeImageResponse:
        status_code = 200
        headers = {"content-type": "image/jpeg"}
        content = b"\xff\xd8fakejpeg"

        def raise_for_status(self):
            return None

    captured = {}

    def fake_get(url, **kwargs):
        captured["url"] = url
        captured["params"] = kwargs.get("params")
        return FakeImageResponse()

    monkeypatch.setattr(main.httpx, "get", fake_get)
    response = client.post(
        "/api/image", json={"prompt": "un gato"}, headers=auth_header()
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mime_type"] == "image/jpeg"
    assert body["image"].startswith("data:image/jpeg;base64,")
    assert "image.pollinations.ai" in captured["url"]
    assert "un%20gato" in captured["url"]


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


def test_memory_lifecycle(client):
    headers = auth_header()
    created = client.post(
        "/api/memory", json={"content": "me llamo Sebas"}, headers=headers
    )
    assert created.status_code == 200
    memory_id = created.json()["id"]

    listed = client.get("/api/memory", headers=headers)
    assert listed.status_code == 200
    assert any(
        item["content"] == "me llamo Sebas"
        for item in listed.json()["memories"]
    )

    deleted = client.delete(f"/api/memory/{memory_id}", headers=headers)
    assert deleted.status_code == 200
    remaining = client.get("/api/memory", headers=headers).json()["memories"]
    assert all(item["id"] != memory_id for item in remaining)


def test_memory_is_saved_from_chat(client, monkeypatch):
    headers = auth_header()
    monkeypatch.setattr(main, "generate_reply", lambda message, **_: "ok")
    response = client.post(
        "/api/chat",
        json={"message": "recuerda que prefiero respuestas cortas"},
        headers=headers,
    )
    assert response.status_code == 200
    memories = client.get("/api/memory", headers=headers).json()["memories"]
    assert any("respuestas cortas" in item["content"] for item in memories)


def test_memory_and_date_are_injected(client, monkeypatch):
    headers = auth_header()
    client.post(
        "/api/memory", json={"content": "prefiero respuestas cortas"}, headers=headers
    )
    captured = {}

    def fake_reply(message, preferred_model=None, system_instruction=None, **kwargs):
        captured["system"] = system_instruction
        return "ok"

    monkeypatch.setattr(main, "generate_reply", fake_reply)
    response = client.post(
        "/api/chat", json={"message": "hola", "search": False}, headers=headers
    )
    assert response.status_code == 200
    assert "prefiero respuestas cortas" in captured["system"]
    assert "Fecha y hora actual" in captured["system"]


def test_web_search_injection(client, monkeypatch):
    headers = auth_header()
    monkeypatch.setattr(
        main.websearch,
        "context_for",
        lambda query: (
            "Resultados de prueba sobre " + query,
            [{"title": "Fuente", "url": "https://example.com"}],
        ),
    )
    monkeypatch.setattr(main, "generate_reply", lambda message, **_: "ok")
    response = client.post(
        "/api/chat",
        json={"message": "busca algo", "search": True},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["web_sources"][0]["url"] == "https://example.com"


def test_study_summary(client, monkeypatch):
    headers = auth_header()
    monkeypatch.setattr(
        main.llm,
        "complete_text",
        lambda *args, **kwargs: "Resumen de prueba con conceptos clave.",
    )
    response = client.post(
        "/api/study",
        json={"kind": "summary", "text": "Material de estudio " * 5},
        headers=headers,
    )
    assert response.status_code == 200
    assert "Resumen" in response.json()["summary"]


def test_study_flashcards_parses_json(client, monkeypatch):
    headers = auth_header()
    monkeypatch.setattr(
        main.llm,
        "complete_text",
        lambda *args, **kwargs: (
            '```json\n[{"front": "¿Qué es Core IA?", "back": "Un asistente."}]\n```'
        ),
    )
    response = client.post(
        "/api/study",
        json={"kind": "flashcards", "text": "Material de estudio " * 5},
        headers=headers,
    )
    assert response.status_code == 200
    cards = response.json()["cards"]
    assert cards[0]["front"] == "¿Qué es Core IA?"
    assert cards[0]["back"] == "Un asistente."


def test_study_quiz_parses_json(client, monkeypatch):
    headers = auth_header()
    monkeypatch.setattr(
        main.llm,
        "complete_text",
        lambda *args, **kwargs: (
            '[{"question": "2 + 2", "options": ["3", "4", "5"], '
            '"answer": 1, "explanation": "Cuatro."}]'
        ),
    )
    response = client.post(
        "/api/study",
        json={"kind": "quiz", "text": "Material de estudio " * 5},
        headers=headers,
    )
    assert response.status_code == 200
    question = response.json()["questions"][0]
    assert question["answer"] == 1
    assert question["options"][1] == "4"


def test_study_rejects_short_material(client):
    response = client.post(
        "/api/study",
        json={"kind": "summary", "text": "muy corto"},
        headers=auth_header(),
    )
    assert response.status_code == 400


def test_generate_reply_falls_back_to_gemini(monkeypatch):
    monkeypatch.setattr(main.llm, "available", lambda: True)

    def boom(*args, **kwargs):
        raise RuntimeError("402")

    monkeypatch.setattr(main.llm, "complete_text", boom)
    monkeypatch.setattr(main, "genai_client", object())
    monkeypatch.setattr(main, "_generate_with_gemini", lambda *a, **k: "respaldo")
    assert main.generate_reply("hola") == "respaldo"


def test_ocr_text_is_used_without_vision(client, monkeypatch):
    headers = auth_header()
    captured = {}

    def fake_stream(message, **kwargs):
        captured["message"] = message
        captured["attachment"] = kwargs.get("attachment")
        yield "ok"

    monkeypatch.setattr(main, "stream_reply", fake_stream)
    response = client.post(
        "/api/chat/stream",
        json={"message": "¿Qué dice la imagen?", "attachment_text": "HOLA MUNDO"},
        headers=headers,
    )
    assert response.status_code == 200
    assert "HOLA MUNDO" in captured["message"]
    assert captured["attachment"] is None
