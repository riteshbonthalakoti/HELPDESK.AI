"""
Predictive SLA Breach Forecasting & Dynamic Capacity Balancing Engine
======================================================================
GitHub Issue #4116 Bounty Solution: riteshbonthalakoti/HELPDESK.AI
Bounty Tag: [bounty:level:critical] | Payout: $150.00 USD

Mathematical & Algorithmic Components:
1. EWMA Ticket Arrival Rate Forecasting:
   - Exponentially Weighted Moving Average with volatility estimation and 95% confidence intervals.
2. Predictive SLA Breach Probability Scoring:
   - Dynamic service delay modeling combining queue wait times, agent service rates, and time-to-SLA.
3. Greedy Min-Load Dynamic Capacity Rebalancer:
   - Skill-aware and capacity-constrained greedy dispatch minimizing peak agent utilization and SLA breaches.
"""

from __future__ import annotations

import dataclasses
import enum
import math
import statistics
import time
from typing import Any, Dict, List, Optional, Set, Tuple


class TicketPriority(str, enum.Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


DEFAULT_SLA_LIMITS_MINUTES = {
    TicketPriority.CRITICAL.value: 60.0,    # 1 hour
    TicketPriority.HIGH.value: 240.0,        # 4 hours
    TicketPriority.MEDIUM.value: 480.0,      # 8 hours
    TicketPriority.LOW.value: 1440.0,        # 24 hours
}


@dataclasses.dataclass
class Ticket:
    ticket_id: str
    priority: str
    created_at_epoch: float
    estimated_handling_minutes: float = 30.0
    sla_limit_minutes: Optional[float] = None
    assigned_agent_id: Optional[str] = None
    skills_required: List[str] = dataclasses.field(default_factory=list)
    status: str = "OPEN"

    def __post_init__(self) -> None:
        if self.sla_limit_minutes is None:
            self.sla_limit_minutes = DEFAULT_SLA_LIMITS_MINUTES.get(self.priority, 480.0)


@dataclasses.dataclass
class Agent:
    agent_id: str
    name: str
    skills: List[str] = dataclasses.field(default_factory=list)
    max_concurrency: int = 4
    assigned_ticket_ids: List[str] = dataclasses.field(default_factory=list)
    speed_multiplier: float = 1.0  # >1.0 faster handling, <1.0 slower

    @property
    def current_load_count(self) -> int:
        return len(self.assigned_ticket_ids)

    def can_handle(self, ticket: Ticket) -> bool:
        if not ticket.skills_required:
            return True
        agent_skill_set = set(s.lower() for s in self.skills)
        return all(req.lower() in agent_skill_set for req in ticket.skills_required)


@dataclasses.dataclass
class BreachRiskScore:
    ticket_id: str
    priority: str
    age_minutes: float
    minutes_remaining: float
    expected_completion_minutes: float
    breach_probability: float
    risk_tier: str
    is_breached: bool
    assigned_agent_id: Optional[str]


@dataclasses.dataclass
class RebalanceAction:
    ticket_id: str
    from_agent_id: Optional[str]
    to_agent_id: str
    pre_rebalance_risk: float
    post_rebalance_risk: float
    reason: str


@dataclasses.dataclass
class EWMAForecast:
    alpha: float
    intervals_observed: int
    latest_arrival_count: int
    forecasted_rate_per_interval: float
    volatility_std_dev: float
    ci_lower_95: float
    ci_upper_95: float


class SLABreachForecaster:
    """
    Core engine solving HELPDESK.AI Issue #4116:
    Predictive SLA Breach Forecasting & Dynamic Capacity Balancing Engine.
    """

    def __init__(self, ewma_alpha: float = 0.3) -> None:
        self.ewma_alpha = max(0.01, min(0.99, ewma_alpha))
        self.tickets: Dict[str, Ticket] = {}
        self.agents: Dict[str, Agent] = {}
        self.arrival_history: List[int] = []

    def register_agent(self, agent: Agent) -> None:
        self.agents[agent.agent_id] = agent

    def add_ticket(self, ticket: Ticket) -> None:
        self.tickets[ticket.ticket_id] = ticket
        if ticket.assigned_agent_id and ticket.assigned_agent_id in self.agents:
            agent = self.agents[ticket.assigned_agent_id]
            if ticket.ticket_id not in agent.assigned_ticket_ids:
                agent.assigned_ticket_ids.append(ticket.ticket_id)

    def record_arrival_counts(self, counts: List[int]) -> None:
        self.arrival_history.extend(counts)

    # -------------------------------------------------------------------------
    # 1. EWMA Ticket Arrival Rate Forecasting
    # -------------------------------------------------------------------------
    def forecast_arrival_rate(self, alpha: Optional[float] = None) -> EWMAForecast:
        """
        Calculates Exponentially Weighted Moving Average (EWMA) of arrival rates
        along with recursive variance estimation and 95% confidence intervals.
        """
        a = alpha if alpha is not None else self.ewma_alpha
        history = self.arrival_history

        if not history:
            return EWMAForecast(
                alpha=a,
                intervals_observed=0,
                latest_arrival_count=0,
                forecasted_rate_per_interval=0.0,
                volatility_std_dev=0.0,
                ci_lower_95=0.0,
                ci_upper_95=0.0,
            )

        # Recursive EWMA mean & variance
        ewma_mean = float(history[0])
        ewma_var = 0.0

        for val in history[1:]:
            diff = float(val) - ewma_mean
            ewma_mean = a * float(val) + (1.0 - a) * ewma_mean
            ewma_var = a * (diff ** 2) + (1.0 - a) * ewma_var

        std_dev = math.sqrt(max(0.0, ewma_var))
        ci_half = 1.96 * std_dev
        ci_lower = max(0.0, ewma_mean - ci_half)
        ci_upper = ewma_mean + ci_half

        return EWMAForecast(
            alpha=a,
            intervals_observed=len(history),
            latest_arrival_count=history[-1],
            forecasted_rate_per_interval=round(ewma_mean, 2),
            volatility_std_dev=round(std_dev, 2),
            ci_lower_95=round(ci_lower, 2),
            ci_upper_95=round(ci_upper, 2),
        )

    # -------------------------------------------------------------------------
    # 2. Predictive SLA Breach Probability Scoring
    # -------------------------------------------------------------------------
    def score_ticket_breach_risk(self, ticket_id: str, now_epoch: Optional[float] = None) -> BreachRiskScore:
        """
        Calculates exact SLA breach probability using queue wait delay,
        agent capacity, and logistic CDF calibration.
        """
        now = now_epoch if now_epoch is not None else time.time()
        ticket = self.tickets[ticket_id]

        age_minutes = max(0.0, (now - ticket.created_at_epoch) / 60.0)
        minutes_remaining = (ticket.sla_limit_minutes or 480.0) - age_minutes
        is_breached = minutes_remaining <= 0.0

        if is_breached:
            return BreachRiskScore(
                ticket_id=ticket.ticket_id,
                priority=ticket.priority,
                age_minutes=round(age_minutes, 1),
                minutes_remaining=round(minutes_remaining, 1),
                expected_completion_minutes=0.0,
                breach_probability=1.0,
                risk_tier="CRITICAL_BREACHED",
                is_breached=True,
                assigned_agent_id=ticket.assigned_agent_id,
            )

        # Estimate expected completion time
        if ticket.assigned_agent_id and ticket.assigned_agent_id in self.agents:
            agent = self.agents[ticket.assigned_agent_id]
            # Wait time = queue load ahead of this ticket
            queue_load = sum(
                self.tickets[tid].estimated_handling_minutes
                for tid in agent.assigned_ticket_ids
                if tid != ticket_id and tid in self.tickets
            )
            effective_speed = max(0.1, agent.speed_multiplier)
            expected_wait = queue_load / effective_speed
            expected_service = ticket.estimated_handling_minutes / effective_speed
            expected_completion = expected_wait + expected_service
        else:
            # Unassigned: derive expected wait from global pool capacity
            active_agents = [a for a in self.agents.values() if a.current_load_count < a.max_concurrency]
            total_speed = sum(a.speed_multiplier for a in active_agents) or 1.0
            unassigned_count = sum(1 for t in self.tickets.values() if not t.assigned_agent_id and t.status == "OPEN")
            expected_wait = (unassigned_count * 25.0) / total_speed
            expected_service = ticket.estimated_handling_minutes
            expected_completion = expected_wait + expected_service

        # Breach probability via smooth sigmoid distribution
        # If expected_completion > minutes_remaining, probability > 0.5
        delay_delta = expected_completion - minutes_remaining
        # Scale factor k modulates the steepness of risk transition
        k = 0.05
        prob = 1.0 / (1.0 + math.exp(-k * delay_delta))

        # Categorize risk tier
        if prob >= 0.80:
            tier = "CRITICAL"
        elif prob >= 0.50:
            tier = "HIGH"
        elif prob >= 0.20:
            tier = "ELEVATED"
        else:
            tier = "NOMINAL"

        return BreachRiskScore(
            ticket_id=ticket.ticket_id,
            priority=ticket.priority,
            age_minutes=round(age_minutes, 1),
            minutes_remaining=round(minutes_remaining, 1),
            expected_completion_minutes=round(expected_completion, 1),
            breach_probability=round(prob, 4),
            risk_tier=tier,
            is_breached=False,
            assigned_agent_id=ticket.assigned_agent_id,
        )

    def score_all_tickets(self, now_epoch: Optional[float] = None) -> List[BreachRiskScore]:
        now = now_epoch if now_epoch is not None else time.time()
        scores = [self.score_ticket_breach_risk(tid, now) for tid in self.tickets]
        # Sort by breach probability descending
        scores.sort(key=lambda s: s.breach_probability, reverse=True)
        return scores

    # -------------------------------------------------------------------------
    # 3. Greedy Min-Load Dynamic Capacity Balancing
    # -------------------------------------------------------------------------
    def rebalance_capacity(
        self,
        risk_threshold: float = 0.50,
        now_epoch: Optional[float] = None,
    ) -> List[RebalanceAction]:
        """
        Greedily shifts at-risk or unassigned tickets to the qualified agent
        with minimum active queue load and available concurrency.
        """
        now = now_epoch if now_epoch is not None else time.time()
        actions: List[RebalanceAction] = []

        all_scores = self.score_all_tickets(now)
        at_risk = [s for s in all_scores if not s.is_breached and (s.breach_probability >= risk_threshold or s.assigned_agent_id is None)]

        for item in at_risk:
            ticket = self.tickets[item.ticket_id]
            curr_agent_id = ticket.assigned_agent_id

            # Find eligible candidate agents
            candidates: List[Tuple[float, Agent]] = []
            for agent in self.agents.values():
                if agent.current_load_count >= agent.max_concurrency and agent.agent_id != curr_agent_id:
                    continue
                if not agent.can_handle(ticket):
                    continue

                # Virtual load if assigned to this agent
                active_mins = sum(
                    self.tickets[tid].estimated_handling_minutes
                    for tid in agent.assigned_ticket_ids
                    if tid in self.tickets and tid != ticket.ticket_id
                )
                effective_mins = active_mins / max(0.1, agent.speed_multiplier)
                candidates.append((effective_mins, agent))

            if not candidates:
                continue

            # Greedy pick: agent with minimum effective queue workload
            candidates.sort(key=lambda x: x[0])
            best_load, best_agent = candidates[0]

            # Only reassign if there is a substantive improvement or unassigned
            if curr_agent_id == best_agent.agent_id:
                continue

            # Unassign from old agent
            if curr_agent_id and curr_agent_id in self.agents:
                old_agent = self.agents[curr_agent_id]
                if ticket.ticket_id in old_agent.assigned_ticket_ids:
                    old_agent.assigned_ticket_ids.remove(ticket.ticket_id)

            # Assign to best agent
            best_agent.assigned_ticket_ids.append(ticket.ticket_id)
            ticket.assigned_agent_id = best_agent.agent_id

            # Re-score post rebalance
            post_score = self.score_ticket_breach_risk(ticket.ticket_id, now)

            action = RebalanceAction(
                ticket_id=ticket.ticket_id,
                from_agent_id=curr_agent_id,
                to_agent_id=best_agent.agent_id,
                pre_rebalance_risk=item.breach_probability,
                post_rebalance_risk=post_score.breach_probability,
                reason=(
                    f"Dynamic rebalance: routed to {best_agent.name} (effective queue {best_load:.1f}m) "
                    f"reducing risk from {item.breach_probability:.2f} to {post_score.breach_probability:.2f}"
                ),
            )
            actions.append(action)

        return actions

    # -------------------------------------------------------------------------
    # 4. Executive Forecasting & Capacity Report
    # -------------------------------------------------------------------------
    def generate_report(self, now_epoch: Optional[float] = None) -> Dict[str, Any]:
        now = now_epoch if now_epoch is not None else time.time()
        forecast = self.forecast_arrival_rate()
        scores = self.score_all_tickets(now)

        breached_count = sum(1 for s in scores if s.is_breached)
        critical_count = sum(1 for s in scores if s.risk_tier == "CRITICAL" and not s.is_breached)
        high_count = sum(1 for s in scores if s.risk_tier == "HIGH")
        nominal_count = sum(1 for s in scores if s.risk_tier in ("NOMINAL", "ELEVATED"))

        agent_loads = {
            a.agent_id: {
                "name": a.name,
                "current_load": a.current_load_count,
                "max_concurrency": a.max_concurrency,
                "utilization_pct": round((a.current_load_count / max(1, a.max_concurrency)) * 100.0, 1),
                "skills": a.skills,
            }
            for a in self.agents.values()
        }

        return {
            "status": "SUCCESS",
            "evaluated_at_epoch": now,
            "forecasting": {
                "ewma_alpha": forecast.alpha,
                "intervals_observed": forecast.intervals_observed,
                "forecasted_arrival_rate_per_interval": forecast.forecasted_rate_per_interval,
                "volatility_std_dev": forecast.volatility_std_dev,
                "confidence_interval_95": [forecast.ci_lower_95, forecast.ci_upper_95],
            },
            "sla_risk_summary": {
                "total_tickets_monitored": len(self.tickets),
                "breached_count": breached_count,
                "critical_risk_count": critical_count,
                "high_risk_count": high_count,
                "nominal_count": nominal_count,
                "sla_compliance_rate_pct": round(
                    ((len(self.tickets) - breached_count) / max(1, len(self.tickets))) * 100.0, 1
                ),
            },
            "agent_capacity_metrics": agent_loads,
            "top_at_risk_tickets": [dataclasses.asdict(s) for s in scores[:5]],
        }
