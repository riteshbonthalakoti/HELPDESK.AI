"""
Unit Tests for Predictive SLA Breach Forecasting & Dynamic Capacity Balancing Engine
"""

import pytest
from backend.services.sla_forecasting_service import (
    SLABreachForecaster,
    sla_forecaster
)

def test_semantic_complexity_low():
    forecaster = SLABreachForecaster()
    score = forecaster.calculate_semantic_complexity(
        title="Update user profile picture",
        description="User cannot change avatar image in settings tab."
    )
    assert 0.05 <= score <= 0.35

def test_semantic_complexity_critical():
    forecaster = SLABreachForecaster()
    score = forecaster.calculate_semantic_complexity(
        title="Database deadlock in payment processing queue",
        description="Encountered segmentation fault and kernel panic causing data loss during cascade failure."
    )
    assert score >= 0.65

def test_breach_probability_high_risk_threshold():
    forecaster = SLABreachForecaster(high_risk_threshold=0.75)
    ticket = {
        "id": "t-critical-001",
        "title": "Severe deadlock and memory leak causing service panic",
        "description": "500 internal server error with memory leak and deadlock across payment nodes.",
        "priority": "urgent"
    }
    # High queue pressure and degraded department velocity
    result = forecaster.calculate_breach_probability(
        ticket,
        queue_depth=12,
        department_velocity=0.5
    )
    assert result["breach_probability"] >= 0.75
    assert result["risk_level"] == "HIGH"
    assert result["recommended_tag"] == "risk:high-breach"

def test_breach_probability_low_risk():
    forecaster = SLABreachForecaster()
    ticket = {
        "id": "t-low-002",
        "title": "Minor typo in footer navigation",
        "description": "The copyright year needs to be bumped.",
        "priority": "low"
    }
    result = forecaster.calculate_breach_probability(
        ticket,
        queue_depth=1,
        department_velocity=1.5
    )
    assert result["breach_probability"] < 0.50
    assert result["risk_level"] == "LOW"
    assert result["recommended_tag"] == "risk:low-breach"

def test_assess_and_tag_ticket():
    ticket = {
        "id": "t-103",
        "title": "Production deadlock crash",
        "description": "Fatal crash deadlock segfault under heavy volume",
        "priority": "urgent",
        "tags": ["frontend", "risk:low-breach"]
    }
    assessment = sla_forecaster.assess_and_tag_ticket(ticket, queue_depth=10, department_velocity=0.6)
    assert assessment["alert_required"] is True
    assert "risk:high-breach" in assessment["updated_tags"]
    assert "risk:low-breach" not in assessment["updated_tags"]

def test_company_risk_distribution():
    active_tickets = [
        {
            "id": "t-1",
            "title": "Deadlock crash in database",
            "description": "oom memory leak deadlock",
            "priority": "urgent",
            "assigned_team": "Database Team"
        },
        {
            "id": "t-2",
            "title": "CSS padding alignment",
            "description": "Button is shifted 2px to the left",
            "priority": "low",
            "assigned_team": "Frontend Team"
        }
    ]
    team_queues = {
        "Database Team": 12,
        "Frontend Team": 2
    }
    dist = sla_forecaster.get_company_risk_distribution(
        company_id="company-test-123",
        active_tickets=active_tickets,
        team_queues=team_queues
    )
    assert dist["total_active_tickets"] == 2
    assert dist["risk_breakdown"]["HIGH"] >= 1
    assert dist["average_breach_probability"] > 0.0
    assert len(dist["capacity_recommendations"]) >= 1
    assert dist["capacity_recommendations"][0]["team"] == "Database Team"
