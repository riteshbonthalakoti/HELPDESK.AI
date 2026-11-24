"""
Notification Routing Middleware: Centralized gating logic for all notifications.

Ensures that email, push, and admin alert notifications respect company-level settings:
- `email_notifications`: Gate all email-based notifications (digests, alerts)
- `admin_alerts`: Gate high-priority admin escalations
- `digest_frequency`: Control digest email frequency (daily, weekly, disabled)

Features:
- Company settings caching to reduce DB queries
- Audit logging for all notification decisions
- Fail-open design (allow notification if settings unavailable)
- Reusable for all notification trigger points
"""

import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict
from enum import Enum

from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

handler = logging.StreamHandler()
formatter = logging.Formatter("[NotificationRouting] %(asctime)s - %(levelname)s - %(message)s")
handler.setFormatter(formatter)
logger.addHandler(handler)


class NotificationType(str, Enum):
    """Types of notifications that can be gated."""
    DAILY_DIGEST = "daily_digest"
    WEEKLY_DIGEST = "weekly_digest"
    TICKET_ALERT = "ticket_alert"
    ADMIN_ALERT = "admin_alert"
    PUSH_NOTIFICATION = "push_notification"


class NotificationRoutingMiddleware:
    """Middleware for routing and gating notifications based on company settings."""

# NOTE: method names updated from `*_company_settings` to `*_system_settings` to match
# the new schema. The database table and column names are `system_settings`,
# `email_notifications`, and `admin_alerts`.

    def __init__(self):
        """Initialize the notification routing middleware."""
        url = os.getenv("SUPABASE_URL") or "https://mock.supabase.co"
        key = (
            os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or os.getenv("SUPABASE_SERVICE_KEY")
            or "dummy"
        )
        self.supabase = create_client(url, key)
        self._settings_cache: Dict[str, Dict] = {}
        self._settings_cached_at: Dict[str, datetime] = {}
        self.cache_ttl = timedelta(
            seconds=max(1, int(os.getenv("NOTIFICATION_SETTINGS_CACHE_TTL", "300")))
        )
        self.log_level = os.getenv("NOTIFICATION_ROUTING_LOG_LEVEL", "info").lower()

    def _fetch_system_settings(self, company_id: str) -> Dict:
        """
        Fetch company settings from database.
        
        Args:
            company_id: UUID of company
            
        Returns:
            Dict with `email_notifications`, `admin_alerts`, `digest_frequency`
        """
        try:
            response = self.supabase.table("system_settings").select(
                "email_notifications, admin_alerts, digest_frequency"
            ).eq("company_id", company_id).single().execute()

            if response.data:
                return {
                    "email_notifications": response.data.get("email_notifications", True),
                    "admin_alerts": response.data.get("admin_alerts", True),
                    "digest_frequency": response.data.get("digest_frequency", "daily")
                }
        except Exception as e:
            logger.warning(f"Could not fetch company settings for {company_id}: {str(e)}")

        # Fail-open: allow notifications if settings unavailable
        return {
            "email_notifications": True,
            "admin_alerts": True,
            "digest_frequency": "daily"
        }

    def get_system_settings(self, company_id: str) -> Dict:
        """
        Get company settings with caching.
        
        Args:
            company_id: UUID of company
            
        Returns:
            Dict with company notification preferences
        """
        cached_at = self._settings_cached_at.get(company_id)
        cache_expired = not cached_at or datetime.now(timezone.utc) - cached_at >= self.cache_ttl
        if company_id not in self._settings_cache or cache_expired:
            self._settings_cache[company_id] = self._fetch_system_settings(company_id)
            self._settings_cached_at[company_id] = datetime.now(timezone.utc)
        return self._settings_cache[company_id]

    def should_send_email_notification(self, company_id: str, notification_type: NotificationType) -> bool:
        """
        Check if email notification should be sent for this company.
        
        Args:
            company_id: UUID of company
            notification_type: Type of notification to send
            
        Returns:
            True if notification should be sent, False otherwise
        """
        settings = self.get_system_settings(company_id)

        # Gate on global email notifications setting
        if not settings["email_notifications"]:
            self.log_notification_skipped(
                company_id, notification_type, "email_notifications_disabled"
            )
            return False

        # Check digest-specific frequency settings
        if notification_type in [NotificationType.DAILY_DIGEST, NotificationType.WEEKLY_DIGEST]:
            digest_frequency = settings.get("digest_frequency", "daily")
            
            if digest_frequency == "disabled":
                self.log_notification_skipped(
                    company_id, notification_type, "digest_frequency_disabled"
                )
                return False

            if notification_type == NotificationType.WEEKLY_DIGEST and digest_frequency == "daily":
                self.log_notification_skipped(
                    company_id, notification_type, "digest_frequency_mismatch"
                )
                return False

        self.log_notification_sent(company_id, notification_type)
        return True

    def should_send_admin_alert(self, company_id: str) -> bool:
        """
        Check if admin alert/escalation should be sent for this company.
        
        Args:
            company_id: UUID of company
            
        Returns:
            True if alert should be sent, False otherwise
        """
        settings = self.get_system_settings(company_id)

        if not settings["admin_alerts"]:
            self.log_notification_skipped(
                company_id, NotificationType.ADMIN_ALERT, "admin_alerts_disabled"
            )
            return False

        self.log_notification_sent(company_id, NotificationType.ADMIN_ALERT)
        return True

    def should_send_push_notification(self, company_id: str) -> bool:
        """
        Check if push notification should be sent for this company.
        
        Args:
            company_id: UUID of company
            
        Returns:
            True if notification should be sent, False otherwise
        """
        settings = self.get_system_settings(company_id)

        # Push notifications typically gated by email_notifications
        if not settings["email_notifications"]:
            self.log_notification_skipped(
                company_id, NotificationType.PUSH_NOTIFICATION, "notifications_disabled"
            )
            return False

        self.log_notification_sent(company_id, NotificationType.PUSH_NOTIFICATION)
        return True

    def log_notification_sent(self, company_id: str, notification_type: NotificationType) -> None:
        """Log that a notification was sent."""
        if self.log_level in ["debug", "info"]:
            logger.info(
                f"Notification sent | company={company_id} | type={notification_type.value} | "
                f"timestamp={datetime.now(timezone.utc).isoformat()}"
            )

    def log_notification_skipped(
        self, company_id: str, notification_type: NotificationType, reason: str
    ) -> None:
        """Log that a notification was skipped."""
        if self.log_level in ["debug", "info", "warning"]:
            logger.warning(
                f"Notification skipped | company={company_id} | type={notification_type.value} | "
                f"reason={reason} | timestamp={datetime.now(timezone.utc).isoformat()}"
            )

    def log_notification_error(
        self, company_id: str, notification_type: NotificationType, error: Exception
    ) -> None:
        """Log notification sending error."""
        logger.error(
            f"Notification error | company={company_id} | type={notification_type.value} | "
            f"error={str(error)} | timestamp={datetime.now(timezone.utc).isoformat()}"
        )

    def invalidate_cache(self, company_id: str) -> None:
        """
        Invalidate cached settings for a company.
        Call this after updating system_settings in DB.
        
        Args:
            company_id: UUID of company
        """
        if company_id in self._settings_cache:
            del self._settings_cache[company_id]
            self._settings_cached_at.pop(company_id, None)
            logger.info(f"Invalidated settings cache for company {company_id}")


# Singleton instance
_instance: Optional[NotificationRoutingMiddleware] = None


def load():
    """Load and return singleton instance of NotificationRoutingMiddleware."""
    global _instance
    if _instance is None:
        _instance = NotificationRoutingMiddleware()
        logger.info("NotificationRoutingMiddleware loaded")
    return _instance


def get_instance() -> Optional[NotificationRoutingMiddleware]:
    """Get the singleton instance if already loaded."""
    return _instance


def get_route(priority: str = None, category: str = None) -> str:
    if not priority:
        return 'Email'
    priority = priority.upper()
    if priority == 'HIGH':
        return 'SMS'
    elif priority == 'MEDIUM':
        return 'Slack'
    return 'Email'

