"""
Notification Routing Middleware: Centralized gating logic for all notifications.

Ensures that email, push, and admin alert notifications respect company-level settings:
- `email_notifications`: Gate all email-based notifications (digests, alerts)
- `admin_alerts`: Gate high-priority admin escalations
- `digest_frequency`: Control digest email frequency (daily, weekly, disabled)

Features:
- Company settings caching with thread-safe locks and TTL
- Cache LRU/oldest-eviction when SETTINGS_CACHE_MAX_SIZE is reached
- UUID validation for company identifiers
- Fail-open design (allow notification if settings unavailable)
- Defensive null and missing value handling for priority and category routing (Issues #4083, #4084)
"""

import os
import logging
import threading
import uuid
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

# ---------------------------------------------------------------------------
# Global Cache Settings & Thread Safety Lock (Tested in test_notification_routing.py)
# ---------------------------------------------------------------------------
_cache_lock = threading.Lock()
SETTINGS_CACHE_TTL_SECONDS: int = int(os.getenv("NOTIFICATION_SETTINGS_CACHE_TTL", "300"))
SETTINGS_CACHE_MAX_SIZE: int = int(os.getenv("NOTIFICATION_SETTINGS_CACHE_MAX_SIZE", "500"))


class NotificationType(str, Enum):
    """Types of notifications that can be gated."""
    DAILY_DIGEST = "daily_digest"
    WEEKLY_DIGEST = "weekly_digest"
    TICKET_ALERT = "ticket_alert"
    ADMIN_ALERT = "admin_alert"
    PUSH_NOTIFICATION = "push_notification"


class NotificationRoutingMiddleware:
    """Middleware for routing and gating notifications based on company settings."""

    def __init__(self):
        """Initialize the notification routing middleware."""
        self.supabase = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        )
        self._settings_cache: Dict[str, Dict] = {}
        self.log_level = os.getenv("NOTIFICATION_ROUTING_LOG_LEVEL", "info").lower()

    def _validate_company_uuid(self, company_id: str) -> str:
        """Validates that company_id is a valid UUID string, raising ValueError if not."""
        if not company_id or not isinstance(company_id, str):
            raise ValueError(f"company_id '{company_id}' must be a valid UUID string")
        try:
            val = uuid.UUID(company_id)
            return str(val)
        except (ValueError, AttributeError, TypeError):
            raise ValueError(f"company_id '{company_id}' must be a valid UUID string")

    def _fetch_system_settings(self, company_id: str) -> Dict:
        """Fetch company settings from database with fail-open fallback."""
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
        """Get company settings with thread-safe caching, TTL expiry, and size limits."""
        valid_id = self._validate_company_uuid(company_id)
        now = datetime.now(timezone.utc)

        with _cache_lock:
            cached = self._settings_cache.get(valid_id)
            if cached:
                cached_at = cached.get("cached_at")
                if cached_at and (now - cached_at).total_seconds() < SETTINGS_CACHE_TTL_SECONDS:
                    return cached

        # Fetch fresh settings outside DB lock to prevent bottleneck
        settings = self._fetch_system_settings(valid_id)
        settings["cached_at"] = now

        with _cache_lock:
            # Enforce max size eviction if full
            if len(self._settings_cache) >= SETTINGS_CACHE_MAX_SIZE and valid_id not in self._settings_cache:
                oldest_key = min(
                    self._settings_cache.keys(),
                    key=lambda k: self._settings_cache[k].get("cached_at", now)
                )
                del self._settings_cache[oldest_key]

            self._settings_cache[valid_id] = settings
            return settings

    def should_send_email_notification(self, company_id: str, notification_type: NotificationType) -> bool:
        """Check if email notification should be sent for this company."""
        settings = self.get_system_settings(company_id)

        # Gate on global email notifications setting
        if not settings.get("email_notifications", True):
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
        """Check if admin alert/escalation should be sent for this company."""
        settings = self.get_system_settings(company_id)

        if not settings.get("admin_alerts", True):
            self.log_notification_skipped(
                company_id, NotificationType.ADMIN_ALERT, "admin_alerts_disabled"
            )
            return False

        self.log_notification_sent(company_id, NotificationType.ADMIN_ALERT)
        return True

    def should_send_push_notification(self, company_id: str) -> bool:
        """Check if push notification should be sent for this company."""
        settings = self.get_system_settings(company_id)

        if not settings.get("email_notifications", True):
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
        """Invalidate cached settings for a company."""
        with _cache_lock:
            self._settings_cache.pop(company_id, None)
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


def get_route(
    priority: Optional[str] = None,
    category: Optional[str] = None,
    company_id: Optional[str] = None,
) -> str:
    """Computes notification delivery channel based on ticket priority and category.

    Handles None, empty, and partial ticket payloads defensively (Issues #4083, #4084).
    Default priority: 'low'
    Default category: 'general'
    """
    clean_priority = str(priority or "low").strip().upper()
    clean_category = str(category or "general").strip().lower()

    # 1. Priority-based escalation
    if clean_priority in ("URGENT", "CRITICAL"):
        return "On-Call Paging Channel"
    elif clean_priority == "HIGH":
        return "SMS"
    elif clean_priority == "MEDIUM":
        return "Slack"

    # 2. Category-based routing
    if clean_category == "billing":
        return "Finance Support Team"
    elif clean_category in ("security", "soc"):
        return "Security Operations Center"
    elif clean_category in ("infrastructure", "devops"):
        return "DevOps On-Call"
    elif clean_category in ("hardware", "it"):
        return "IT Service Desk"

    # 3. Default fallback routing
    return "Email"
