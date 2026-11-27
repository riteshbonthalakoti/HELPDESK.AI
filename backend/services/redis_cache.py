"""Redis cache for AI inference (classification + embeddings)."""

from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

CLASSIFICATION_PREFIX = "helpdesk:cls:"
EMBEDDING_PREFIX = "helpdesk:emb:"
DEFAULT_TTL_SECONDS = 3600


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _parse_ttl_seconds(value: str | None) -> int:
    try:
        ttl = int((value or "").strip() or DEFAULT_TTL_SECONDS)
    except ValueError:
        return DEFAULT_TTL_SECONDS
    return ttl if ttl > 0 else DEFAULT_TTL_SECONDS


def _text_key(prefix: str, text: str) -> str:
    """
    Computes an MD5 hash of the given text for use as a cache key.

    Raises:
        ValueError: If the input text is empty, only whitespace, or not a string.
    """
    if text is None or not isinstance(text, str):
        raise ValueError("Text must be a non-None string.")
    if not text.strip():
        raise ValueError("Text cannot be empty or whitespace.")
    digest = hashlib.md5(text.strip().lower().encode("utf-8")).hexdigest()
    return f"{prefix}{digest}"


class RedisInferenceCache:
    """Optional Redis layer for DistilBERT classifications and ST embeddings."""

    def __init__(self) -> None:
        self._client: Any | None = None
        self.enabled = _truthy(os.getenv("USE_REDIS_CACHE"))
        self.allow_degraded = _truthy(os.getenv("ALLOW_DEGRADED_STARTUP"))
        self.ttl_seconds = _parse_ttl_seconds(os.getenv("REDIS_CACHE_TTL_SECONDS"))

    @property
    def available(self) -> bool:
        return self.enabled and self._client is not None

    def connect(self) -> None:
        if not self.enabled:
            logger.info("[RedisCache] Disabled (USE_REDIS_CACHE=false)")
            return

        try:
            import redis

            url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
            client = redis.from_url(url, decode_responses=True, socket_connect_timeout=2)
            client.ping()
            self._client = client
            logger.info("[RedisCache] Connected")
        except Exception as error:
            self._client = None
            message = f"[RedisCache] Unavailable: {error}"
            if self.allow_degraded:
                logger.warning("%s — bypassing cache", message)
            else:
                raise RuntimeError(message) from error

    def get_classification(self, text: str) -> dict | None:
        """
        Retrieve a cached classification result for the given text.
        Handles empty text gracefully by returning None.
        """
        if not self.available:
            return None

        try:
            cache_key = _text_key(CLASSIFICATION_PREFIX, text)
        except ValueError as err:
            logger.warning("[RedisCache] %s", err)
            return None

        try:
            raw = self._client.get(cache_key)
            return json.loads(raw) if raw else None
        except Exception as error:
            logger.warning("[RedisCache] classification get failed: %s", error)
            return None

    def set_classification(self, text: str, payload: dict) -> None:
        """
        Cache a classification result for the given text.
        Handles empty text gracefully by returning early.
        """
        if not self.available:
            return

        try:
            cache_key = _text_key(CLASSIFICATION_PREFIX, text)
        except ValueError as err:
            logger.warning("[RedisCache] %s", err)
            return

        try:
            self._client.setex(
                cache_key,
                self.ttl_seconds,
                json.dumps(payload),
            )
        except Exception as error:
            logger.warning("[RedisCache] classification set failed: %s", error)

    def get_embedding(self, text: str) -> list[float] | None:
        """
        Retrieve a cached embedding for the given text.
        Handles empty text gracefully by returning None.
        """
        if not self.available:
            return None

        try:
            cache_key = _text_key(EMBEDDING_PREFIX, text)
        except ValueError as err:
            logger.warning("[RedisCache] %s", err)
            return None

        try:
            raw = self._client.get(cache_key)
            if not raw:
                return None
            values = json.loads(raw)
            return [float(v) for v in values]
        except Exception as error:
            logger.warning("[RedisCache] embedding get failed: %s", error)
            return None

    def set_embedding(self, text: str, embedding: list[float]) -> None:
        """
        Cache an embedding for the given text.
        Handles empty text gracefully by returning early.
        """
        if not self.available:
            return

        try:
            cache_key = _text_key(EMBEDDING_PREFIX, text)
        except ValueError as err:
            logger.warning("[RedisCache] %s", err)
            return

        try:
            self._client.setex(
                cache_key,
                self.ttl_seconds,
                json.dumps(embedding),
            )
        except Exception as error:
            logger.warning("[RedisCache] embedding set failed: %s", error)

    def get_json(self, key: str) -> Any | None:
        """Retrieve a cached generic JSON payload."""
        if not self.available:
            return None
        try:
            raw = self._client.get(key)
            return json.loads(raw) if raw else None
        except Exception as error:
            logger.warning("[RedisCache] get_json failed for %s: %s", key, error)
            return None

    def set_json(self, key: str, payload: Any, ttl: int | None = None) -> None:
        """Cache a generic JSON payload."""
        if not self.available:
            return
        try:
            self._client.setex(
                key,
                ttl or self.ttl_seconds,
                json.dumps(payload),
            )
        except Exception as error:
            logger.warning("[RedisCache] set_json failed for %s: %s", key, error)

    def delete_by_pattern(self, pattern: str) -> int:
        """Delete every key matching a glob pattern. Returns the count deleted."""
        if not self.available:
            return 0
        try:
            keys = list(self._client.scan_iter(match=pattern))
            if keys:
                self._client.delete(*keys)
            return len(keys)
        except Exception as error:
            logger.warning(
                "[RedisCache] delete_by_pattern failed for %s: %s", pattern, error
            )
            return 0


redis_cache = RedisInferenceCache()
