"""Búsqueda web gratuita (DuckDuckGo) y lectura de páginas (Jina Reader).

No requiere clave ni registro. Se usa para responder con información actual
cuando el usuario pide buscar algo o comparte una URL.
"""

from __future__ import annotations

import html as html_lib
import re
import urllib.parse

import httpx

SEARCH_URL = "https://html.duckduckgo.com/html/"
READER_URL = "https://r.jina.ai/"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124 Safari/537.36 CoreIA/1.0"
)
MAX_RESULTS = 5
MAX_PAGE_CHARS = 5000

URL_RE = re.compile(r"https?://[^\s<>\"')]+", re.I)
TAG_RE = re.compile(r"<[^>]+>")

# Frases que indican que hace falta información actual. Se evitan palabras
# sueltas como "hoy" para no buscar en mensajes personales.
SEARCH_PATTERNS = (
    r"\bbusca(r|me)?\b",
    r"\bnoticias?\b",
    r"\bactualidad\b",
    r"\b[uú]ltima hora\b",
    r"\bprecios? (de|del)\b",
    r"\bcotizaci[oó]n\b",
    r"\bclima\b",
    r"\btiempo en\b",
    r"\bqui[eé]n (gan[oó]|fue)\b",
    r"\bqu[eé] pas[oó] (hoy|ayer)\b",
    r"\bresultados? (de|del)\b",
    r"\bpartido de\b",
    r"\bestreno\b",
    r"\bdocumentaci[oó]n\b",
    r"\b[uú]ltima versi[oó]n\b",
    r"\bcomparativa\b",
    r"\bcu[aá]ndo (sale|se estrena|fue)\b",
    r"\binvestiga\b",
)
SEARCH_RE = re.compile("|".join(SEARCH_PATTERNS), re.I)


def is_search_request(message: str) -> bool:
    """¿El mensaje pide información actual o incluye una URL?"""
    return bool(URL_RE.search(message) or SEARCH_RE.search(message))


def _clean(fragment: str) -> str:
    text = TAG_RE.sub(" ", fragment)
    return re.sub(r"\s+", " ", html_lib.unescape(text)).strip()


def _real_url(href: str) -> str:
    href = html_lib.unescape(href)
    if "uddg=" in href:
        href = urllib.parse.unquote(href.split("uddg=", 1)[1].split("&", 1)[0])
    if href.startswith("//"):
        href = "https:" + href
    return href


def _parse_results(html: str, limit: int) -> list[dict[str, str]]:
    """Extrae título, URL y resumen de la página HTML de DuckDuckGo."""
    titles: list[tuple[str, str]] = []
    for match in re.finditer(r"<a([^>]*)>(.*?)</a>", html, re.S):
        attrs, inner = match.groups()
        if "result__a" not in attrs:
            continue
        href = re.search(r'href="([^"]+)"', attrs)
        if href:
            titles.append((_real_url(href.group(1)), _clean(inner)))

    snippets = [
        _clean(match.group(1))
        for match in re.finditer(
            r'<(?:a|div)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</(?:a|div)>',
            html,
            re.S,
        )
    ]

    results: list[dict[str, str]] = []
    for index, (url, title) in enumerate(titles[:limit]):
        results.append(
            {
                "title": title[:200] or url,
                "url": url,
                "snippet": (snippets[index] if index < len(snippets) else "")[:400],
            }
        )
    return results


def search(query: str, limit: int = MAX_RESULTS) -> list[dict[str, str]]:
    """Busca en DuckDuckGo sin API key. Devuelve [] si algo falla."""
    try:
        response = httpx.get(
            SEARCH_URL,
            params={"q": query},
            headers={"User-Agent": USER_AGENT},
            timeout=25,
            follow_redirects=True,
        )
        response.raise_for_status()
    except Exception:  # noqa: BLE001 - la búsqueda es opcional
        return []
    return _parse_results(response.text, limit)


def read_page(url: str, max_chars: int = MAX_PAGE_CHARS) -> str:
    """Lee una página con Jina Reader y, si falla, con una descarga directa."""
    try:
        response = httpx.get(
            f"{READER_URL}{url}",
            headers={"User-Agent": USER_AGENT},
            timeout=30,
            follow_redirects=True,
        )
        if response.status_code < 400 and response.text.strip():
            return response.text.strip()[:max_chars]
    except Exception:  # noqa: BLE001 - se intenta la descarga directa
        pass

    try:
        response = httpx.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=20,
            follow_redirects=True,
        )
        response.raise_for_status()
        body = re.sub(
            r"(?is)<(script|style|nav|footer|header|noscript)[^>]*>.*?</\1>",
            " ",
            response.text,
        )
        text = re.sub(r"\s+", " ", html_lib.unescape(TAG_RE.sub(" ", body)))
        return text.strip()[:max_chars]
    except Exception:  # noqa: BLE001 - página inaccesible
        return ""


def context_for(query: str) -> tuple[str, list[dict[str, str]]]:
    """Devuelve el contexto para el modelo y la lista de fuentes.

    Si el mensaje contiene una URL se lee esa página; si no, se buscan los
    primeros resultados y se usa su título y resumen.
    """
    urls = URL_RE.findall(query)
    if urls:
        url = urls[0].rstrip(".,;:!?)]}")
        page = read_page(url)
        if page:
            return f"[Contenido de {url}]\n{page}", [{"title": url, "url": url}]

    results = search(query)
    if not results:
        return "", []

    lines = []
    for index, item in enumerate(results, 1):
        lines.append(
            f"{index}. {item['title']}\n"
            f"   URL: {item['url']}\n"
            f"   {item['snippet']}"
        )
    return "Resultados de búsqueda web:\n" + "\n".join(lines), [
        {"title": item["title"], "url": item["url"]} for item in results
    ]
