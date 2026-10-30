"""
Predictive SLA Breach Forecasting & Dynamic Capacity Balancing Engine

Provides proactive ML/heuristic-based breach probability calculations:
  - calculate_breach_probability(): computes P(breach) in [0.0, 1.0]
  - assess_and_tag_ticket(): tags ticket with risk:high-breach if P(breach) > 0.75
  - get_company_risk_distribution(): calculates company-wide risk profile and rebalancing advice
"""

from __future__ import annotations

import re
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# High-risk technical complexity indicators
HIGH_COMPLEXITY_KEYWORDS = {
    "deadlock", "segfault", "segmentation fault", "memory leak", "corruption",
    "kernel panic", "data loss", "ransomware", "unauthorized access", "cascade failure",
    "out of memory", "oom", "infinite loop", "split-brain", "500 internal server error",
    "race condition", "unrecoverable", "data breach", "ddos"
}

MEDIUM_COMPLEXITY_KEYWORDS = {
    "timeout", "latency", "slow query", "auth failure", "rate limit",
    "connection reset", "ssl handshake", "certificate expired", "null pointer",
    "unhandled exception", "api degradation", "replica lag", "disk full"
}

class SLABreachForecaster:
    """Predictive engine for SLA breach risk and capacity rebalancing."""

    def __init__(
        self,
        high_risk_threshold: float = 0.75,
        medium_risk_threshold: float = 0.50
    ):
        self.high_risk_threshold = high_risk_threshold
        self.medium_risk_threshold = medium_risk_threshold

    def calculate_semantic_complexity(self, title: str, description: str) -> float:
        """
        Calculates a complexity score in [0.0, 1.0] based on technical signals,
        error stack traces, and domain terminology.
        """
        text = f"{title} {description}".lower()
        if not text.strip():
            return 0.10

        score = 0.15

        # Check for critical keywords (+0.25 each, capped at 0.50)
        high_matches = sum(1 for kw in HIGH_COMPLEXITY_KEYWORDS if re.search(r"\b" + re.escape(kw) + r"\b", text))
        score += min(0.50, high_matches * 0.25)

        # Check for medium keywords (+0.10 each, capped at 0.25)
        med_matches = sum(1 for kw in MEDIUM_COMPLEXITY_KEYWORDS if re.search(r"\b" + re.escape(kw) + r"\b", text))
        score += min(0.25, med_matches * 0.10)

        # Length factor: dense multi-paragraph tickets with logs indicate deeper complexity
        word_count = len(text.split())
        if word_count > 150:
            score += 0.10
        elif word_count > 60:
            score += 0.05

        return round(min(1.0, max(0.05, score)), 4)

    def calculate_breach_probability(
        self,
        ticket: Dict[str, Any],
        queue_depth: int = 0,
        department_velocity: float = 1.0
    ) -> Dict[str, Any]:
        """
        Calculates P(breach) in [0.0, 1.0].
        Factors:
          - Queue Depth (technician/team concurrency pressure)
          - Semantic Complexity of issue
          - Priority weighting
          - Department resolution velocity (1.0 = average, >1.0 = fast, <1.0 = bottlenecked)
        """
        title = ticket.get("title", "")
        description = ticket.get("description", "")
        priority = str(ticket.get("priority", "medium")).lower()

        # 1. Complexity score [0.0, 1.0]
        complexity = self.calculate_semantic_complexity(title, description)

        # 2. Queue depth pressure (0 to 10+ active tickets mapped to [0.0, 1.0])
        queue_pressure = min(1.0, queue_depth / 8.0)

        # 3. Priority weight in [0.0, 1.0]
        priority_weights = {
            "urgent": 1.00,
            "high": 0.75,
            "medium": 0.45,
            "low": 0.15
        }
        p_weight = priority_weights.get(priority, 0.15)

        # 4. Department velocity modifier (velocity < 1.0 increases risk, > 1.0 decreases risk)
        safe_velocity = max(0.2, min(3.0, department_velocity))
        velocity_penalty = max(0.0, (1.0 - safe_velocity) * 0.25)
        velocity_relief = max(0.0, (safe_velocity - 1.0) * 0.15)

        # 5. Composite probability calculation
        raw_prob = (
            (complexity * 0.40) +
            (queue_pressure * 0.35) +
            (p_weight * 0.25) +
            velocity_penalty -
            velocity_relief
        )

        prob = round(min(1.0, max(0.02, raw_prob)), 4)

        if prob >= self.high_risk_threshold:
            risk_level = "HIGH"
            tag = "risk:high-breach"
        elif prob >= self.medium_risk_threshold:
            risk_level = "MEDIUM"
            tag = "risk:medium-breach"
        else:
            risk_level = "LOW"
            tag = "risk:low-breach"

        return {
            "breach_probability": prob,
            "risk_level": risk_level,
            "recommended_tag": tag,
            "factors": {
                "complexity_score": complexity,
                "queue_pressure": round(queue_pressure, 4),
                "priority_weight": p_weight,
                "department_velocity": safe_velocity
            }
        }

    def assess_and_tag_ticket(
        self,
        ticket: Dict[str, Any],
        queue_depth: int = 0,
        department_velocity: float = 1.0
    ) -> Dict[str, Any]:
        """
        Evaluates ticket risk and prepares mutation payload (tags, audit note, alert required).
        """
        analysis = self.calculate_breach_probability(ticket, queue_depth, department_velocity)
        tags = list(ticket.get("tags") or [])

        # Remove existing conflicting risk tags
        clean_tags = [t for t in tags if not t.startswith("risk:")]
        clean_tags.append(analysis["recommended_tag"])

        should_alert = analysis["breach_probability"] >= self.high_risk_threshold

        return {
            "ticket_id": ticket.get("id"),
            "breach_probability": analysis["breach_probability"],
            "risk_level": analysis["risk_level"],
            "updated_tags": clean_tags,
            "alert_required": should_alert,
            "factors": analysis["factors"]
        }

    def get_company_risk_distribution(
        self,
        company_id: str,
        active_tickets: List[Dict[str, Any]],
        team_queues: Optional[Dict[str, int]] = None
    ) -> Dict[str, Any]:
        """
        Generates risk distribution telemetry and dynamic capacity balancing insights.
        """
        team_queues = team_queues or {}
        total = len(active_tickets)

        if total == 0:
            return {
                "company_id": company_id,
                "total_active_tickets": 0,
                "risk_breakdown": {"HIGH": 0, "MEDIUM": 0, "LOW": 0},
                "average_breach_probability": 0.0,
                "capacity_recommendations": []
            }

        high_count = 0
        med_count = 0
        low_count = 0
        total_prob = 0.0
        rebalancing_suggestions = []

        for t in active_tickets:
            assigned_team = t.get("assigned_team", "General Support")
            queue_depth = team_queues.get(assigned_team, 0)
            res = self.calculate_breach_probability(t, queue_depth=queue_depth)

            prob = res["breach_probability"]
            total_prob += prob

            if res["risk_level"] == "HIGH":
                high_count += 1
            elif res["risk_level"] == "MEDIUM":
                med_count += 1
            else:
                low_count += 1

        avg_prob = round(total_prob / total, 4)

        # Generate capacity balancing recommendations
        for team, depth in team_queues.items():
            if depth >= 8:
                rebalancing_suggestions.append({
                    "team": team,
                    "active_queue": depth,
                    "action": "OVERLOAD_WARNING",
                    "suggestion": f"Reallocate incoming P1/P2 tickets from '{team}' (Queue: {depth}) to standby tier engineers."
                })

        return {
            "company_id": company_id,
            "total_active_tickets": total,
            "risk_breakdown": {
                "HIGH": high_count,
                "MEDIUM": med_count,
                "LOW": low_count
            },
            "average_breach_probability": avg_prob,
            "capacity_recommendations": rebalancing_suggestions
        }

sla_forecaster = SLABreachForecaster()
