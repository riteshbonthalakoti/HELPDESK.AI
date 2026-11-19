"""In-memory idempotency and sliding-window protection for ticket ingestion."""

from __future__ import annotations

import asyncio
import hashlib
import math
import time
from collections import deque
from dataclasses import dataclass
from typing import Callable

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


@dataclass
class _CachedResponse:
    expires_at: float
    fingerprint: bytes
    headers: list[tuple[bytes, bytes]]
    body: bytes


@dataclass
class _LockState:
    lock: asyncio.Lock
    users: int = 0


class TicketIngestionMiddleware:
    """Protect ticket creation endpoints with in-memory request controls.

    Idempotency is scoped by client IP, request path, and Idempotency-Key.

    A repeated key with the same request body returns the original ticket
    with HTTP 200. Reusing a key with a different body returns HTTP 409.

    Successful responses are cached for the configured TTL. Requests
    without an idempotency key remain subject to rate limiting.
    """

    DEFAULT_PATHS = frozenset({"/tickets", "/api/tickets"})

    PERIOD_SECONDS = {
        "second": 1,
        "minute": 60,
        "hour": 3600,
        "day": 86400,
    }

    EXCLUDED_RESPONSE_HEADERS = frozenset(
        {
            b"content-length",
            b"date",
            b"set-cookie",
            b"transfer-encoding",
            b"connection",
            b"keep-alive",
            b"x-request-id",
        }
    )

    def __init__(
        self,
        app: ASGIApp,
        *,
        max_requests: int | None = None,
        window_seconds: int | None = None,
        idempotency_ttl: int = 300,
        paths: frozenset[str] | None = None,
        clock: Callable[[], float] = time.monotonic,
        max_cached_response_bytes: int = 1_048_576,
        max_idempotency_request_bytes: int = 10 * 1024 * 1024,
    ) -> None:
        configured_requests, configured_window = (
            self._load_default_rate_limit()
        )

        if max_requests is None:
            max_requests = configured_requests

        if window_seconds is None:
            window_seconds = configured_window

        if max_requests < 1:
            raise ValueError("max_requests must be positive")

        if window_seconds < 1:
            raise ValueError("window_seconds must be positive")

        if idempotency_ttl < 1:
            raise ValueError("idempotency_ttl must be positive")

        if max_cached_response_bytes < 1:
            raise ValueError(
                "max_cached_response_bytes must be positive"
            )

        if max_idempotency_request_bytes < 1:
            raise ValueError(
                "max_idempotency_request_bytes must be positive"
            )

        self.app = app
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.idempotency_ttl = idempotency_ttl
        self.paths = (
            paths if paths is not None else self.DEFAULT_PATHS
        )
        self.clock = clock

        self.max_cached_response_bytes = max_cached_response_bytes
        self.max_idempotency_request_bytes = (
            max_idempotency_request_bytes
        )

        self._rate_windows: dict[str, deque[float]] = {}

        self._idempotency_cache: dict[
            tuple[str, str, bytes], _CachedResponse
        ] = {}

        self._idempotency_locks: dict[
            tuple[str, str, bytes], _LockState
        ] = {}

        self._cleanup_counter = 0

    @classmethod
    def _load_default_rate_limit(cls) -> tuple[int, int]:
        """Read the existing ticket rate-limit configuration."""

        from backend.services import rate_limit_config

        configured_limit = rate_limit_config.RATE_LIMIT_TICKETS
        match = rate_limit_config.LIMIT_REGEX.fullmatch(
            configured_limit
        )

        if match is None:
            raise ValueError(
                f"Invalid ticket rate-limit configuration: "
                f"{configured_limit!r}"
            )

        count = int(match.group("count"))
        period = configured_limit.rsplit("/", 1)[1]

        window_seconds = cls.PERIOD_SECONDS.get(period)

        if count < 1 or window_seconds is None:
            raise ValueError(
                f"Unsupported ticket rate limit: {configured_limit!r}"
            )

        return count, window_seconds

    def _consume_rate_limit(self, client_ip: str) -> int | None:
        """Consume one request slot or return Retry-After seconds."""

        now = self.clock()
        events = self._rate_windows.setdefault(
            client_ip, deque()
        )

        while (
            events
            and now - events[0] >= self.window_seconds
        ):
            events.popleft()

        if len(events) >= self.max_requests:
            return max(
                1,
                math.ceil(
                    self.window_seconds - (now - events[0])
                ),
            )

        events.append(now)
        return None

    async def _send_rate_limit_response(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        retry_after: int,
    ) -> None:
        response = JSONResponse(
            status_code=429,
            content={
                "detail": "Ticket ingestion rate limit exceeded."
            },
            headers={"Retry-After": str(retry_after)},
        )

        await response(scope, receive, send)

    async def _buffer_request_body(
        self,
        receive: Receive,
    ) -> tuple[bytes, Receive, bool]:
        """Read a bounded request body and provide a replayable receive."""

        messages = deque()
        body = bytearray()
        complete = False
        within_limit = True

        while True:
            message = await receive()
            messages.append(message)

            if message["type"] == "http.disconnect":
                break

            if message["type"] != "http.request":
                continue

            chunk = message.get("body", b"")

            if (
                len(body) + len(chunk)
                > self.max_idempotency_request_bytes
            ):
                within_limit = False
                break

            body.extend(chunk)

            if not message.get("more_body", False):
                complete = True
                break

        async def replay_receive():
            if messages:
                return messages.popleft()

            return await receive()

        return bytes(body), replay_receive, complete and within_limit

    def _cleanup_expired_entries(self, now: float) -> None:
        """Remove expired cached responses and inactive IP windows."""

        expired_keys = [
            key
            for key, value in self._idempotency_cache.items()
            if value.expires_at <= now
        ]

        for key in expired_keys:
            self._idempotency_cache.pop(key, None)

        inactive_ips = []

        for ip, events in self._rate_windows.items():
            while (
                events
                and now - events[0] >= self.window_seconds
            ):
                events.popleft()

            if not events:
                inactive_ips.append(ip)

        for ip in inactive_ips:
            self._rate_windows.pop(ip, None)

    async def _send_cached_response(
        self,
        cached: _CachedResponse,
        send: Send,
    ) -> None:
        """Replay a cached successful ticket response using HTTP 200."""

        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": cached.headers,
            }
        )

        await send(
            {
                "type": "http.response.body",
                "body": cached.body,
                "more_body": False,
            }
        )

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or scope["path"] not in self.paths
        ):
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        client_ip = str(client[0]) if client else "unknown"

        self._cleanup_counter += 1

        if self._cleanup_counter >= 128:
            self._cleanup_expired_entries(self.clock())
            self._cleanup_counter = 0

        request_headers = scope.get("headers", [])

        key_headers = [
            value
            for name, value in request_headers
            if name.lower() == b"idempotency-key"
        ]

        # Requests without an idempotency key are still rate-limited.
        if not key_headers:
            retry_after = self._consume_rate_limit(client_ip)

            if retry_after is not None:
                await self._send_rate_limit_response(
                    scope, receive, send, retry_after
                )
                return

            await self.app(scope, receive, send)
            return

        if len(key_headers) != 1:
            response = JSONResponse(
                status_code=400,
                content={
                    "detail": "Multiple Idempotency-Key headers are not allowed."
                },
            )
            await response(scope, receive, send)
            return

        idempotency_key = key_headers[0].strip()

        if not idempotency_key:
            response = JSONResponse(
                status_code=400,
                content={"detail": "Idempotency-Key cannot be empty."},
            )
            await response(scope, receive, send)
            return

        if len(idempotency_key) > 255:
            response = JSONResponse(
                status_code=400,
                content={"detail": "Idempotency-Key is too long."},
            )
            await response(scope, receive, send)
            return

        body, replay_receive, body_complete = (
            await self._buffer_request_body(receive)
        )

        # Oversized or incomplete requests bypass idempotency processing.
        # They still use the normal IP-based rate limit.
        if not body_complete:
            retry_after = self._consume_rate_limit(client_ip)

            if retry_after is not None:
                await self._send_rate_limit_response(
                    scope, replay_receive, send, retry_after
                )
                return

            await self.app(scope, replay_receive, send)
            return

        fingerprint = hashlib.sha256(body).digest()

        # Scope cache and lock identity to client, route, and key.
        cache_key = (client_ip, scope["path"], idempotency_key)

        lock_state = self._idempotency_locks.get(cache_key)

        if lock_state is None:
            lock_state = _LockState(lock=asyncio.Lock())
            self._idempotency_locks[cache_key] = lock_state

        lock_state.users += 1

        try:
            async with lock_state.lock:
                cached = self._idempotency_cache.get(cache_key)
                now = self.clock()

                if cached is not None and cached.expires_at <= now:
                    self._idempotency_cache.pop(cache_key, None)
                    cached = None

                if cached is not None:
                    # Exact retries receive the cached response without
                    # consuming another rate-limit slot.
                    if cached.fingerprint == fingerprint:
                        await self._send_cached_response(
                            cached, send
                        )
                        return

                    # Reusing a key with a different payload is a conflict.
                    retry_after = self._consume_rate_limit(client_ip)

                    if retry_after is not None:
                        await self._send_rate_limit_response(
                            scope, replay_receive, send, retry_after
                        )
                        return

                    response = JSONResponse(
                        status_code=409,
                        content={
                            "detail": (
                                "Idempotency-Key was already used "
                                "with a different request payload."
                            )
                        },
                    )

                    await response(scope, replay_receive, send)
                    return

                retry_after = self._consume_rate_limit(client_ip)

                if retry_after is not None:
                    await self._send_rate_limit_response(
                        scope, replay_receive, send, retry_after
                    )
                    return

                response_status: int | None = None
                response_headers: list[tuple[bytes, bytes]] = []
                response_body = bytearray()
                response_messages: list[dict] = []

                response_complete = False
                cacheable = True

                async def flush_response() -> None:
                    while response_messages:
                        message = response_messages.pop(0)
                        await send(message)

                async def capture_send(message: dict) -> None:
                    nonlocal response_status
                    nonlocal response_headers
                    nonlocal response_complete
                    nonlocal cacheable

                    if not cacheable:
                        await send(message)
                        return

                    message_type = message["type"]

                    if message_type == "http.response.start":
                        response_status = message["status"]
                        response_headers = list(
                            message.get("headers", [])
                        )
                        response_messages.append(message)
                        return

                    if message_type == "http.response.body":
                        chunk = message.get("body", b"")

                        if (
                            len(response_body) + len(chunk)
                            > self.max_cached_response_bytes
                        ):
                            cacheable = False
                            response_messages.append(message)
                            await flush_response()
                            return

                        response_body.extend(chunk)
                        response_messages.append(message)

                        if not message.get("more_body", False):
                            response_complete = True

                        return

                    # Unknown ASGI response messages are passed through
                    # without attempting to cache an incomplete response.
                    cacheable = False
                    response_messages.append(message)
                    await flush_response()

                await self.app(
                    scope,
                    replay_receive,
                    capture_send,
                )

                # Commit the cache before forwarding the original response.
                if (
                    cacheable
                    and response_complete
                    and response_status is not None
                    and 200 <= response_status < 300
                ):
                    safe_headers = [
                        (name, value)
                        for name, value in response_headers
                        if name.lower()
                        not in self.EXCLUDED_RESPONSE_HEADERS
                    ]

                    safe_headers.append(
                        (
                            b"content-length",
                            str(len(response_body)).encode("ascii"),
                        )
                    )

                    self._idempotency_cache[cache_key] = (
                        _CachedResponse(
                            expires_at=(
                                self.clock() + self.idempotency_ttl
                            ),
                            fingerprint=fingerprint,
                            headers=safe_headers,
                            body=bytes(response_body),
                        )
                    )

                await flush_response()

        finally:
            lock_state.users -= 1

            if (
                lock_state.users == 0
                and not lock_state.lock.locked()
                and self._idempotency_locks.get(cache_key)
                is lock_state
            ):
                self._idempotency_locks.pop(cache_key, None)
