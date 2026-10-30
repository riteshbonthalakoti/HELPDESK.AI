"""
Unit Tests for Unified WebSocket Connection Manager Hub (#4110).

Covers:
- Ticket room subscriptions & unsubscriptions
- Targeted ticket update broadcasts & multi-tenant isolation
- Live chat message routing (excluding sender)
- Company-wide broadcasting with excluded user
- User connection aggregation (send_to_user)
- Connection manager lifecycle (start & stop)
- Diagnostics & stats verification
"""

import asyncio
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio

from backend.services.websocket_manager import (
    ConnectionManager,
    TrackedConnection,
    manager,
    ws_manager,
    HEARTBEAT_INTERVAL_S,
    MAX_TOTAL_CONNECTIONS,
)


def _mock_ws(client_id: str = "user-1", company_id: str = "comp-1") -> AsyncMock:
    ws = AsyncMock()
    ws.client_id = client_id
    ws.company_id = company_id
    ws.accept = AsyncMock()
    ws.send_text = AsyncMock()
    ws.send_json = AsyncMock()
    ws.close = AsyncMock()
    return ws


@pytest_asyncio.fixture()
async def conn_manager():
    mgr = ConnectionManager()
    yield mgr
    await mgr.stop()


@pytest.mark.asyncio
async def test_singleton_instances():
    """Verify manager and ws_manager point to the unified singleton hub."""
    assert manager is not None
    assert ws_manager is manager
    assert isinstance(manager, ConnectionManager)


@pytest.mark.asyncio
async def test_ticket_subscription_lifecycle(conn_manager):
    ws = _mock_ws("user-1", "comp-1")
    await conn_manager.connect(ws, "user-1", company_id="comp-1")

    # Subscribe to ticket-100
    await conn_manager.subscribe_to_ticket(ws, "ticket-100")
    assert ws in conn_manager.ticket_subscriptions["ticket-100"]
    assert "ticket-100" in conn_manager.stats()["rooms"]

    # Unsubscribe from ticket-100
    await conn_manager.unsubscribe_from_ticket(ws, "ticket-100")
    assert "ticket-100" not in conn_manager.ticket_subscriptions
    assert "ticket-100" not in conn_manager.stats()["rooms"]


@pytest.mark.asyncio
async def test_broadcast_ticket_update(conn_manager):
    ws1 = _mock_ws("user-1", "comp-1")
    ws2 = _mock_ws("user-2", "comp-1")
    ws3 = _mock_ws("user-3", "comp-other")

    await conn_manager.connect(ws1, "user-1", company_id="comp-1")
    await conn_manager.connect(ws2, "user-2", company_id="comp-1")
    await conn_manager.connect(ws3, "user-3", company_id="comp-other")

    await conn_manager.subscribe_to_ticket(ws1, "ticket-1")

    await conn_manager.broadcast_ticket_update(
        ticket_id="ticket-1",
        update_type="status_change",
        data={"status": "resolved"},
        company_id="comp-1",
    )

    # ws1 subscribed -> receives update
    assert ws1.send_json.called
    # ws2 in comp-1 (not subscribed) -> also receives update
    assert ws2.send_json.called
    # ws3 in comp-other -> must NOT receive update
    assert not ws3.send_json.called


@pytest.mark.asyncio
async def test_send_chat_message_excludes_sender(conn_manager):
    ws_sender = _mock_ws("sender", "comp-1")
    ws_receiver = _mock_ws("receiver", "comp-1")

    await conn_manager.connect(ws_sender, "sender", company_id="comp-1")
    await conn_manager.connect(ws_receiver, "receiver", company_id="comp-1")

    await conn_manager.subscribe_to_ticket(ws_sender, "ticket-chat")
    await conn_manager.subscribe_to_ticket(ws_receiver, "ticket-chat")

    # Reset calls after subscription ack
    ws_sender.send_json.reset_mock()
    ws_receiver.send_json.reset_mock()

    await conn_manager.send_chat_message(
        ticket_id="ticket-chat",
        sender_id="sender",
        sender_name="Alice",
        message_text="Hello support team!",
        company_id="comp-1",
    )

    # Sender must not receive their own message
    assert not ws_sender.send_json.called
    # Receiver must receive it
    assert ws_receiver.send_json.called
    sent_payload = ws_receiver.send_json.call_args[0][0]
    assert sent_payload["type"] == "chat_message"
    assert sent_payload["message"] == "Hello support team!"


@pytest.mark.asyncio
async def test_broadcast_to_company_with_exclusion(conn_manager):
    ws1 = _mock_ws("admin-1", "comp-a")
    ws2 = _mock_ws("agent-2", "comp-a")

    await conn_manager.connect(ws1, "admin-1", company_id="comp-a")
    await conn_manager.connect(ws2, "agent-2", company_id="comp-a")

    ws1.send_json.reset_mock()
    ws2.send_json.reset_mock()

    await conn_manager.broadcast_to_company(
        message={"type": "announcement", "content": "Maintenance in 10 mins"},
        company_id="comp-a",
        exclude_user="admin-1",
    )

    assert not ws1.send_json.called
    assert ws2.send_json.called


@pytest.mark.asyncio
async def test_send_to_user_multi_device(conn_manager):
    ws_phone = _mock_ws("user-x", "comp-x")
    ws_desktop = _mock_ws("user-x", "comp-x")

    await conn_manager.connect(ws_phone, "user-x", company_id="comp-x")
    # Simulate a second connection for same user
    conn_manager.active_connections["user-x"].add(ws_desktop)

    ws_phone.send_json.reset_mock()
    ws_desktop.send_json.reset_mock()

    await conn_manager.send_to_user({"type": "direct_alert"}, "user-x")

    assert ws_phone.send_json.called
    assert ws_desktop.send_json.called


@pytest.mark.asyncio
async def test_manager_start_and_stop_lifecycle(conn_manager):
    ws = _mock_ws("client-live", "comp-live")
    await conn_manager.connect(ws, "client-live", company_id="comp-live")

    # Start background loops
    await conn_manager.start()
    assert conn_manager._heartbeat_task is not None
    assert conn_manager._eviction_task is not None

    # Stop cancels loops and closes sockets
    await conn_manager.stop()
    assert len(conn_manager._connections) == 0
    assert ws.close.called
    assert conn_manager.connection_count() == 0


@pytest.mark.asyncio
async def test_stats_and_active_users(conn_manager):
    ws1 = _mock_ws("u1", "c-alpha")
    ws2 = _mock_ws("u2", "c-alpha")
    ws3 = _mock_ws("u3", "c-beta")

    await conn_manager.connect(ws1, "u1", company_id="c-alpha")
    await conn_manager.connect(ws2, "u2", company_id="c-alpha")
    await conn_manager.connect(ws3, "u3", company_id="c-beta")

    assert conn_manager.get_active_users("c-alpha") == {"u1", "u2"}
    assert conn_manager.get_active_users("c-beta") == {"u3"}
    assert conn_manager.get_connection_count("c-alpha") == 2
    assert conn_manager.get_connection_count() == 3

    stats = conn_manager.stats()
    assert stats["total_connections"] == 3
    assert stats["room_count"] == 0
