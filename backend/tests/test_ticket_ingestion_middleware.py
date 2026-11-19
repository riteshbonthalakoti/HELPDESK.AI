import asyncio

import pytest
from starlette.middleware.base import BaseHTTPMiddleware
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from backend.middleware.ticket_ingestion import TicketIngestionMiddleware


class FakeClock:
    def __init__(self):
        self.current = 0.0

    def __call__(self):
        return self.current

    def advance(self, seconds: float):
        self.current += seconds


def create_test_app(
    *,
    clock=None,
    max_requests=30,
    window_seconds=60,
    idempotency_ttl=300,
    handler_delay=0,
):
    calls = []

    async def create_ticket(request):
        payload = await request.json()
        calls.append(payload)

        if payload.get("fail"):
            return JSONResponse(
                {"detail": "Temporary failure"},
                status_code=500,
            )

        if handler_delay:
            await asyncio.sleep(handler_delay)

        return JSONResponse(
            {
                "ticket_id": f"T-{len(calls)}",
                "submitted": payload,
            },
            status_code=201,
        )

    application = Starlette(
        routes=[
            Route("/tickets", create_ticket, methods=["POST"]),
            Route("/api/tickets", create_ticket, methods=["POST"]),
        ]
    )

    middleware = TicketIngestionMiddleware(
        application,
        max_requests=max_requests,
        window_seconds=window_seconds,
        idempotency_ttl=idempotency_ttl,
        clock=clock or FakeClock(),
    )

    return middleware, calls


def make_client(application, ip="127.0.0.1"):
    return AsyncClient(
        transport=ASGITransport(
            app=application,
            client=(ip, 12345),
        ),
        base_url="http://test",
    )


@pytest.mark.asyncio
async def test_duplicate_key_returns_cached_ticket():
    application, calls = create_test_app()

    async with make_client(application) as client:
        first = await client.post(
            "/tickets",
            json={"summary": "Network failure"},
            headers={"Idempotency-Key": "request-001"},
        )

        second = await client.post(
            "/tickets",
            json={"summary": "Network failure"},
            headers={"Idempotency-Key": "request-001"},
        )

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json() == first.json()
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_concurrent_duplicate_requests_create_one_ticket():
    application, calls = create_test_app(handler_delay=0.02)

    async with make_client(application) as client:
        responses = await asyncio.gather(
            *[
                client.post(
                    "/tickets",
                    json={"summary": "Concurrent retry"},
                    headers={"Idempotency-Key": "concurrent-001"},
                )
                for _ in range(5)
            ]
        )

    assert len(calls) == 1
    assert sum(response.status_code == 201 for response in responses) == 1
    assert sum(response.status_code == 200 for response in responses) == 4
    assert all(
        response.json() == responses[0].json()
        for response in responses
    )


@pytest.mark.asyncio
async def test_same_key_with_different_payload_returns_conflict():
    application, calls = create_test_app()

    async with make_client(application) as client:
        first = await client.post(
            "/tickets",
            json={"summary": "First ticket"},
            headers={"Idempotency-Key": "payload-check-001"},
        )

        second = await client.post(
            "/tickets",
            json={"summary": "Different ticket"},
            headers={"Idempotency-Key": "payload-check-001"},
        )

    assert first.status_code == 201
    assert second.status_code == 409
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_idempotency_entry_expires_after_five_minutes():
    clock = FakeClock()
    application, calls = create_test_app(clock=clock)

    async with make_client(application) as client:
        first = await client.post(
            "/tickets",
            json={"summary": "Expired key"},
            headers={"Idempotency-Key": "expiry-001"},
        )

        clock.advance(300)

        second = await client.post(
            "/tickets",
            json={"summary": "Expired key"},
            headers={"Idempotency-Key": "expiry-001"},
        )

    assert first.status_code == 201
    assert second.status_code == 201
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_cached_retry_does_not_consume_rate_limit_slot():
    application, calls = create_test_app(max_requests=1)

    async with make_client(application) as client:
        first = await client.post(
            "/tickets",
            json={"summary": "Retry test"},
            headers={"Idempotency-Key": "retry-001"},
        )

        retry = await client.post(
            "/tickets",
            json={"summary": "Retry test"},
            headers={"Idempotency-Key": "retry-001"},
        )

    assert first.status_code == 201
    assert retry.status_code == 200
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_same_key_from_different_ips_is_isolated():
    application, calls = create_test_app()

    async with make_client(application, "192.0.2.1") as first_client:
        first = await first_client.post(
            "/tickets",
            json={"summary": "IP isolation"},
            headers={"Idempotency-Key": "ip-001"},
        )

    async with make_client(application, "192.0.2.2") as second_client:
        second = await second_client.post(
            "/tickets",
            json={"summary": "IP isolation"},
            headers={"Idempotency-Key": "ip-001"},
        )

    assert first.status_code == 201
    assert second.status_code == 201
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_sliding_window_rate_limit_is_per_ip():
    clock = FakeClock()
    application, calls = create_test_app(
        clock=clock,
        max_requests=2,
        window_seconds=10,
    )

    async with make_client(application, "192.0.2.10") as client:
        first = await client.post("/tickets", json={"summary": "One"})
        second = await client.post("/tickets", json={"summary": "Two"})
        blocked = await client.post("/tickets", json={"summary": "Three"})

        assert first.status_code == 201
        assert second.status_code == 201
        assert blocked.status_code == 429
        assert int(blocked.headers["Retry-After"]) > 0

        clock.advance(10)

        recovered = await client.post(
            "/tickets",
            json={"summary": "After window"},
        )

    async with make_client(application, "192.0.2.11") as another_client:
        independent = await another_client.post(
            "/tickets",
            json={"summary": "Another IP"},
        )

    assert recovered.status_code == 201
    assert independent.status_code == 201
    assert len(calls) == 4


@pytest.mark.asyncio
async def test_failed_responses_are_not_cached():
    application, calls = create_test_app()

    async with make_client(application) as client:
        first = await client.post(
            "/tickets",
            json={"fail": True},
            headers={"Idempotency-Key": "failure-001"},
        )

        second = await client.post(
            "/tickets",
            json={"fail": True},
            headers={"Idempotency-Key": "failure-001"},
        )

    assert first.status_code == 500
    assert second.status_code == 500
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_api_tickets_path_is_also_protected():
    application, calls = create_test_app()

    async with make_client(application) as client:
        first = await client.post(
            "/api/tickets",
            json={"summary": "API-prefixed ticket"},
            headers={"Idempotency-Key": "api-001"},
        )

        second = await client.post(
            "/api/tickets",
            json={"summary": "API-prefixed ticket"},
            headers={"Idempotency-Key": "api-001"},
        )

    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json() == second.json()
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_same_key_on_different_paths_is_isolated():
    application, calls = create_test_app()

    async with make_client(application) as client:
        first = await client.post(
            "/tickets",
            json={"summary": "First route"},
            headers={"Idempotency-Key": "shared-key"},
        )

        second = await client.post(
            "/api/tickets",
            json={"summary": "First route"},
            headers={"Idempotency-Key": "shared-key"},
        )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json() != second.json()
    assert len(calls) == 2


def create_request_id_test_app(*, max_requests=30):
    """Build an app with the production middleware registration order."""
    calls = []

    async def create_ticket(request):
        payload = await request.json()
        calls.append(payload)

        return JSONResponse(
            {"ticket_id": f"T-{len(calls)}"},
            status_code=201,
        )

    application = Starlette(
        routes=[
            Route("/tickets", create_ticket, methods=["POST"]),
            Route("/api/tickets", create_ticket, methods=["POST"]),
        ]
    )

    # Register ticket middleware first.
    application.add_middleware(
        TicketIngestionMiddleware,
        max_requests=max_requests,
        window_seconds=60,
        idempotency_ttl=300,
        clock=FakeClock(),
    )

    # Register request-ID middleware afterwards so it wraps
    # TicketIngestionMiddleware and sees its short-circuit responses.
    async def add_request_id(request, call_next):
        request_id = request.headers.get(
            "X-Request-ID",
            "generated-test-request-id",
        )
        request.state.request_id = request_id

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

    application.add_middleware(
        BaseHTTPMiddleware,
        dispatch=add_request_id,
    )
    return application, calls


@pytest.mark.asyncio
async def test_invalid_idempotency_key_response_includes_request_id():
    application, _ = create_request_id_test_app()

    async with make_client(application) as client:
        response = await client.post(
            "/tickets",
            json={"summary": "Invalid key"},
            headers={
                "Idempotency-Key": "",
                "X-Request-ID": "request-400",
            },
        )

    assert response.status_code == 400
    assert response.headers["X-Request-ID"] == "request-400"


@pytest.mark.asyncio
async def test_idempotency_conflict_response_includes_request_id():
    application, calls = create_request_id_test_app()

    async with make_client(application) as client:
        first = await client.post(
            "/tickets",
            json={"summary": "Original ticket"},
            headers={
                "Idempotency-Key": "request-conflict",
                "X-Request-ID": "request-original",
            },
        )

        conflict = await client.post(
            "/tickets",
            json={"summary": "Different ticket"},
            headers={
                "Idempotency-Key": "request-conflict",
                "X-Request-ID": "request-409",
            },
        )

    assert first.status_code == 201
    assert conflict.status_code == 409
    assert conflict.headers["X-Request-ID"] == "request-409"
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_rate_limit_response_includes_request_id():
    application, _ = create_request_id_test_app(max_requests=1)

    async with make_client(application) as client:
        first = await client.post(
            "/tickets",
            json={"summary": "First request"},
            headers={"X-Request-ID": "request-first"},
        )

        blocked = await client.post(
            "/tickets",
            json={"summary": "Blocked request"},
            headers={"X-Request-ID": "request-429"},
        )

    assert first.status_code == 201
    assert blocked.status_code == 429
    assert blocked.headers["X-Request-ID"] == "request-429"


@pytest.mark.asyncio
async def test_cached_replay_uses_current_request_id():
    application, calls = create_request_id_test_app()

    async with make_client(application) as client:
        first = await client.post(
            "/tickets",
            json={"summary": "Retry safely"},
            headers={
                "Idempotency-Key": "request-replay",
                "X-Request-ID": "request-original",
            },
        )

        replay = await client.post(
            "/tickets",
            json={"summary": "Retry safely"},
            headers={
                "Idempotency-Key": "request-replay",
                "X-Request-ID": "request-retry",
            },
        )

    assert first.status_code == 201
    assert replay.status_code == 200
    assert first.json() == replay.json()

    assert first.headers["X-Request-ID"] == "request-original"
    assert replay.headers["X-Request-ID"] == "request-retry"
    assert replay.headers["X-Request-ID"] != first.headers["X-Request-ID"]

    assert len(calls) == 1
