"""
Unified WebSocket Connection Manager & Singleton Hub for HELPDESK.AI

Consolidates:
- Real-time ticket room subscriptions and chat message routing
- Bidirectional ping/pong heartbeat and connection pool eviction sweeps
- Per-company and global connection limits
- Multi-tenant data isolation and company-scoped broadcasting
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import logging
import time
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from fastapi import WebSocket

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration Constants
# ---------------------------------------------------------------------------
HEARTBEAT_INTERVAL_S: int = 30
HEARTBEAT_INTERVAL_SECONDS: int = 30
PONG_TIMEOUT_SECONDS: int = 10
EVICTION_SWEEP_INTERVAL_SECONDS: int = 60
MAX_PER_COMPANY: int = 50
MAX_CONNECTIONS_PER_ROOM: int = 50
MAX_TOTAL_CONNECTIONS: int = 500


@dataclass
class TrackedConnection:
    """Wraps an active WebSocket connection with tenant and liveness metadata."""
    ws: WebSocket
    client_id: str = "unknown"
    user_id: Optional[str] = None
    company_id: Optional[str] = None
    role: str = "user"
    connected_at: float = field(default_factory=time.time)
    last_pong_at: float = field(default_factory=time.monotonic)
    remote_addr: str = "unknown"

    def __hash__(self) -> int:
        return id(self.ws)

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, TrackedConnection):
            return self.ws is other.ws
        return False

    def is_alive(self) -> bool:
        """Returns True if a pong was received within the heartbeat + timeout window."""
        return (time.monotonic() - self.last_pong_at) < (HEARTBEAT_INTERVAL_S + PONG_TIMEOUT_SECONDS)

    def mark_pong(self) -> None:
        """Updates the last recorded pong timestamp to now."""
        self.last_pong_at = time.monotonic()


class ConnectionManager:
    """
    Unified singleton connection manager handling WebSocket pooling,
    per-ticket rooms, company-scoped broadcasts, and heartbeat liveness.
    """

    def __init__(self) -> None:
        # Primary registry: client_id -> TrackedConnection
        self._connections: Dict[str, TrackedConnection] = {}
        # Reverse lookup: WebSocket instance -> client_id
        self._ws_to_client_id: Dict[WebSocket, str] = {}
        
        # User index: user_id -> set of WebSockets
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # Ticket room subscriptions: ticket_id/room_id -> set of WebSockets
        self.ticket_subscriptions: Dict[str, Set[WebSocket]] = {}
        # Rooms index for TrackedConnection: room_id -> set of TrackedConnection
        self._rooms: Dict[str, Set[TrackedConnection]] = {}
        # Metadata dictionary expected by router endpoints
        self.connection_metadata: Dict[WebSocket, dict] = {}

        # Concurrency & background tasks
        self._global_lock = asyncio.Lock()
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._eviction_task: Optional[asyncio.Task] = None

    @property
    def _total_connections(self) -> int:
        return len(self._connections)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    async def start(self) -> None:
        """Start background heartbeat ping and stale eviction loops."""
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        self._eviction_task = asyncio.create_task(self._eviction_loop())
        logger.info(
            "[WS] Unified Connection Manager started (heartbeat=%ds, eviction=%ds)",
            HEARTBEAT_INTERVAL_S,
            EVICTION_SWEEP_INTERVAL_SECONDS,
        )

    async def stop(self) -> None:
        """Cancel background tasks and gracefully close all active connections."""
        tasks = [t for t in (self._heartbeat_task, self._eviction_task) if t and not t.done()]
        for t in tasks:
            t.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        async with self._global_lock:
            for tc in list(self._connections.values()):
                try:
                    await tc.ws.close(code=1001, reason="Server shutting down")
                except Exception:
                    pass
            self._connections.clear()
            self._ws_to_client_id.clear()
            self.active_connections.clear()
            self.ticket_subscriptions.clear()
            self._rooms.clear()
            self.connection_metadata.clear()
        logger.info("[WS] Unified Connection Manager stopped")

    # ------------------------------------------------------------------
    # Connect / Disconnect
    # ------------------------------------------------------------------
    async def connect(
        self,
        arg1: Any,
        arg2: Any = None,
        company_id: Optional[str] = None,
        role: str = "user",
        remote_addr: str = "unknown",
    ) -> bool:
        """
        Unified connect method supporting multiple calling conventions:
        1. connect(ws, client_id, company_id=None)
        2. connect(websocket, user_id, company_id, role="user")
        3. connect(room_id, ws, remote_addr="unknown")
        """
        room_id: Optional[str] = None
        ws: WebSocket
        client_id: str

        if isinstance(arg1, str) and hasattr(arg2, "accept"):
            # Signature 3: connect(room_id, ws, remote_addr)
            room_id = arg1
            ws = arg2
            client_id = getattr(ws, "client_id", None) or f"ws_{id(ws)}"
        elif hasattr(arg1, "accept"):
            # Signature 1 & 2: connect(ws, client_id/user_id, company_id, role)
            ws = arg1
            client_id = str(arg2) if arg2 is not None else getattr(ws, "client_id", f"ws_{id(ws)}")
        else:
            raise ValueError(f"Invalid arguments to connect: {arg1}, {arg2}")

        # Check global pool limit
        if len(self._connections) >= MAX_TOTAL_CONNECTIONS:
            logger.warning("[WS] Global connection cap reached (%d)", MAX_TOTAL_CONNECTIONS)
            return False

        # Check per-company connection limit
        if company_id is not None:
            comp_count = self.connection_count(company_id=company_id)
            if comp_count >= MAX_PER_COMPANY:
                logger.warning("[WS] Company %s cap reached (%d)", company_id, MAX_PER_COMPANY)
                return False

        # Check room limit if room specified
        if room_id is not None:
            async with self._global_lock:
                room = self._rooms.setdefault(room_id, set())
                if len(room) >= MAX_CONNECTIONS_PER_ROOM:
                    logger.warning("[WS] Room %s cap reached (%d)", room_id, MAX_CONNECTIONS_PER_ROOM)
                    return False

        # Accept connection
        await ws.accept()

        tc = TrackedConnection(
            ws=ws,
            client_id=client_id,
            user_id=client_id,
            company_id=company_id,
            role=role,
            remote_addr=remote_addr,
        )

        async with self._global_lock:
            self._connections[client_id] = tc
            self._ws_to_client_id[ws] = client_id

            if client_id not in self.active_connections:
                self.active_connections[client_id] = set()
            self.active_connections[client_id].add(ws)

            meta = {
                "user_id": client_id,
                "company_id": company_id,
                "role": role,
                "connected_at": datetime.now(timezone.utc).isoformat(),
            }
            self.connection_metadata[ws] = meta

            if room_id:
                self._rooms.setdefault(room_id, set()).add(tc)
                self.ticket_subscriptions.setdefault(room_id, set()).add(ws)

        logger.info(
            "[WS] Connected: client=%s company=%s total=%d",
            client_id,
            company_id,
            len(self._connections),
        )
        return True

    async def disconnect(self, arg1: Any, arg2: Any = None) -> None:
        """
        Unified disconnect supporting:
        1. disconnect(client_id: str)
        2. disconnect(ws: WebSocket)
        3. disconnect(room_id: str, ws: WebSocket)
        """
        async with self._global_lock:
            client_id: Optional[str] = None
            ws: Optional[WebSocket] = None

            if isinstance(arg1, str) and arg2 is None:
                # disconnect(client_id)
                client_id = arg1
                tc = self._connections.get(client_id)
                if tc:
                    ws = tc.ws
            elif hasattr(arg1, "accept") or hasattr(arg1, "send_text"):
                # disconnect(ws)
                ws = arg1
                client_id = self._ws_to_client_id.get(ws)
            elif isinstance(arg1, str) and (hasattr(arg2, "accept") or hasattr(arg2, "send_text")):
                # disconnect(room_id, ws)
                room_id = arg1
                ws = arg2
                client_id = self._ws_to_client_id.get(ws)
                room = self._rooms.get(room_id)
                if room:
                    to_remove = next((tc for tc in room if tc.ws is ws), None)
                    if to_remove:
                        room.discard(to_remove)
                        if not room:
                            del self._rooms[room_id]
                subs = self.ticket_subscriptions.get(room_id)
                if subs:
                    subs.discard(ws)
                    if not subs:
                        del self.ticket_subscriptions[room_id]
            else:
                client_id = str(arg1)

            # Evict from global pools
            if client_id and client_id in self._connections:
                tc = self._connections.pop(client_id)
                if not ws:
                    ws = tc.ws

            if ws:
                self._ws_to_client_id.pop(ws, None)
                self.connection_metadata.pop(ws, None)

                # Evict from active_connections
                for uid, conns in list(self.active_connections.items()):
                    conns.discard(ws)
                    if not conns:
                        del self.active_connections[uid]

                # Evict from rooms & ticket_subscriptions
                for room_id, conns in list(self.ticket_subscriptions.items()):
                    conns.discard(ws)
                    if not conns:
                        del self.ticket_subscriptions[room_id]

                for room_id, tc_set in list(self._rooms.items()):
                    to_del = [tc for tc in tc_set if tc.ws is ws]
                    for tc in to_del:
                        tc_set.discard(tc)
                    if not tc_set:
                        del self._rooms[room_id]

        logger.info("[WS] Disconnected: target=%s total=%d", client_id or ws, len(self._connections))

    # ------------------------------------------------------------------
    # Liveness & Queries
    # ------------------------------------------------------------------
    def is_connected(self, client_id_or_ws: Any) -> bool:
        """Returns True if the client or WebSocket is registered in active connections."""
        if isinstance(client_id_or_ws, str):
            return client_id_or_ws in self._connections
        return client_id_or_ws in self._ws_to_client_id

    def connection_count(self, company_id: Optional[str] = None) -> int:
        """Returns total active connections, optionally filtered by company_id."""
        if company_id is None:
            return len(self._connections)
        return sum(1 for tc in self._connections.values() if tc.company_id == company_id)

    def get_connection_count(self, company_id: Optional[str] = None) -> int:
        """Alias for connection_count."""
        return self.connection_count(company_id=company_id)

    def get_active_users(self, company_id: Optional[str] = None) -> Set[str]:
        """Returns active user IDs, optionally filtered by company."""
        if company_id:
            return {tc.user_id or tc.client_id for tc in self._connections.values() if tc.company_id == company_id}
        return set(self._connections.keys())

    def stats(self) -> dict:
        """Returns diagnostic metrics on connection pools and ticket rooms."""
        return {
            "total_connections": len(self._connections),
            "rooms": {rid: len(conns) for rid, conns in self._rooms.items()},
            "room_count": len(self._rooms),
        }

    # ------------------------------------------------------------------
    # Ticket Room Subscriptions
    # ------------------------------------------------------------------
    async def subscribe_to_ticket(self, websocket: WebSocket, ticket_id: str) -> None:
        """Subscribes a WebSocket connection to ticket-specific update events."""
        if ticket_id not in self.ticket_subscriptions:
            self.ticket_subscriptions[ticket_id] = set()
        self.ticket_subscriptions[ticket_id].add(websocket)

        tc = self._connections.get(self._ws_to_client_id.get(websocket, ""))
        if tc:
            self._rooms.setdefault(ticket_id, set()).add(tc)

        logger.info("[WS] Subscribed to ticket %s (user=%s)", ticket_id, getattr(tc, "client_id", "unknown"))

        await self.send_personal_message({
            "type": "ticket_subscribed",
            "ticket_id": ticket_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }, websocket)

    async def subscribe_ticket(self, ticket_id: str, websocket: WebSocket) -> None:
        """Alias for subscribe_to_ticket."""
        await self.subscribe_to_ticket(websocket, ticket_id)

    async def unsubscribe_from_ticket(self, websocket: WebSocket, ticket_id: str) -> None:
        """Unsubscribes a WebSocket connection from ticket-specific updates."""
        if ticket_id in self.ticket_subscriptions:
            self.ticket_subscriptions[ticket_id].discard(websocket)
            if not self.ticket_subscriptions[ticket_id]:
                del self.ticket_subscriptions[ticket_id]

        if ticket_id in self._rooms:
            room = self._rooms[ticket_id]
            to_remove = [tc for tc in room if tc.ws is websocket]
            for tc in to_remove:
                room.discard(tc)
            if not room:
                del self._rooms[ticket_id]

    # ------------------------------------------------------------------
    # Messaging & Broadcasting
    # ------------------------------------------------------------------
    async def send_personal(self, message: Union[dict, str], client_id: str) -> bool:
        """
        Sends a message to a specific client.
        Serializes dicts to JSON; raises TypeError/ValueError if object not serializable.
        Evicts client if send fails and returns False.
        """
        # Validate serialization before attempting send
        if isinstance(message, str):
            payload = message
        else:
            payload = json.dumps(message)

        tc = self._connections.get(client_id)
        if not tc:
            return False

        try:
            await tc.ws.send_text(payload)
            return True
        except Exception as e:
            logger.error("[WS] Error sending to %s: %s", client_id, e)
            await self.disconnect(client_id)
            return False

    async def send_personal_message(self, message: dict, websocket: WebSocket) -> None:
        """Sends a JSON message to a specific WebSocket connection."""
        try:
            if hasattr(websocket, "send_json"):
                await websocket.send_json(message)
            else:
                await websocket.send_text(json.dumps(message))
        except Exception as e:
            logger.error("[WS] Error sending personal message: %s", e)

    async def send_to_user(self, message: dict, user_id: str) -> None:
        """Sends a message to all active connections belonging to user_id."""
        conns = list(self.active_connections.get(user_id, set()))
        dead: List[WebSocket] = []
        for ws in conns:
            try:
                if hasattr(ws, "send_json"):
                    await ws.send_json(message)
                else:
                    await ws.send_text(json.dumps(message))
            except Exception as e:
                logger.error("[WS] Error sending to user %s: %s", user_id, e)
                dead.append(ws)

        for ws in dead:
            await self.disconnect(ws)

    async def broadcast(
        self,
        arg1: Union[dict, str],
        arg2: Any = None,
        company_id: Optional[str] = None,
        room_id: Optional[str] = None,
    ) -> Dict[str, int]:
        """
        Unified broadcast method supporting:
        1. broadcast(message, company_id=None)
        2. broadcast(room_id, message)
        Returns a dict with 'sent' and 'failed' counts.
        """
        if isinstance(arg1, str) and (isinstance(arg2, (dict, str))):
            target_room = arg1
            raw_msg = arg2
        else:
            target_room = room_id
            raw_msg = arg1
            if isinstance(arg2, str) and company_id is None:
                company_id = arg2

        payload = raw_msg if isinstance(raw_msg, str) else json.dumps(raw_msg)

        sent = 0
        failed = 0
        dead_clients: List[str] = []

        targets: List[TrackedConnection] = []
        if target_room:
            targets = list(self._rooms.get(target_room, set()))
        else:
            targets = list(self._connections.values())

        for tc in targets:
            if company_id and tc.company_id != company_id:
                continue

            try:
                await tc.ws.send_text(payload)
                sent += 1
            except Exception:
                failed += 1
                dead_clients.append(tc.client_id)

        for cid in dead_clients:
            await self.disconnect(cid)

        return {"sent": sent, "failed": failed}

    async def broadcast_ticket_update(
        self,
        ticket_id: str,
        update_type: str,
        data: dict,
        company_id: str,
    ) -> None:
        """Broadcasts a ticket update to ticket room subscribers and company members."""
        message = {
            "type": "ticket_update",
            "update_type": update_type,
            "ticket_id": ticket_id,
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        # Send to room subscribers
        subscribers = list(self.ticket_subscriptions.get(ticket_id, set()))
        dead: List[WebSocket] = []
        for ws in subscribers:
            try:
                await self.send_personal_message(message, ws)
            except Exception:
                dead.append(ws)

        for ws in dead:
            await self.disconnect(ws)

        # Send to company members not already subscribed
        for ws, meta in list(self.connection_metadata.items()):
            if meta.get("company_id") == company_id and ws not in self.ticket_subscriptions.get(ticket_id, set()):
                try:
                    await self.send_personal_message(message, ws)
                except Exception:
                    pass

    async def send_chat_message(
        self,
        ticket_id: str,
        sender_id: str,
        sender_name: str,
        message_text: str,
        company_id: str,
    ) -> None:
        """Sends a live chat message to all ticket subscribers except the sender."""
        message = {
            "type": "chat_message",
            "ticket_id": ticket_id,
            "sender_id": sender_id,
            "sender_name": sender_name,
            "message": message_text,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        subscribers = list(self.ticket_subscriptions.get(ticket_id, set()))
        dead: List[WebSocket] = []
        for ws in subscribers:
            meta = self.connection_metadata.get(ws, {})
            if meta.get("user_id") != sender_id:
                try:
                    await self.send_personal_message(message, ws)
                except Exception:
                    dead.append(ws)

        for ws in dead:
            await self.disconnect(ws)

    async def broadcast_to_company(
        self,
        message: dict,
        company_id: str,
        exclude_user: Optional[str] = None,
    ) -> None:
        """Broadcasts a message to all connected users within a company."""
        dead: List[WebSocket] = []
        for ws, meta in list(self.connection_metadata.items()):
            if meta.get("company_id") == company_id:
                if exclude_user and meta.get("user_id") == exclude_user:
                    continue
                try:
                    await self.send_personal_message(message, ws)
                except Exception:
                    dead.append(ws)

        for ws in dead:
            await self.disconnect(ws)

    # ------------------------------------------------------------------
    # Heartbeat & Eviction
    # ------------------------------------------------------------------
    async def handle_pong(self, client_id_or_room: str, ws: Optional[WebSocket] = None) -> None:
        """Refreshes last_pong_at timestamp upon receiving a client pong frame."""
        # 1. Lookup by client_id
        tc = self._connections.get(client_id_or_room)
        if tc:
            tc.mark_pong()
            return

        # 2. Lookup by room and ws
        if ws:
            room = self._rooms.get(client_id_or_room)
            if room:
                to_mark = next((t for t in room if t.ws is ws), None)
                if to_mark:
                    to_mark.mark_pong()

    async def evict_stale_connections(self) -> int:
        """Scans all connections and evicts those with expired pong timestamps."""
        now = time.monotonic()
        threshold = HEARTBEAT_INTERVAL_S
        stale_clients: List[str] = []

        async with self._global_lock:
            for cid, tc in self._connections.items():
                if (now - tc.last_pong_at) > threshold:
                    stale_clients.append(cid)

        for cid in stale_clients:
            tc = self._connections.get(cid)
            if tc:
                try:
                    await tc.ws.close(code=1000, reason="Heartbeat timeout")
                except Exception:
                    pass
            await self.disconnect(cid)

        if stale_clients:
            logger.info("[WS] Stale eviction: removed %d connections", len(stale_clients))
        return len(stale_clients)

    async def _heartbeat_loop(self) -> None:
        """Periodically pings all connected sockets."""
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_S)
            async with self._global_lock:
                conns = list(self._connections.values())

            for tc in conns:
                try:
                    if hasattr(tc.ws, "send_json"):
                        await tc.ws.send_json({"type": "ping", "ts": time.time()})
                    else:
                        await tc.ws.send_text(json.dumps({"type": "ping", "ts": time.time()}))
                except Exception:
                    await self.disconnect(tc.client_id)

    async def _eviction_loop(self) -> None:
        """Runs periodic eviction sweeps for unresponsive sockets."""
        while True:
            await asyncio.sleep(EVICTION_SWEEP_INTERVAL_SECONDS)
            await self.evict_stale_connections()


# Singleton connection hub instances
manager = ConnectionManager()
ws_manager = manager
