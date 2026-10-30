"""
Unit Test Suite for SLA Breach Forecaster & Capacity Balancer
=============================================================
GitHub Issue #4116 Bounty Solution: riteshbonthalakoti/HELPDESK.AI
"""

import time
import unittest
from sla_breach_forecaster import (
    SLABreachForecaster,
    Ticket,
    Agent,
    TicketPriority,
    DEFAULT_SLA_LIMITS_MINUTES,
)


class TestSLABreachForecaster(unittest.TestCase):

    def setUp(self) -> None:
        self.forecaster = SLABreachForecaster(ewma_alpha=0.3)
        self.base_time = 1761770000.0  # Deterministic test epoch

    def test_ewma_forecasting_empty(self) -> None:
        forecast = self.forecaster.forecast_arrival_rate()
        self.assertEqual(forecast.intervals_observed, 0)
        self.assertEqual(forecast.forecasted_rate_per_interval, 0.0)

    def test_ewma_arrival_forecasting(self) -> None:
        # Feed 5 historical intervals of ticket counts
        self.forecaster.record_arrival_counts([10, 12, 15, 20, 25])
        forecast = self.forecaster.forecast_arrival_rate()

        self.assertEqual(forecast.intervals_observed, 5)
        self.assertEqual(forecast.latest_arrival_count, 25)
        self.assertGreater(forecast.forecasted_rate_per_interval, 10.0)
        self.assertLess(forecast.forecasted_rate_per_interval, 25.0)
        self.assertGreater(forecast.volatility_std_dev, 0.0)
        self.assertLessEqual(forecast.ci_lower_95, forecast.forecasted_rate_per_interval)
        self.assertGreaterEqual(forecast.ci_upper_95, forecast.forecasted_rate_per_interval)

    def test_ticket_breach_scoring_already_breached(self) -> None:
        # Ticket created 100 minutes ago with 60 min SLA limit -> breached
        t_breached = Ticket(
            ticket_id="TICKET-001",
            priority=TicketPriority.CRITICAL.value,
            created_at_epoch=self.base_time - (100 * 60),
            sla_limit_minutes=60.0,
        )
        self.forecaster.add_ticket(t_breached)
        score = self.forecaster.score_ticket_breach_risk("TICKET-001", now_epoch=self.base_time)

        self.assertTrue(score.is_breached)
        self.assertEqual(score.breach_probability, 1.0)
        self.assertEqual(score.risk_tier, "CRITICAL_BREACHED")

    def test_ticket_breach_scoring_nominal_vs_high(self) -> None:
        agent_bob = Agent(agent_id="A1", name="Bob", max_concurrency=4, speed_multiplier=1.0)
        self.forecaster.register_agent(agent_bob)

        # Ticket with 8 hours remaining and 20 min handling -> nominal
        t_safe = Ticket(
            ticket_id="TICKET-SAFE",
            priority=TicketPriority.LOW.value,
            created_at_epoch=self.base_time - (10 * 60),
            sla_limit_minutes=480.0,
            estimated_handling_minutes=20.0,
            assigned_agent_id="A1",
        )
        self.forecaster.add_ticket(t_safe)
        score_safe = self.forecaster.score_ticket_breach_risk("TICKET-SAFE", now_epoch=self.base_time)
        self.assertFalse(score_safe.is_breached)
        self.assertLess(score_safe.breach_probability, 0.20)
        self.assertEqual(score_safe.risk_tier, "NOMINAL")

    def test_greedy_min_load_rebalancing(self) -> None:
        # Overloaded agent with 3 slow tickets
        agent_overloaded = Agent(agent_id="A_BUSY", name="Alice Busy", max_concurrency=4, speed_multiplier=1.0)
        # Idle agent with 0 tickets
        agent_idle = Agent(agent_id="A_IDLE", name="Charlie Idle", max_concurrency=4, speed_multiplier=1.5)

        self.forecaster.register_agent(agent_overloaded)
        self.forecaster.register_agent(agent_idle)

        # Assign 3 tickets to A_BUSY, tight SLA
        for i in range(1, 4):
            t = Ticket(
                ticket_id=f"T-TIGHT-{i}",
                priority=TicketPriority.HIGH.value,
                created_at_epoch=self.base_time - (200 * 60),  # 200m elapsed of 240m limit -> 40m remaining
                sla_limit_minutes=240.0,
                estimated_handling_minutes=45.0,  # 3 * 45m = 135m total queue, way exceeding 40m remaining!
                assigned_agent_id="A_BUSY",
            )
            self.forecaster.add_ticket(t)

        pre_actions = self.forecaster.rebalance_capacity(risk_threshold=0.50, now_epoch=self.base_time)
        self.assertGreater(len(pre_actions), 0)

        # Verify that tickets were shifted to A_IDLE
        self.assertGreater(agent_idle.current_load_count, 0)
        self.assertLess(agent_overloaded.current_load_count, 3)

        # Verify that at least one action shows risk reduction
        action = pre_actions[0]
        self.assertLess(action.post_rebalance_risk, action.pre_rebalance_risk)

    def test_skill_matching_constraint(self) -> None:
        agent_general = Agent(agent_id="A_GEN", name="Generalist", skills=["general"], max_concurrency=4)
        agent_specialist = Agent(agent_id="A_SPEC", name="SecSpecialist", skills=["general", "security"], max_concurrency=4)

        self.forecaster.register_agent(agent_general)
        self.forecaster.register_agent(agent_specialist)

        sec_ticket = Ticket(
            ticket_id="T-SEC-1",
            priority=TicketPriority.CRITICAL.value,
            created_at_epoch=self.base_time,
            sla_limit_minutes=60.0,
            estimated_handling_minutes=30.0,
            skills_required=["security"],
            assigned_agent_id=None,  # unassigned
        )
        self.forecaster.add_ticket(sec_ticket)

        actions = self.forecaster.rebalance_capacity(risk_threshold=0.20, now_epoch=self.base_time)
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0].to_agent_id, "A_SPEC")
        self.assertEqual(sec_ticket.assigned_agent_id, "A_SPEC")

    def test_executive_report_generation(self) -> None:
        self.forecaster.record_arrival_counts([15, 18, 22])
        t1 = Ticket(
            ticket_id="T-REP-1",
            priority=TicketPriority.MEDIUM.value,
            created_at_epoch=self.base_time,
            sla_limit_minutes=480.0,
        )
        self.forecaster.add_ticket(t1)

        rep = self.forecaster.generate_report(now_epoch=self.base_time)
        self.assertEqual(rep["status"], "SUCCESS")
        self.assertIn("forecasting", rep)
        self.assertIn("sla_risk_summary", rep)
        self.assertIn("agent_capacity_metrics", rep)
        self.assertEqual(rep["sla_risk_summary"]["total_tickets_monitored"], 1)
        self.assertEqual(rep["sla_risk_summary"]["breached_count"], 0)
        self.assertEqual(rep["sla_risk_summary"]["sla_compliance_rate_pct"], 100.0)


if __name__ == "__main__":
    unittest.main()
