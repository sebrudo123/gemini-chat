"""Pruebas de la búsqueda web gratuita (sin llamadas de red)."""

import websearch

HTML = """
<html><body>
<a rel="nofollow" class="result__a"
   href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnoticia&amp;rut=abc">
  Noticia de <b>ejemplo</b>
</a>
<a class="result__snippet" href="#">Un resumen &amp; relevante.</a>
<a class="result__a" href="https://second.example/">Segunda noticia</a>
</body></html>
"""


def test_parse_results():
    results = websearch._parse_results(HTML, 5)
    assert results[0]["url"] == "https://example.com/noticia"
    assert results[0]["title"] == "Noticia de ejemplo"
    assert "resumen & relevante" in results[0]["snippet"]
    assert results[1]["url"] == "https://second.example/"


def test_is_search_request():
    assert websearch.is_search_request("busca noticias de hoy")
    assert websearch.is_search_request("resume https://example.com")
    assert not websearch.is_search_request("escribe una función en Python")
    assert not websearch.is_search_request("¿quién eres?")


def test_context_for_reads_url(monkeypatch):
    monkeypatch.setattr(websearch, "read_page", lambda url: "Contenido de prueba")
    context, sources = websearch.context_for("resume https://example.com")
    assert "Contenido de prueba" in context
    assert sources == [{"title": "https://example.com", "url": "https://example.com"}]


def test_context_for_search(monkeypatch):
    monkeypatch.setattr(
        websearch,
        "search",
        lambda query: [{"title": "A", "url": "https://a", "snippet": "B"}],
    )
    context, sources = websearch.context_for("busca algo")
    assert "https://a" in context
    assert sources[0]["title"] == "A"
