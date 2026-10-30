"""
Unit and Integration Test Suite for Agentic Self-Healing Actions Engine (#4115).
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers.actions import router as actions_router
import backend.routers.actions as actions_module
from backend.services.agentic_action_engine import (
    AgenticActionEngine,
    PlaybookAuthorizationError,
    PlaybookValidationError,
)


class FakeSupabaseTable:
    """In-memory mock representing a Supabase table query builder."""

    def __init__(self, storage: list):
        """Initialize the mock table with a backing list."""
        self.storage = storage
        self._pending_update = None
        self._filter_id = None

    def insert(self, payload: dict):
        """Stage and append a new row payload into table storage."""
        self.storage.append(payload)
        self._last = [payload]
        return self

    def update(self, updates: dict):
        """Stage a dictionary of column updates."""
        self._pending_update = updates
        return self

    def select(self, *_args, **_kwargs):
        """Select all rows currently stored in the mock table."""
        self._last = list(self.storage)
        return self

    def order(self, *_args, **_kwargs):
        """No-op ordering modifier for mock queries."""
        return self

    def limit(self, *_args, **_kwargs):
        """No-op limit modifier for mock queries."""
        return self

    def eq(self, key: str, value: str):
        """Record an equality filter for subsequent execution."""
        self._filter_id = (key, value)
        return self

    def execute(self):
        """Execute the staged query or mutation and return a response object."""
        if self._pending_update is not None:
            record = {"id": self._filter_id[1] if self._filter_id else "unknown"}
            record.update(self._pending_update)
            self.storage.append(record)
            self._last = [record]
            self._pending_update = None
        return type("Resp", (), {"data": getattr(self, "_last", list(self.storage))})()


class FakeSupabaseClient:
    """In-memory mock representing the Supabase client across multiple tables."""

    def __init__(self):
        """Initialize empty storage lists for logs, tickets, and ticket messages."""
        self.tables = {
            "action_execution_logs": [],
            "tickets": [],
            "ticket_messages": [],
        }

    def table(self, name: str) -> FakeSupabaseTable:
        """Return a FakeSupabaseTable bound to the requested table name."""
        if name not in self.tables:
            self.tables[name] = []
        return FakeSupabaseTable(self.tables[name])


def test_playbook_registry_and_schema_validation():
    """Verify playbook discovery and strict parameter schema validation."""
    engine = AgenticActionEngine(secret_key="test-secret")
    playbooks = engine.list_playbooks()
    names = {p["name"] for p in playbooks}
    assert {"password_reset", "vpn_cert_refresh", "dns_flush"}.issubset(names)

    # Valid parameters pass
    engine.validate_playbook_params("password_reset", {"user_email": "alice@example.com"})

    # Unknown playbook raises PlaybookValidationError
    with pytest.raises(PlaybookValidationError):
        engine.validate_playbook_params("non_existent_playbook", {})

    # Missing required parameter raises PlaybookValidationError
    with pytest.raises(PlaybookValidationError):
        engine.validate_playbook_params("vpn_cert_refresh", {"user_email": "alice@example.com"})

    # Invalid parameter type raises PlaybookValidationError
    with pytest.raises(PlaybookValidationError):
        engine.validate_playbook_params("dns_flush", {"hostname": 12345})


def test_unconfigured_secret_fails_closed(monkeypatch):
    """Verify that missing AGENTIC_ACTION_HMAC_SECRET fails closed without a default secret."""
    monkeypatch.delenv("AGENTIC_ACTION_HMAC_SECRET", raising=False)
    engine = AgenticActionEngine(secret_key=None)
    params = {"user_email": "bob@example.com"}

    with pytest.raises(RuntimeError):
        engine.generate_hmac_token("ticket-100", "password_reset", params)

    assert engine.verify_hmac_token("ticket-100", "password_reset", params, "any-token") is False


def test_hmac_authorization_non_ascii_and_context_binding():
    """Verify HMAC failure logging, non-ASCII safety, and dry_run/company_id binding."""
    engine = AgenticActionEngine(secret_key="super-secret-key")
    fake_db = FakeSupabaseClient()
    params = {"user_email": "bob@example.com"}

    # Non-ASCII token should return False cleanly and raise PlaybookAuthorizationError
    with pytest.raises(PlaybookAuthorizationError):
        engine.execute_playbook(
            ticket_id="ticket-101",
            playbook_name="password_reset",
            params=params,
            hmac_token="invalid-non-ascii-token-ß",
            supabase_client=fake_db,
        )

    assert len(fake_db.tables["action_execution_logs"]) == 1
    assert fake_db.tables["action_execution_logs"][0]["status"] == "unauthorized"
    assert len(fake_db.tables["tickets"]) == 0

    # Token signed for dry_run=True cannot be used for dry_run=False
    dry_token = engine.generate_hmac_token(
        "ticket-101", "password_reset", params, dry_run=True, company_id="comp-a"
    )
    with pytest.raises(PlaybookAuthorizationError):
        engine.execute_playbook(
            ticket_id="ticket-101",
            playbook_name="password_reset",
            params=params,
            hmac_token=dry_token,
            supabase_client=fake_db,
            dry_run=False,
            company_id="comp-a",
        )


def test_dry_run_does_not_resolve_ticket():
    """Verify that dry_run=True logs dry_run_success without mutating tickets."""
    engine = AgenticActionEngine(secret_key="super-secret-key")
    fake_db = FakeSupabaseClient()
    params = {"hostname": "internal.corp.local", "record_type": "AAAA"}
    token = engine.generate_hmac_token(
        "ticket-202", "dns_flush", params, dry_run=True
    )

    result = engine.execute_playbook(
        ticket_id="ticket-202",
        playbook_name="dns_flush",
        params=params,
        hmac_token=token,
        supabase_client=fake_db,
        dry_run=True,
    )

    assert result["dry_run"] is True
    assert result["status"] == "dry_run_success"
    assert result["ticket_resolved"] is False
    assert len(fake_db.tables["action_execution_logs"]) == 1
    assert len(fake_db.tables["tickets"]) == 0
    assert len(fake_db.tables["ticket_messages"]) == 0


def test_live_execution_deflects_ticket_and_writes_audit_log_and_note():
    """Verify live execution writes audit log, updates ticket status, and posts a diagnostic note."""
    engine = AgenticActionEngine(secret_key="super-secret-key")
    fake_db = FakeSupabaseClient()
    params = {"user_email": "carol@example.com", "device_id": "laptop-99"}
    token = engine.generate_hmac_token(
        "ticket-303",
        "vpn_cert_refresh",
        params,
        dry_run=False,
        company_id="comp-1",
    )

    result = engine.execute_playbook(
        ticket_id="ticket-303",
        playbook_name="vpn_cert_refresh",
        params=params,
        hmac_token=token,
        supabase_client=fake_db,
        dry_run=False,
        company_id="comp-1",
    )

    assert result["status"] == "succeeded"
    assert result["ticket_resolved"] is True
    assert "[EXECUTED]" in result["diagnostic_summary"]
    assert len(fake_db.tables["action_execution_logs"]) == 1
    assert fake_db.tables["action_execution_logs"][0]["company_id"] == "comp-1"
    assert len(fake_db.tables["tickets"]) == 1
    assert fake_db.tables["tickets"][0]["status"] == "resolved"
    assert "vpn_cert_refresh" in fake_db.tables["tickets"][0]["resolution_note"]
    assert len(fake_db.tables["ticket_messages"]) == 1
    assert fake_db.tables["ticket_messages"][0]["ticket_id"] == "ticket-303"
    assert "vpn_cert_refresh" in fake_db.tables["ticket_messages"][0]["message"]


def test_handler_exception_records_failed_audit_log():
    """Verify that if a playbook handler raises, a 'failed' audit log entry is recorded."""
    engine = AgenticActionEngine(secret_key="super-secret-key")
    fake_db = FakeSupabaseClient()

    def _boom_handler(_params: dict, _dry_run: bool) -> dict:
        """Raise a simulated runtime failure inside the handler."""
        raise RuntimeError("boom")

    engine.register_playbook(
        name="failing_playbook",
        description="Always raises",
        required_params=["target"],
        param_types={"target": str},
        handler=_boom_handler,
    )
    params = {"target": "srv-01"}
    token = engine.generate_hmac_token("ticket-500", "failing_playbook", params)

    with pytest.raises(RuntimeError):
        engine.execute_playbook(
            ticket_id="ticket-500",
            playbook_name="failing_playbook",
            params=params,
            hmac_token=token,
            supabase_client=fake_db,
        )

    assert len(fake_db.tables["action_execution_logs"]) == 1
    assert fake_db.tables["action_execution_logs"][0]["status"] == "failed"


def test_fastapi_router_endpoints(monkeypatch):
    """Verify the FastAPI /actions/playbooks, /actions/execute, and /actions/logs endpoints."""
    fake_db = FakeSupabaseClient()
    monkeypatch.setattr(actions_module, "supabase", fake_db)
    monkeypatch.setattr(
        actions_module.agentic_action_engine, "secret_key", "router-test-secret"
    )

    app = FastAPI()
    app.include_router(actions_router)
    client = TestClient(app)

    # 1. List playbooks
    res_list = client.get("/actions/playbooks")
    assert res_list.status_code == 200
    assert len(res_list.json()["playbooks"]) >= 3

    # 2. Execute playbook with valid HMAC
    params = {"user_email": "dave@example.com"}
    token = actions_module.agentic_action_engine.generate_hmac_token(
        "ticket-404", "password_reset", params, dry_run=False
    )
    res_exec = client.post(
        "/actions/execute",
        json={
            "ticket_id": "ticket-404",
            "playbook_name": "password_reset",
            "parameters": params,
            "hmac_token": token,
            "dry_run": False,
        },
    )
    assert res_exec.status_code == 200
    body = res_exec.json()
    assert body["ticket_resolved"] is True
    assert body["status"] == "succeeded"

    # 3. Query audit logs
    res_logs = client.get("/actions/logs?ticket_id=ticket-404")
    assert res_logs.status_code == 200
    assert res_logs.json()["count"] >= 1
