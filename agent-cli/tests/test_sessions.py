"""Pruebas del almacén de sesiones local."""

from coreia_agent.sessions import SessionStore, default_title, new_session


def test_session_roundtrip(tmp_path):
    store = SessionStore(tmp_path)
    session = new_session("Prueba")
    session["messages"].append({"role": "user", "content": "hola"})
    store.save(session)

    loaded = store.load(session["id"])
    assert loaded["title"] == "Prueba"
    assert loaded["messages"][0]["content"] == "hola"

    listed = store.list()
    assert len(listed) == 1
    assert listed[0]["id"] == session["id"]
    assert listed[0]["messages"] == 1


def test_delete_session(tmp_path):
    store = SessionStore(tmp_path)
    session = new_session()
    store.save(session)
    assert store.delete(session["id"]) is True
    assert store.delete(session["id"]) is False
    assert store.list() == []


def test_ignores_corrupted_files(tmp_path):
    store = SessionStore(tmp_path)
    (tmp_path / "rota.json").write_text("{no es json", encoding="utf-8")
    assert store.list() == []


def test_default_title_collapses_whitespace():
    assert default_title("  crea   una API  ") == "crea una API"
    assert len(default_title("x" * 100)) == 49
