"""
SLA Escalation Service — Detects SLA breaches and escalates tickets.

Features:
  - check_breaches()  — queries tickets where sla_breach_at is within breach threshold (<= 60 min or risk_score >= 0.80) or past, and status not resolved/closed
  - escalate_ticket() — updates assigned_team, elevates priority (low -> medium -> high -> urgent), sets escalated=True
  - send_webhook_alert() — POSTs to Slack/Teams webhook with alert deduplication
  - run_sweep()       — full sweep: find breaches, escalate, alert, return stats
  - ESCALATION_MAP    — maps original team → escalation team
  - PRIORITY_ESCALATION_MAP — maps current priority → elevated priority
  - Supports SLACK_WEBHOOK_URL and TEAMS_WEBHOOK_URL env vars
"""

from __future__ import annotations

import os
import json
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

try:
    import requests as _requests_lib
except ImportError:
    _requests_lib = None  # type: ignore

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Escalation team mapping: original team → escalation team
# ---------------------------------------------------------------------------
ESCALATION_MAP: dict[str, str] = {
    "Network Support": "Senior Network Engineers",
    "Hardware Support": "Senior Hardware Engineers",
    "Application Support": "Senior Software Engineers",
    "IAM Team": "Security Operations Center",
    "General Support": "Tier 2 Support",
    "Cloud Apps Team": "Platform Engineering",
    "Security Ops": "Security Operations Center",
    "HR Systems": "Senior HR Systems Team",
    "IT Service Desk": "Tier 2 Support",
    "IT Inventory": "Senior Hardware Engineers",
    "Network Services": "Senior Network Engineers",
}

# ---------------------------------------------------------------------------
# Priority escalation mapping: low -> medium -> high -> urgent
# ---------------------------------------------------------------------------
PRIORITY_ESCALATION_MAP: dict[str, str] = {
    "low": "medium",
    "medium": "high",
    "high": "urgent",
    "urgent": "urgent",
    "critical": "urgent",
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SLAEscalationService:
    """Detects and escalates SLA-breached tickets with priority elevation and deduplicated alerts."""

    def __init__(self):
        self.slack_webhook_url = os.getenv("SLACK_WEBHOOK_URL", "")
        self.teams_webhook_url = os.getenv("TEAMS_WEBHOOK_URL", "")
        self._alert_cache: Dict[str, datetime] = {}
        self._last_error: bool = False

    def elevate_priority(self, current_priority: Optional[str]) -> str:
        """
        Elevate ticket priority:
          low -> medium -> high -> urgent
        """
        priority_clean = str(current_priority or "low").strip().lower()
        return PRIORITY_ESCALATION_MAP.get(priority_clean, "urgent")

    def is_breaching_soon(self, sla_breach_at: Optional[str], risk_score: Optional[float] = None) -> bool:
        """
        Evaluate if a ticket is breached or approaching breach:
        - risk_score >= 0.80
        - time-to-breach <= 60 minutes (3600s)
        """
        if risk_score is not None and float(risk_score) >= 0.80:
            return True
        if not sla_breach_at:
            return False
        try:
            cleaned = sla_breach_at.replace("Z", "+00:00")
            breach_dt = datetime.fromisoformat(cleaned)
            if breach_dt.tzinfo is None:
                breach_dt = breach_dt.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            delta_seconds = (breach_dt - now).total_seconds()
            return delta_seconds <= 3600  # Within 60 min or already past
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Core methods
    # ------------------------------------------------------------------

    def check_breaches(self, supabase_client, company_id: Optional[str] = None) -> list[dict]:
        """
        Query tickets where sla_breach_at is in the past (or within threshold) and status != 'resolved'.

        Args:
            supabase_client: Initialized Supabase client.
            company_id:      Optional company filter.

        Returns:
            List of breached ticket dicts.
        """
        try:
            self._last_error = False
            now_iso = _utc_now_iso()
            query = (
                supabase_client
                .table("tickets")
                .select("id, subject, category, priority, assigned_team, status, sla_breach_at, company_id, escalated, risk_score")
                .lt("sla_breach_at", now_iso)
                .neq("status", "resolved")
                .neq("status", "closed")
            )
            if company_id:
                query = query.eq("company_id", company_id)

            res = query.execute()
            tickets = res.data or []
            logger.info(f"[SLAEscalation] Found {len(tickets)} breached tickets.")
            return tickets
        except Exception as exc:
            logger.error(f"[SLAEscalation] check_breaches error: {exc}")
            self._last_error = True
            return []

    def escalate_ticket(
        self,
        supabase_client,
        ticket_id: str,
        original_team: str,
        current_priority: Optional[str] = "low"
    ) -> dict:
        """
        Escalate a ticket to the appropriate escalation team and elevate priority.

        Updates:
          - assigned_team → escalation team from ESCALATION_MAP
          - priority → elevated priority (low -> medium -> high -> urgent)
          - escalated = True
          - escalated_at = now
          - escalation_note = audit note
          - sla_alert_sent = True

        Returns:
            Updated ticket dict, or empty dict on failure.
        """
        escalation_team = ESCALATION_MAP.get(original_team, f"Escalated: {original_team}")
        new_priority = self.elevate_priority(current_priority)
        now_time = _utc_now_iso()
        
        updates = {
            "assigned_team": escalation_team,
            "priority": new_priority,
            "escalated": True,
            "escalated_at": now_time,
            "sla_alert_sent": True,
            "sla_alert_sent_at": now_time,
            "escalation_note": (
                f"Auto-escalated from '{original_team}' to '{escalation_team}' "
                f"and priority elevated from '{current_priority}' to '{new_priority}' "
                f"due to SLA breach at {now_time}"
            ),
        }
        try:
            res = (
                supabase_client
                .table("tickets")
                .update(updates)
                .eq("id", ticket_id)
                .execute()
            )
            if res.data:
                logger.info(f"[SLAEscalation] Ticket {ticket_id} escalated to {escalation_team} ({new_priority})")
                return res.data[0]
            logger.warning(f"[SLAEscalation] escalate_ticket({ticket_id}): no data returned.")
            return {}
        except Exception as exc:
            logger.error(f"[SLAEscalation] escalate_ticket({ticket_id}) failed: {exc}")
            return {}

    def send_webhook_alert(self, ticket: dict, webhook_url: str = "") -> bool:
        """
        POST an SLA breach alert to a Slack/Teams webhook with alert deduplication.

        Args:
            ticket:      Ticket dict with id, subject, priority, assigned_team.
            webhook_url: Webhook URL (defaults to SLACK_WEBHOOK_URL or TEAMS_WEBHOOK_URL).

        Returns:
            True if alert was sent successfully, False if skipped/failed.
        """
        url = webhook_url or self.slack_webhook_url or self.teams_webhook_url
        if not url:
            logger.debug("[SLAEscalation] No webhook URL configured; skipping alert.")
            return False

        ticket_id = ticket.get("id", "unknown")
        priority = ticket.get("priority", "Unknown")

        # Deduplication check: do not spam if already alerted for this ticket at this priority
        cache_key = f"{ticket_id}_{priority}"
        if cache_key in self._alert_cache:
            logger.info(f"[SLAEscalation] Alert already sent for ticket {ticket_id} ({priority}). Skipping duplicate.")
            return False

        if _requests_lib is None:
            logger.warning("[SLAEscalation] 'requests' not available; cannot send webhook.")
            return False

        subject = ticket.get("subject", "No subject")
        team = ticket.get("assigned_team", "Unknown")
        breach_at = ticket.get("sla_breach_at", "Unknown")

        payload = {
            "text": ":rotating_light: *SLA Breach Alert*",
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": (
                            f":rotating_light: *SLA Breach Detected*\n"
                            f"*Ticket:* `{ticket_id}`\n"
                            f"*Subject:* {subject}\n"
                            f"*Priority:* {priority}\n"
                            f"*Team:* {team}\n"
                            f"*SLA Breached At:* {breach_at}"
                        ),
                    },
                }
            ],
        }

        try:
            resp = _requests_lib.post(url, json=payload, timeout=10)
            resp.raise_for_status()
            logger.info(f"[SLAEscalation] Webhook alert sent for ticket {ticket_id}")
            self._alert_cache[cache_key] = datetime.now(timezone.utc)
            return True
        except Exception as exc:
            logger.warning(f"[SLAEscalation] Webhook alert failed for {ticket_id}: {exc}")
            return False

    def run_sweep(
        self,
        supabase_client,
        company_id: Optional[str] = None,
        send_alerts: bool = True,
    ) -> dict:
        """
        Full sweep: detect SLA breaches, escalate tickets, send alerts.

        Args:
            supabase_client: Initialized Supabase client.
            company_id:      Optional company filter.
            send_alerts:     Whether to send webhook notifications.

        Returns:
            Stats dict with breaches_found, escalated, alerts_sent, skipped, errors.
        """
        stats = {
            "breaches_found": 0,
            "escalated": 0,
            "alerts_sent": 0,
            "skipped_already_escalated": 0,
            "errors": 0,
        }

        try:
            self._last_error = False
            breached_tickets = self.check_breaches(supabase_client, company_id=company_id)
            if self._last_error:
                stats["errors"] += 1
                return stats

            stats["breaches_found"] = len(breached_tickets)

            for ticket in breached_tickets:
                ticket_id = ticket.get("id")
                if not ticket_id:
                    stats["errors"] += 1
                    continue

                # Skip tickets already escalated
                if ticket.get("escalated"):
                    stats["skipped_already_escalated"] += 1
                    continue

                original_team = ticket.get("assigned_team", "General Support")
                current_priority = ticket.get("priority", "low")
                updated = self.escalate_ticket(
                    supabase_client,
                    ticket_id,
                    original_team,
                    current_priority=current_priority
                )

                if updated:
                    stats["escalated"] += 1
                    if send_alerts:
                        sent = self.send_webhook_alert(ticket)
                        if sent:
                            stats["alerts_sent"] += 1
                else:
                    stats["errors"] += 1

            logger.info(
                f"[SLAEscalation] Sweep complete. "
                f"Found={stats['breaches_found']}, Escalated={stats['escalated']}, "
                f"Alerts={stats['alerts_sent']}, Skipped={stats['skipped_already_escalated']}, "
                f"Errors={stats['errors']}"
            )
        except Exception as exc:
            logger.error(f"[SLAEscalation] run_sweep fatal error: {exc}")
            stats["errors"] += 1

        return stats
