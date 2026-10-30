import pytest
from unittest.mock import MagicMock
from backend.services.sla_forecasting_service import SLAForecastingService, TicketContext

@pytest.fixture
def service():
    mock_db = MagicMock()
    return SLAForecastingService(db_client=mock_db, webhook_url="https://internal.helpdesk.ai/webhooks/sla")

def test_semantic_complexity_calculation(service):
    simple_text = "Please help me change my password."
    complex_text = "Production database timeout outage with severe kernel panic deadlock and packet-loss."

    score_simple = service.compute_semantic_complexity(simple_text)
    score_complex = service.compute_semantic_complexity(complex_text)

    assert 0.0 <= score_simple <= 1.0
    assert 0.0 <= score_complex <= 1.0
    assert score_complex > score_simple

def test_breach_probability_range(service):
    context = TicketContext(
        ticket_id="TICK-101",
        company_id="acme-corp",
        department="network-ops",
        description="Normal question about VPN certificate.",
        active_queue_depth=5,
        dept_resolution_velocity=3.0,
        priority="medium"
    )
    prob = service.calculate_breach_probability(context)
    assert 0.0 <= prob <= 1.0

def test_high_breach_threshold_and_tagging(service):
    # Overloaded technician queue with critical outage
    overloaded_context = TicketContext(
        ticket_id="TICK-CRITICAL-99",
        company_id="acme-corp",
        department="infra",
        description="Major production database outage deadlock latency failover downtime corrupted.",
        active_queue_depth=45,
        dept_resolution_velocity=1.5,
        priority="critical"
    )

    res = service.evaluate_and_balance(overloaded_context)
    assert res.breach_probability > 0.75
    assert res.is_high_risk is True
    assert "risk:high-breach" in res.applied_tags
    assert res.webhook_dispatched is True

def test_low_risk_scenario(service):
    clear_queue_context = TicketContext(
        ticket_id="TICK-EASY-01",
        company_id="acme-corp",
        department="support",
        description="General question about documentation.",
        active_queue_depth=0,
        dept_resolution_velocity=8.0,
        priority="low"
    )

    res = service.evaluate_and_balance(clear_queue_context)
    assert res.breach_probability <= 0.75
    assert res.is_high_risk is False
    assert len(res.applied_tags) == 0

def test_company_risk_distribution(service):
    mock_tickets = [
        {"breach_probability": 0.85},
        {"breach_probability": 0.90},
        {"breach_probability": 0.50},
        {"breach_probability": 0.15}
    ]
    dist = service.get_company_risk_distribution("tenant-42", mock_tickets)
    assert dist["company_id"] == "tenant-42"
    assert dist["total_tickets"] == 4
    assert dist["distribution"]["high_risk"] == 2
    assert dist["distribution"]["medium"] == 1
    assert dist["distribution"]["low"] == 1
    assert dist["average_breach_prob"] == 0.60
