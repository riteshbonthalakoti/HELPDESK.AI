"""
Unit tests for NotificationRoutingMiddleware (backend/services/notification_routing.py).

Covers:
- should_send_email_notification with all NotificationType variants
- should_send_admin_alert enabled / disabled / None
- should_send_push_notification enabled / disabled
- Company settings caching and cache invalidation
- Fail-open behaviour when Supabase is unreachable
- Digest frequency gating (daily vs weekly vs disabled)
- UUID validation for company_id
- Cache TTL expiration
- Cache max size eviction
"""

import pytest
from unittest.mock import MagicMock, patch, PropertyMock
from datetime import datetime, timezone, timedelta
import sys
import os
import time

# Ensure the backend directory is on the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.notification_routing import (
    NotificationRoutingMiddleware,
    NotificationType,
)

VALID_CO_UUID = "12345678-1234-5678-1234-567812345678"
VALID_CO_UUID_2 = "87654321-4321-8765-4321-876543210987"
VALID_CO_UUID_3 = "11111111-2222-3333-4444-555555555555"

@pytest.fixture
def mock_supabase():
    """Create a mocked Supabase client."""
    client = MagicMock()
    return client


@pytest.fixture
def middleware(mock_supabase):
    """Create a NotificationRoutingMiddleware with a mocked Supabase client."""
    with patch("services.notification_routing.create_client", return_value=mock_supabase):
        m = NotificationRoutingMiddleware()
        m.supabase = mock_supabase
        return m


def _make_settings(email=True, admin=True, digest="daily"):
    """Helper to build a settings dict."""
    return {
        "email_notifications": email,
        "admin_alerts": admin,
        "digest_frequency": digest,
    }


def _mock_settings_response(settings):
    """Wrap settings in a mock Supabase response."""
    resp = MagicMock()
    resp.data = settings
    return resp


# ---------------------------------------------------------------------------
# should_send_email_notification
# ---------------------------------------------------------------------------

class TestShouldSendEmailNotification:
    """Tests for should_send_email_notification."""

    def test_allows_ticket_alert_when_email_enabled(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings())

        result = middleware.should_send_email_notification(VALID_CO_UUID, NotificationType.TICKET_ALERT)
        assert result is True

    def test_blocks_ticket_alert_when_email_disabled(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings(email=False))

        result = middleware.should_send_email_notification(VALID_CO_UUID, NotificationType.TICKET_ALERT)
        assert result is False

    def test_allows_daily_digest_when_frequency_is_daily(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings(digest="daily"))

        result = middleware.should_send_email_notification(VALID_CO_UUID, NotificationType.DAILY_DIGEST)
        assert result is True

    def test_blocks_weekly_digest_when_frequency_is_daily(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings(digest="daily"))

        result = middleware.should_send_email_notification(VALID_CO_UUID, NotificationType.WEEKLY_DIGEST)
        assert result is False

    def test_allows_weekly_digest_when_frequency_is_weekly(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings(digest="weekly"))

        result = middleware.should_send_email_notification(VALID_CO_UUID, NotificationType.WEEKLY_DIGEST)
        assert result is True

    def test_blocks_daily_digest_when_frequency_is_disabled(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings(digest="disabled"))

        result = middleware.should_send_email_notification(VALID_CO_UUID, NotificationType.DAILY_DIGEST)
        assert result is False

    def test_blocks_weekly_digest_when_frequency_is_disabled(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings(digest="disabled"))

        result = middleware.should_send_email_notification(VALID_CO_UUID, NotificationType.WEEKLY_DIGEST)
        assert result is False

    def test_allows_admin_alert_type_when_email_enabled(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings())

        result = middleware.should_send_email_notification(VALID_CO_UUID, NotificationType.ADMIN_ALERT)
        assert result is True


# ---------------------------------------------------------------------------
# should_send_admin_alert
# ---------------------------------------------------------------------------

class TestShouldSendAdminAlert:
    """Tests for should_send_admin_alert."""

    def test_allows_when_admin_alerts_enabled(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings(admin=True))

        result = middleware.should_send_admin_alert(VALID_CO_UUID)
        assert result is True

    def test_blocks_when_admin_alerts_disabled(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings(admin=False))

        result = middleware.should_send_admin_alert(VALID_CO_UUID)
        assert result is False

    def test_blocks_when_admin_alerts_is_none(self, middleware, mock_supabase):
        settings = _make_settings()
        settings["admin_alerts"] = None
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(settings)

        result = middleware.should_send_admin_alert(VALID_CO_UUID)
        assert result is False


# ---------------------------------------------------------------------------
# should_send_push_notification
# ---------------------------------------------------------------------------

class TestShouldSendPushNotification:
    """Tests for should_send_push_notification."""

    def test_allows_push_when_email_enabled(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings(email=True))

        result = middleware.should_send_push_notification(VALID_CO_UUID)
        assert result is True

    def test_blocks_push_when_email_disabled(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings(email=False))

        result = middleware.should_send_push_notification(VALID_CO_UUID)
        assert result is False


# ---------------------------------------------------------------------------
# Caching & Cache Safety
# ---------------------------------------------------------------------------

class TestCaching:
    """Tests for settings caching behaviour."""

    def test_settings_are_cached(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings())

        # First call fetches from DB
        s1 = middleware.get_system_settings(VALID_CO_UUID)
        # Second call should use cache (DB not called again)
        s2 = middleware.get_system_settings(VALID_CO_UUID)

        assert s1 == s2
        # Supabase table should only be queried once
        assert mock_supabase.table.call_count == 1

    def test_cache_invalidation(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings())

        middleware.get_system_settings(VALID_CO_UUID)
        middleware.invalidate_cache(VALID_CO_UUID)

        # After invalidation, next call should hit DB again
        middleware.get_system_settings(VALID_CO_UUID)
        assert mock_supabase.table.call_count == 2

    def test_invalidate_nonexistent_company_does_not_error(self, middleware):
        # Should not raise
        middleware.invalidate_cache(VALID_CO_UUID)

    def test_uuid_validation_raises_on_invalid_format(self, middleware):
        with pytest.raises(ValueError) as exc:
            middleware.get_system_settings("invalid-uuid-string")
        assert "must be a valid UUID string" in str(exc.value)

    def test_cache_ttl_expiration(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings())

        # Load into cache
        middleware.get_system_settings(VALID_CO_UUID)
        assert mock_supabase.table.call_count == 1

        # Modify cached_at to be older than TTL
        from services import notification_routing
        with notification_routing._cache_lock:
            middleware._settings_cache[VALID_CO_UUID]["cached_at"] = (
                datetime.now(timezone.utc) - timedelta(seconds=notification_routing.SETTINGS_CACHE_TTL_SECONDS + 1)
            )

        # Next call should be cache miss due to TTL expiration
        middleware.get_system_settings(VALID_CO_UUID)
        assert mock_supabase.table.call_count == 2

    def test_cache_max_size_eviction(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value = _mock_settings_response(_make_settings())

        from services import notification_routing
        # Force a small max size for testing
        original_max = notification_routing.SETTINGS_CACHE_MAX_SIZE
        notification_routing.SETTINGS_CACHE_MAX_SIZE = 2

        try:
            # Query for 3 different UUIDs
            middleware.get_system_settings(VALID_CO_UUID)
            middleware.get_system_settings(VALID_CO_UUID_2)
            assert len(middleware._settings_cache) == 2

            # This should trigger eviction of the oldest (VALID_CO_UUID)
            middleware.get_system_settings(VALID_CO_UUID_3)
            assert len(middleware._settings_cache) == 2
            assert VALID_CO_UUID not in middleware._settings_cache
            assert VALID_CO_UUID_2 in middleware._settings_cache
            assert VALID_CO_UUID_3 in middleware._settings_cache
        finally:
            notification_routing.SETTINGS_CACHE_MAX_SIZE = original_max


# ---------------------------------------------------------------------------
# Fail-open behaviour
# ---------------------------------------------------------------------------

class TestFailOpen:
    """Tests for fail-open when Supabase is unreachable."""

    def test_fail_open_on_db_error(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.side_effect = Exception("Connection refused")

        settings = middleware.get_system_settings(VALID_CO_UUID)
        # Should get defaults (all enabled)
        assert settings["email_notifications"] is True
        assert settings["admin_alerts"] is True
        assert settings["digest_frequency"] == "daily"

    def test_fail_open_allows_notification(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.side_effect = Exception("DB down")

        result = middleware.should_send_email_notification(VALID_CO_UUID, NotificationType.TICKET_ALERT)
        assert result is True

    def test_fail_open_allows_admin_alert(self, middleware, mock_supabase):
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.side_effect = Exception("DB down")

        result = middleware.should_send_admin_alert(VALID_CO_UUID)
        assert result is True


# ---------------------------------------------------------------------------
# NotificationType enum
# ---------------------------------------------------------------------------

class TestNotificationType:
    """Tests for the NotificationType enum."""

    def test_all_values_exist(self):
        assert NotificationType.DAILY_DIGEST.value == "daily_digest"
        assert NotificationType.WEEKLY_DIGEST.value == "weekly_digest"
        assert NotificationType.TICKET_ALERT.value == "ticket_alert"
        assert NotificationType.ADMIN_ALERT.value == "admin_alert"
        assert NotificationType.PUSH_NOTIFICATION.value == "push_notification"

    def test_enum_is_string_subclass(self):
        assert isinstance(NotificationType.DAILY_DIGEST, str)


class TestGetRoute:
    def test_get_route_high(self):
        from services.notification_routing import get_route
        assert get_route('HIGH') == 'SMS'

    def test_get_route_medium(self):
        from services.notification_routing import get_route
        assert get_route('MEDIUM') == 'Slack'

    def test_get_route_low(self):
        from services.notification_routing import get_route
        assert get_route('LOW') == 'Email'

    def test_get_route_none(self):
        from services.notification_routing import get_route
        assert get_route(None) == 'Email'

    def test_get_route_urgent_escalation(self):
        from services.notification_routing import get_route
        assert get_route('urgent') == 'On-Call Paging Channel'
        assert get_route('CRITICAL') == 'On-Call Paging Channel'

    def test_get_route_category_routing(self):
        from services.notification_routing import get_route
        assert get_route(priority='low', category='billing') == 'Finance Support Team'
        assert get_route(priority=None, category='security') == 'Security Operations Center'
        assert get_route(priority='low', category='infrastructure') == 'DevOps On-Call'
        assert get_route(category='hardware') == 'IT Service Desk'

    def test_get_route_unknown_category_fallback(self):
        from services.notification_routing import get_route
        assert get_route(category='unknown_custom_service') == 'Email'
        assert get_route(priority=None, category=None, company_id=None) == 'Email'

