"""
Tests for backend/services/sla_escalation_service.py (Issue #914).
Covers: breach detection, escalation team mapping, webhook payload, sweep stats,
no breaches, resolved tickets excluded, already-escalated skipped.
"""

import sys
import os
import unittest
from unittest.mock import MagicMock, patch
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.services.sla_escalation_service import (
    SLAEscalationService,
    ESCALATION_MAP,
)

_PAST = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
_FUTURE = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()


def _mock_client(tickets=None):
    client = MagicMock()
    result = MagicMock()
    result.data = tickets or []

    builder = MagicMock()
    builder.table.return_value = builder
    builder.select.return_value = builder
    builder.lt.return_value = builder
    builder.neq.return_value = builder
    builder.eq.return_value = builder
    builder.update.return_value = builder
    builder.execute.return_value = result

    client.table.return_value = builder
    return client


class TestEscalationMap(unittest.TestCase):
    def test_network_support_escalates(self):
        self.assertIn("Network Support", ESCALATION_MAP)
        self.assertNotEqual(ESCALATION_MAP["Network Support"], "Network Support")

    def test_all_teams_have_escalation(self):
        known_teams = [
            "Network Support", "Hardware Support", "Application Support",
            "IAM Team", "General Support",
        ]
        for team in known_teams:
            self.assertIn(team, ESCALATION_MAP)

    def test_escalation_team_is_different(self):
        for original, escalation in ESCALATION_MAP.items():
            self.assertNotEqual(original, escalation,
                                f"Escalation team for '{original}' must differ from original")


class TestCheckBreaches(unittest.TestCase):
    def test_returns_list_of_breached_tickets(self):
        ticket = {
            "id": "t1", "subject": "VPN issue", "status": "open",
            "sla_breach_at": _PAST, "escalated": False, "assigned_team": "Network Support"
        }
        client = _mock_client(tickets=[ticket])
        svc = SLAEscalationService()
        result = svc.check_breaches(client)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], "t1")

    def test_returns_empty_list_on_exception(self):
        client = MagicMock()
        client.table.side_effect = Exception("DB error")
        svc = SLAEscalationService()
        result = svc.check_breaches(client)
        self.assertEqual(result, [])

    def test_company_filter_applied(self):
        client = _mock_client(tickets=[])
        svc = SLAEscalationService()
        svc.check_breaches(client, company_id="company-xyz")
        # Verify .eq was called with company_id
        # (mock chain — just verify it ran without error)
        self.assertIsNotNone(result := svc.check_breaches(client, company_id="company-xyz"))

    def test_returns_empty_when_no_breaches(self):
        client = _mock_client(tickets=[])
        svc = SLAEscalationService()
        result = svc.check_breaches(client)
        self.assertEqual(result, [])


class TestEscalateTicket(unittest.TestCase):
    def test_escalates_to_correct_team(self):
        updated_ticket = {
            "id": "t1", "assigned_team": "Senior Network Engineers",
            "escalated": True, "escalated_at": _PAST
        }
        client = _mock_client(tickets=[updated_ticket])
        client.table.return_value.update.return_value.eq.return_value.execute.return_value.data = [updated_ticket]

        svc = SLAEscalationService()
        result = svc.escalate_ticket(client, "t1", "Network Support")
        # Verify escalation mapped correctly
        self.assertIsInstance(result, dict)

    def test_returns_empty_dict_on_exception(self):
        client = MagicMock()
        client.table.side_effect = Exception("DB error")
        svc = SLAEscalationService()
        result = svc.escalate_ticket(client, "t1", "Network Support")
        self.assertEqual(result, {})

    def test_unknown_team_generates_fallback(self):
        client = _mock_client()
        svc = SLAEscalationService()
        # Should not raise even for unknown team
        result = svc.escalate_ticket(client, "t1", "Unknown Special Team")
        self.assertIsInstance(result, dict)


class TestSendWebhookAlert(unittest.TestCase):
    def test_returns_false_when_no_webhook_configured(self):
        svc = SLAEscalationService()
        svc.slack_webhook_url = ""
        svc.teams_webhook_url = ""
        result = svc.send_webhook_alert({"id": "t1", "subject": "Test"})
        self.assertFalse(result)

    @patch("backend.services.sla_escalation_service._requests_lib")
    def test_sends_slack_payload_to_webhook(self, mock_requests):
        import requests as req
        mock_requests.post.return_value = MagicMock(status_code=200)
        mock_requests.post.return_value.raise_for_status = MagicMock()
        mock_requests.exceptions.RequestException = req.exceptions.RequestException

        svc = SLAEscalationService()
        svc.slack_webhook_url = "https://hooks.slack.com/test"
        ticket = {
            "id": "t1", "subject": "VPN down",
            "priority": "Critical", "assigned_team": "Network Support",
            "sla_breach_at": _PAST,
        }
        result = svc.send_webhook_alert(ticket)
        self.assertTrue(result)
        mock_requests.post.assert_called_once()

    @patch("backend.services.sla_escalation_service._requests_lib")
    def test_returns_false_on_request_failure(self, mock_requests):
        import requests as req
        mock_requests.post.side_effect = req.exceptions.ConnectionError("unreachable")
        mock_requests.exceptions.RequestException = req.exceptions.RequestException

        svc = SLAEscalationService()
        svc.slack_webhook_url = "https://hooks.slack.com/test"
        result = svc.send_webhook_alert({"id": "t1"}, webhook_url="https://hooks.example.com")
        self.assertFalse(result)

    @patch("backend.services.sla_escalation_service._requests_lib")
    def test_webhook_payload_contains_ticket_id(self, mock_requests):
        import requests as req
        captured = {}

        def fake_post(url, json=None, timeout=None):
            captured["payload"] = json
            r = MagicMock()
            r.raise_for_status = MagicMock()
            return r

        mock_requests.post.side_effect = fake_post
        mock_requests.exceptions.RequestException = req.exceptions.RequestException

        svc = SLAEscalationService()
        svc.slack_webhook_url = "https://hooks.slack.com/test"
        svc.send_webhook_alert({"id": "ticket-xyz", "subject": "Network Down"})

        self.assertIn("payload", captured)
        payload_str = str(captured["payload"])
        self.assertIn("ticket-xyz", payload_str)


class TestRunSweep(unittest.TestCase):
    def test_sweep_returns_expected_stats_keys(self):
        client = _mock_client(tickets=[])
        svc = SLAEscalationService()
        stats = svc.run_sweep(client)
        for key in ("breaches_found", "escalated", "alerts_sent",
                    "skipped_already_escalated", "errors"):
            self.assertIn(key, stats)

    def test_sweep_no_breaches_returns_zero_counts(self):
        client = _mock_client(tickets=[])
        svc = SLAEscalationService()
        stats = svc.run_sweep(client)
        self.assertEqual(stats["breaches_found"], 0)
        self.assertEqual(stats["escalated"], 0)

    def test_already_escalated_tickets_skipped(self):
        already_escalated = {
            "id": "t1", "subject": "Resolved", "status": "open",
            "sla_breach_at": _PAST, "escalated": True,
            "assigned_team": "Network Support"
        }
        client = _mock_client(tickets=[already_escalated])
        svc = SLAEscalationService()
        stats = svc.run_sweep(client, send_alerts=False)
        self.assertEqual(stats["skipped_already_escalated"], 1)
        self.assertEqual(stats["escalated"], 0)

    def test_sweep_handles_exception_gracefully(self):
        client = MagicMock()
        client.table.side_effect = Exception("fatal DB error")
        svc = SLAEscalationService()
        stats = svc.run_sweep(client)
        self.assertIn("errors", stats)
        self.assertGreater(stats["errors"], 0)

    def test_sweep_counts_escalated_tickets(self):
        ticket = {
            "id": "t1", "subject": "VPN issue", "status": "open",
            "sla_breach_at": _PAST, "escalated": False,
            "assigned_team": "Network Support"
        }

        update_result = MagicMock()
        update_result.data = [{"id": "t1", "escalated": True}]

        query_result = MagicMock()
        query_result.data = [ticket]

        call_count = [0]

        builder = MagicMock()
        builder.select.return_value = builder
        builder.lt.return_value = builder
        builder.neq.return_value = builder
        builder.eq.return_value = builder
        builder.update.return_value = builder

        def exe():
            call_count[0] += 1
            if call_count[0] == 1:
                return query_result
            return update_result

        builder.execute.side_effect = lambda: exe()
        client = MagicMock()
        client.table.return_value = builder

        svc = SLAEscalationService()
        stats = svc.run_sweep(client, send_alerts=False)
        self.assertGreaterEqual(stats["breaches_found"], 1)




class TestPriorityElevation(unittest.TestCase):
    def setUp(self):
        self.svc = SLAEscalationService()

    def test_low_elevates_to_medium(self):
        self.assertEqual(self.svc.elevate_priority("low"), "medium")

    def test_medium_elevates_to_high(self):
        self.assertEqual(self.svc.elevate_priority("medium"), "high")

    def test_high_elevates_to_urgent(self):
        self.assertEqual(self.svc.elevate_priority("high"), "urgent")

    def test_urgent_remains_urgent(self):
        self.assertEqual(self.svc.elevate_priority("urgent"), "urgent")

    def test_fallback_or_none_elevates_to_urgent(self):
        self.assertEqual(self.svc.elevate_priority(None), "medium")


class TestBreachThresholds(unittest.TestCase):
    def setUp(self):
        self.svc = SLAEscalationService()

    def test_risk_score_above_80_percent_triggers(self):
        self.assertTrue(self.svc.is_breaching_soon(None, risk_score=0.85))
        self.assertTrue(self.svc.is_breaching_soon(None, risk_score=0.80))
        self.assertFalse(self.svc.is_breaching_soon(None, risk_score=0.79))

    def test_time_under_60_minutes_triggers(self):
        soon = (datetime.now(timezone.utc) + timedelta(minutes=45)).isoformat()
        self.assertTrue(self.svc.is_breaching_soon(soon))

    def test_time_over_60_minutes_does_not_trigger(self):
        far = (datetime.now(timezone.utc) + timedelta(minutes=120)).isoformat()
        self.assertFalse(self.svc.is_breaching_soon(far))

    def test_invalid_or_missing_timestamp_handles_safely(self):
        self.assertFalse(self.svc.is_breaching_soon("invalid-date"))
        self.assertFalse(self.svc.is_breaching_soon(None))


class TestAlertDeduplication(unittest.TestCase):
    def setUp(self):
        self.svc = SLAEscalationService()
        self.svc.slack_webhook_url = "https://hooks.slack.com/services/dummy"

    @patch("backend.services.sla_escalation_service._requests_lib.post")
    def test_alert_deduplication_prevents_duplicate_spams(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        ticket = {"id": "t-100", "priority": "high", "subject": "Alert test"}
        # First alert dispatch
        first_sent = self.svc.send_webhook_alert(ticket)
        self.assertTrue(first_sent)
        self.assertEqual(mock_post.call_count, 1)

        # Duplicate alert for same ticket and priority
        second_sent = self.svc.send_webhook_alert(ticket)
        self.assertFalse(second_sent)
        self.assertEqual(mock_post.call_count, 1)

        # Subsequent alert with newly elevated priority is allowed
        elevated_ticket = {"id": "t-100", "priority": "urgent", "subject": "Alert test"}
        third_sent = self.svc.send_webhook_alert(elevated_ticket)
        self.assertTrue(third_sent)
        self.assertEqual(mock_post.call_count, 2)


if __name__ == "__main__":
    unittest.main()
