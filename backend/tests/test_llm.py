"""Pruebas del motor propio (compatible con OpenAI) sin llamadas de red."""

from types import SimpleNamespace

import llm
from config import settings


class FakeResponse:
    """Respuesta SSE falsa para probar el parser."""

    status_code = 200

    def __init__(self, lines: list[str]) -> None:
        self._lines = lines

    def iter_lines(self):
        return iter(self._lines)

    def read(self) -> bytes:
        return b""

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _clear_providers(monkeypatch) -> None:
    monkeypatch.setattr(settings, "llm_provider", "auto")
    for attr in (
        "groq_api_key",
        "openrouter_api_key",
        "cerebras_api_key",
        "cloudflare_api_token",
        "cloudflare_account_id",
        "llm_base_url",
        "llm_api_key",
        "llm_model",
        "llm_vision_model",
    ):
        monkeypatch.setattr(settings, attr, "")


def test_auto_falls_back_to_free_engine(monkeypatch):
    _clear_providers(monkeypatch)
    cfg = llm.resolve()
    assert cfg is not None
    assert cfg["provider"] == "pollinations"
    assert cfg["api_key"] == ""
    assert cfg["model"] == "openai-fast"
    assert llm.available() is True
    assert llm.provider_name() == "pollinations"


def test_stream_parses_openai_sse(monkeypatch):
    _clear_providers(monkeypatch)
    monkeypatch.setattr(settings, "llm_provider", "groq")
    monkeypatch.setattr(settings, "llm_api_key", "test")
    monkeypatch.setattr(settings, "llm_model", "demo-model")

    captured: dict = {}

    def fake_stream(method, url, **kwargs):
        captured["url"] = url
        captured["json"] = kwargs["json"]
        return FakeResponse(
            [
                'data: {"choices":[{"delta":{"content":"Ho"}}]}',
                "",
                'data: {"choices":[{"delta":{"content":"la"}}]}',
                "data: [DONE]",
            ]
        )

    monkeypatch.setattr(llm.httpx, "stream", fake_stream)
    result = "".join(
        llm.stream_text("hola", system_instruction="sistema", temperature=0.2)
    )

    assert result == "Hola"
    assert captured["url"].endswith("/chat/completions")
    assert captured["json"]["model"] == "demo-model"
    assert captured["json"]["stream"] is True
    assert captured["json"]["messages"][0] == {
        "role": "system",
        "content": "sistema",
    }


def test_explicit_provider_reads_its_own_key(monkeypatch):
    _clear_providers(monkeypatch)
    monkeypatch.setattr(settings, "llm_provider", "openrouter")
    monkeypatch.setattr(settings, "openrouter_api_key", "sk-test")
    cfg = llm.resolve()
    assert cfg is not None
    assert cfg["provider"] == "openrouter"
    assert cfg["api_key"] == "sk-test"


def test_pollinations_needs_no_key(monkeypatch):
    _clear_providers(monkeypatch)
    monkeypatch.setattr(settings, "llm_provider", "pollinations")
    cfg = llm.resolve()
    assert cfg is not None
    assert cfg["provider"] == "pollinations"
    assert cfg["base_url"] == "https://text.pollinations.ai/openai"
    assert cfg["model"] == "openai-fast"


def test_provider_accepts_custom_base_url(monkeypatch):
    _clear_providers(monkeypatch)
    monkeypatch.setattr(settings, "llm_provider", "custom")
    monkeypatch.setattr(settings, "llm_base_url", "http://127.0.0.1:11434/v1")
    monkeypatch.setattr(settings, "llm_api_key", "")
    cfg = llm.resolve()
    assert cfg is not None
    assert cfg["provider"] == "custom"
    assert cfg["base_url"] == "http://127.0.0.1:11434/v1"


def test_image_without_vision_adds_note():
    attachment = SimpleNamespace(mime="image/png", data=b"x", filename="foto.png")
    messages = llm.build_messages("mira", attachment=attachment, use_vision=False)
    content = messages[-1]["content"]
    assert "mira" in content
    assert "no admite visión" in content


def test_pdf_without_readable_text_adds_note():
    attachment = SimpleNamespace(
        mime="application/pdf", data=b"no es un pdf", filename="roto.pdf"
    )
    messages = llm.build_messages("resume", attachment=attachment)
    content = messages[-1]["content"]
    assert "resume" in content
    assert "no se pudo leer" in content
