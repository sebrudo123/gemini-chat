"""Módulo RAG (Retrieval-Augmented Generation) de Core IA.

Implementa una búsqueda semántica simple sin necesidad de extensión vectorial
en la base de datos: los embeddings se generan con `gemini-embedding-001` y se
almacenan como JSON; la similitud se calcula en Python (coseno).
"""

import json
import math

from google import genai

from config import settings

_client = genai.Client(api_key=settings.ai_api_key) if settings.ai_api_key else None

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150


def split_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Divide un texto en fragmentos con solapamiento."""
    text = " ".join(text.split())
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + size
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start = end - overlap
    return chunks


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Genera embeddings para una lista de textos."""
    if _client is None:
        raise RuntimeError("AI_API_KEY no configurada para embeddings.")
    response = _client.models.embed_content(model=settings.embedding_model, contents=texts)
    return [list(embedding.values) for embedding in response.embeddings]


def embed_text(text: str) -> list[float]:
    """Genera el embedding de un único texto."""
    return embed_texts([text])[0]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Similitud coseno entre dos vectores."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def encode_embedding(vector: list[float]) -> str:
    """Serializa un embedding para almacenarlo en la base de datos."""
    return json.dumps(vector)


def decode_embedding(payload: str) -> list[float]:
    """Recupera un embedding almacenado."""
    try:
        return json.loads(payload)
    except (TypeError, ValueError):
        return []


def rank_chunks(query: str, chunks: list[tuple[int, str, str]], top_k: int) -> list[str]:
    """Devuelve los `top_k` fragmentos más similares a la consulta.

    Args:
        query: Texto de la consulta del usuario.
        chunks: Lista de tuplas (id, contenido, embedding_serializado).
        top_k: Número de fragmentos a devolver.
    """
    if not chunks:
        return []
    query_vector = embed_text(query)
    scored: list[tuple[float, str]] = []
    for _, content, stored in chunks:
        score = cosine_similarity(query_vector, decode_embedding(stored))
        scored.append((score, content))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [content for _, content in scored[:top_k]]
