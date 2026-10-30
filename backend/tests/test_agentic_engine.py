import pytest
from unittest.mock import MagicMock
from backend.services.agentic_action_engine import AgenticActionEngine

@pytest.fixture
def engine():
    mock_db = MagicMock()
    return AgenticActionEngine(hmac_secret="test_secret_key_2026", db_client=mock_db)

def test_playbook_registry_contains_required_actions(engine):
    assert "password_reset" in engine.PLAYBOOK_REGISTRY
    assert "vpn_cert_refresh" in engine.PLAYBOOK_REGISTRY
    assert "dns_flush" in engine.PLAYBOOK_REGISTRY

def test_hmac_token_verification(engine):
    token = engine.generate_token("password_reset", "ticket-101")
    assert engine.verify_token(token, "password_reset", "ticket-101") is True

    # Bad ticket or playbook
    assert engine.verify_token(token, "dns_flush", "ticket-101") is False
    assert engine.verify_token(token, "password_reset", "ticket-999") is False

    # Tampered signature
    assert engine.verify_token("12345.tampered_sig", "password_reset", "ticket-101") is False

def test_dry_run_execution(engine):
    token = engine.generate_token("password_reset", "ticket-101")
    res = engine.execute_action(
        playbook_name="password_reset",
        ticket_id="ticket-101",
        auth_token=token,
        parameters={"user_id": "usr_99", "tenant_id": "acme-corp"},
        dry_run=True
    )
    assert res["success"] is True
    assert res["dry_run"] is True
    assert res["result"]["status"] == "dry_run_success"

def test_action_execution_and_schema_validation(engine):
    token = engine.generate_token("vpn_cert_refresh", "ticket-202")
    
    # Missing required 'device_id' parameter
    invalid_res = engine.execute_action(
        playbook_name="vpn_cert_refresh",
        ticket_id="ticket-202",
        auth_token=token,
        parameters={"user_id": "usr_77"}
    )
    assert invalid_res["success"] is False
    assert "Schema validation error" in invalid_res["error"]

    # Valid execution
    valid_res = engine.execute_action(
        playbook_name="vpn_cert_refresh",
        ticket_id="ticket-202",
        auth_token=token,
        parameters={"user_id": "usr_77", "device_id": "macbook-m3-corp-01", "region": "us-east"}
    )
    assert valid_res["success"] is True
    assert valid_res["result"]["status"] == "success"
    assert "cert_serial" in valid_res["result"]

def test_auto_deflection_and_audit_logging(engine):
    token = engine.generate_token("dns_flush", "ticket-303")
    res = engine.execute_action(
        playbook_name="dns_flush",
        ticket_id="ticket-303",
        auth_token=token,
        parameters={"tenant_id": "globex-intl"}
    )
    assert res["success"] is True
    # Audit log check
    engine.db.table.assert_any_call("action_execution_logs")
    # Ticket deflection status update check
    engine.db.table.assert_any_call("tickets")
