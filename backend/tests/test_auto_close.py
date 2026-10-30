import sys
import os

# Temporarily remove local directories to prevent namespace shadowing of global 'supabase' library
cwd = os.getcwd()
sys.path = [p for p in sys.path if p not in ("", cwd, os.path.dirname(cwd))]

try:
    import supabase
finally:
    # Restore sys.path and insert HELPDESK.AI root and backend directories
    sys.path.insert(0, cwd)
    backend_root = os.path.join(cwd, "backend") if "backend" not in cwd else cwd
    sys.path.insert(0, backend_root)
    sys.path.insert(0, os.path.dirname(backend_root))

import unittest
from unittest.mock import MagicMock, patch

# Configure mock environment variables before importing target class
os.environ["SUPABASE_URL"] = "https://example.supabase.co"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "mock_key"

from backend.services.auto_close_service import AutoCloseService


class TestAutoCloseService(unittest.TestCase):
    def setUp(self):
        self.env_patcher = patch.dict(os.environ, {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "mock_key",
            "AUTO_CLOSE_ENABLED": "true",
            "AUTO_CLOSE_DAYS": "7",
            "AUTO_CLOSE_CRON_SCHEDULE": "0 2 * * *",
        })
        self.env_patcher.start()
        
        self.patcher = patch("backend.services.auto_close_service.create_client")
        self.mock_create_client = self.patcher.start()
        self.mock_supabase = MagicMock()
        self.mock_create_client.return_value = self.mock_supabase
        
        self.service = AutoCloseService()

    def tearDown(self):
        self.patcher.stop()
        self.env_patcher.stop()

    def test_init(self):
        self.assertTrue(self.service.enabled)
        self.assertEqual(self.service.default_auto_close_days, 7)
        self.mock_create_client.assert_called_once_with(
            "https://example.supabase.co", "mock_key"
        )

    def test_get_system_settings_success(self):
        mock_response = MagicMock()
        mock_response.data = {
            "auto_close_days": 5,
            "auto_close_enabled": False
        }
        
        self.mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = mock_response

        settings = self.service.get_system_settings("company-uuid")
        self.assertEqual(settings["auto_close_days"], 5)
        self.assertFalse(settings["auto_close_enabled"])

    def test_get_system_settings_fallback_on_exception(self):
        self.mock_supabase.table.side_effect = Exception("DB error")

        settings = self.service.get_system_settings("company-uuid")
        self.assertEqual(settings["auto_close_days"], 7)
        self.assertTrue(settings["auto_close_enabled"])

    def test_close_ticket_success(self):
        stats = {"closed_count": 0, "error_count": 0}
        
        self.mock_supabase.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock()

        result = self.service._close_ticket("ticket-id", "company-id", stats)
        self.assertTrue(result)
        self.assertEqual(stats["closed_count"], 1)
        self.assertEqual(stats["error_count"], 0)

    def test_close_ticket_failure(self):
        stats = {"closed_count": 0, "error_count": 0}
        self.mock_supabase.table.side_effect = Exception("Update error")

        result = self.service._close_ticket("ticket-id", "company-id", stats)
        self.assertFalse(result)
        self.assertEqual(stats["closed_count"], 0)
        self.assertEqual(stats["error_count"], 1)

    def test_singleton_load(self):
        from backend.services.auto_close_service import load, get_instance
        instance = load()
        self.assertIsNotNone(instance)
        self.assertIs(get_instance(), instance)

    def test_empty_string_env_variables_fallback(self):
        """Test that empty string environment variables fallback gracefully without crashing (Issue #4104)."""
        with patch.dict(os.environ, {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""}):
            with patch("backend.services.auto_close_service.create_client") as mock_create:
                service = AutoCloseService()
                mock_create.assert_called_once_with("http://localhost", "dummy")
                self.assertIsNotNone(service)

    def test_init_exception_graceful_fallback(self):
        """Test that SupabaseException or connection error enters graceful fallback mode."""
        with patch.dict(os.environ, {"SUPABASE_URL": "invalid-url", "SUPABASE_SERVICE_ROLE_KEY": "invalid-key"}):
            with patch("backend.services.auto_close_service.create_client", side_effect=Exception("supabase_url is required")):
                service = AutoCloseService()
                self.assertIsNone(service.supabase)
                # Ensure get_company_settings does not crash when self.supabase is None
                settings = service.get_company_settings("comp-123")
                self.assertEqual(settings["auto_close_days"], 7)
                self.assertFalse(settings["auto_close_enabled"])


    def test_run_when_disabled(self):
        self.service.enabled = False
        res = self.service.run()
        self.assertEqual(res, {"status": "disabled"})


if __name__ == "__main__":
    unittest.main()
