"""Capa de caché opcional basada en Redis.

Si no se define `REDIS_URL`, todas las operaciones son no-ops y la
aplicación sigue funcionando con almacenamiento en memoria.
"""

import json
from typing import Any

from config import settings

_redis = None

if settings.redis_url:
    try:
        import redis

        _redis = redis.from_url(settings.redis_url, decode_responses=True)
        _redis.ping()
    except Exception:  # noqa: BLE001 - la caché nunca debe tumbar la app
        _redis = None


def is_enabled() -> bool:
    return _redis is not None


def cache_get(key: str) -> Any | None:
    """Devuelve el valor cacheado o None."""
    if _redis is None:
        return None
    try:
        raw = _redis.get(key)
        return json.loads(raw) if raw is not None else None
    except Exception:  # noqa: BLE001
        return None


def cache_set(key: str, value: Any, ttl: int = 300) -> None:
    """Guarda un valor serializable en caché con TTL en segundos."""
    if _redis is None:
        return
    try:
        _redis.set(key, json.dumps(value), ex=ttl)
    except Exception:  # noqa: BLE001
        pass


def cache_delete(key: str) -> None:
    if _redis is None:
        return
    try:
        _redis.delete(key)
    except Exception:  # noqa: BLE001
        pass
