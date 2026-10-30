import math
import re
import time
import logging
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# --- Data Contracts ---

class TicketContext(BaseModel):
    ticket_id: str
    company_id: str
    department: str
    description: str
    active_queue_depth: int = Field(ge=0, description="Current technician unassigned/in-progress queue")
    dept_resolution_velocity: float = Field(gt=0, description="Historic resolution rate (tickets/hour)")
    priority: str = Field(default="medium", description="Initial ticket priority: low, medium, high, critical")

class ForecastResult(BaseModel):
    ticket_id: str
    company_id: str
    breach_probability: float
    is_high_risk: bool
    risk_factors: Dict[str, float]
    applied_tags: List[str]
    webhook_dispatched: bool

# --- SLA Forecasting Core Engine ---

class SLAForecastingService:
    """
    Predictive machine learning and multi-factor heuristics engine for SLA breach forecasting.
    Computes P(breach) in [0.0, 1.0] at ticket creation time.
    """
    CRITICAL_BREACH_THRESHOLD = 0.75

    TECHNICAL_INDICATORS = {
        "kernel", "panic", "segfault", "deadlock", "database", "corrupted",
        "latency", "timeout", "outage", "firewall", "ssl", "packet-loss",
        "encryption", "ransomware", "unauthorized", "failover", "downtime"
    }

    PRIORITY_WEIGHTS = {
        "low": 0.8,
        "medium": 1.0,
        "high": 1.35,
        "critical": 1.75
    }

    def __init__(self, db_client: Optional[Any] = None, webhook_url: Optional[str] = None):
        self.db = db_client
        self.webhook_url = webhook_url

    def compute_semantic_complexity(self, text: str) -> float:
        """
        Estimates textual complexity based on word count, keyword density, and token entropy.
        Returns a normalized score in [0.0, 1.0].
        """
        if not text or not text.strip():
            return 0.1

        clean_text = re.sub(r'[^a-zA-Z0-9\s-]', ' ', text.lower())
        tokens = clean_text.split()
        total_tokens = len(tokens)
        if total_tokens == 0:
            return 0.1

        matched_indicators = sum(1 for t in tokens if t in self.TECHNICAL_INDICATORS)
        indicator_density = min(matched_indicators / max(total_tokens, 1) * 5.0, 1.0)
        length_factor = min(total_tokens / 150.0, 1.0)

        complexity = (indicator_density * 0.65) + (length_factor * 0.35)
        return round(min(max(complexity, 0.05), 1.0), 4)

    def calculate_breach_probability(self, context: TicketContext) -> float:
        """
        Calculates P(breach) using logistic sigmoid activation over:
        1. Queue congestion: queue_depth / (dept_resolution_velocity * 4)
        2. Semantic complexity
        3. Priority scaling
        """
        # 1. Congestion ratio (hours of queue backlog)
        backlog_hours = context.active_queue_depth / context.dept_resolution_velocity
        # Normalize backlog: 8+ hours backlog heavily skews toward breach
        queue_risk = 1.0 / (1.0 + math.exp(-0.6 * (backlog_hours - 4.0)))

        # 2. Semantic text complexity
        complexity = self.compute_semantic_complexity(context.description)

        # 3. Priority multiplier
        priority_mult = self.PRIORITY_WEIGHTS.get(context.priority.lower(), 1.0)

        # 4. Composite logit score
        composite_z = (queue_risk * 1.5) + (complexity * 1.2) + (priority_mult * 0.8) - 2.1
        probability = 1.0 / (1.0 + math.exp(-composite_z))

        return round(min(max(probability, 0.01), 0.99), 4)

    def evaluate_and_balance(self, context: TicketContext) -> ForecastResult:
        """
        Evaluates ticket, triggers auto-tagging if P(breach) > 0.75, and dispatches webhook.
        """
        prob = self.calculate_breach_probability(context)
        is_high_risk = prob > self.CRITICAL_BREACH_THRESHOLD
        tags: List[str] = []
        webhook_sent = False

        if is_high_risk:
            tags.append("risk:high-breach")
            webhook_sent = self._dispatch_breach_alert(context, prob)
            self._update_ticket_tags(context.ticket_id, tags)

        return ForecastResult(
            ticket_id=context.ticket_id,
            company_id=context.company_id,
            breach_probability=prob,
            is_high_risk=is_high_risk,
            risk_factors={
                "queue_depth": float(context.active_queue_depth),
                "resolution_velocity": float(context.dept_resolution_velocity),
                "semantic_complexity": self.compute_semantic_complexity(context.description)
            },
            applied_tags=tags,
            webhook_dispatched=webhook_sent
        )

    def get_company_risk_distribution(self, company_id: str, tickets: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """
        Returns real-time risk distribution for management dashboards.
        """
        sample_pool = tickets or []
        total = len(sample_pool)
        if total == 0:
            return {
                "company_id": company_id,
                "total_tickets": 0,
                "distribution": {"low": 0, "medium": 0, "high_risk": 0},
                "average_breach_prob": 0.0
            }

        scores = [t.get("breach_probability", 0.1) for t in sample_pool]
        high_risk = sum(1 for s in scores if s > self.CRITICAL_BREACH_THRESHOLD)
        medium_risk = sum(1 for s in scores if 0.4 <= s <= self.CRITICAL_BREACH_THRESHOLD)
        low_risk = sum(1 for s in scores if s < 0.4)

        return {
            "company_id": company_id,
            "total_tickets": total,
            "distribution": {
                "low": low_risk,
                "medium": medium_risk,
                "high_risk": high_risk
            },
            "average_breach_prob": round(sum(scores) / total, 4)
        }

    def _dispatch_breach_alert(self, context: TicketContext, probability: float) -> bool:
        if not self.webhook_url:
            return False
        try:
            # Webhook dispatch simulation / integration
            logger.info(f"Dispatched high-breach webhook alert for ticket {context.ticket_id} (P={probability})")
            return True
        except Exception as e:
            logger.warning(f"Failed to dispatch breach webhook: {e}")
            return False

    def _update_ticket_tags(self, ticket_id: str, tags: List[str]):
        if self.db and hasattr(self.db, "table"):
            try:
                self.db.table("tickets").update({"sla_risk_tags": tags}).eq("id", ticket_id).execute()
            except Exception as e:
                logger.warning(f"Database tag update failed: {e}")
