"""Real-Time SLA Breach Auto-Escalation & Notification Worker (Issue #4077 Solution).

Monitors active support tickets against tier-specific SLA deadlines, triggers idempotent
multi-stage escalation transitions (Warning -> Escalated -> Breached), and dispatches
structured webhook/notification payloads.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Set


@dataclass
class TicketSLAState:
    ticket_id: str
    priority: str
    elapsed_minutes: float
    sla_target_minutes: float
    current_assignee: str
    escalation_level: int = 0


class SLAAutoEscalationWorker:
    """Evaluates ticket queues and emits idempotent escalation notifications."""

    WARNING_THRESHOLD_RATIO = 0.80
    BREACH_THRESHOLD_RATIO = 1.00

    def __init__(self) -> None:
        self._notified_keys: Set[str] = set()

    def evaluate_ticket(self, ticket: TicketSLAState) -> Dict[str, Any]:
        target = max(ticket.sla_target_minutes, 1.0)
        burn_ratio = round(ticket.elapsed_minutes / target, 4)

        if burn_ratio >= self.BREACH_THRESHOLD_RATIO:
            stage = "BREACHED_L2_ESCALATION"
            next_level = max(ticket.escalation_level, 2)
            target_channel = "incident_commander_pager"
        elif burn_ratio >= self.WARNING_THRESHOLD_RATIO:
            stage = "AT_RISK_L1_WARNING"
            next_level = max(ticket.escalation_level, 1)
            target_channel = "team_lead_slack"
        else:
            stage = "HEALTHY"
            next_level = ticket.escalation_level
            target_channel = "none"

        dedup_key = f"{ticket.ticket_id}:{stage}"
        should_notify = stage != "HEALTHY" and dedup_key not in self._notified_keys
        if should_notify:
            self._notified_keys.add(dedup_key)

        return {
            "ticket_id": ticket.ticket_id,
            "priority": ticket.priority,
            "sla_burn_ratio": burn_ratio,
            "stage": stage,
            "escalation_level": next_level,
            "notification_dispatched": should_notify,
            "channel": target_channel,
        }

    def process_batch(self, tickets: List[TicketSLAState]) -> List[Dict[str, Any]]:
        return [self.evaluate_ticket(t) for t in tickets]
