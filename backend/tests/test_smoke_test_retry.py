import sys
import os
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.getcwd(), 'scripts'))
import smoke_test


class TestSmokeTestColdStartRetry:
    """Unit tests for smoke_test cold-start retry loop and progress logging."""

    def test_check_endpoint_success(self):
        """200 response should return is_ok=True and status=200."""
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.__exit__.return_value = False

        with patch("urllib.request.urlopen", return_value=mock_resp):
            ok, status, msg = smoke_test.check_endpoint("https://example.com/health")
            assert ok is True
            assert status == 200
            assert msg == "OK"

    def test_check_endpoint_http_error(self):
        """HTTP error response (e.g. 503 Service Unavailable) should return is_ok=False."""
        from urllib.error import HTTPError
        err = HTTPError("https://example.com/health", 503, "Service Unavailable", {}, None)

        with patch("urllib.request.urlopen", side_effect=err):
            ok, status, msg = smoke_test.check_endpoint("https://example.com/health")
            assert ok is False
            assert status == 503
            assert "HTTP Error 503" in msg

    def test_check_endpoint_connection_error(self):
        """URLError (connection refused/timeout) should return is_ok=False and status=0."""
        from urllib.error import URLError
        err = URLError("Connection refused")

        with patch("urllib.request.urlopen", side_effect=err):
            ok, status, msg = smoke_test.check_endpoint("https://example.com/health")
            assert ok is False
            assert status == 0
            assert "Connection Error" in msg

    def test_wait_for_cold_boot_eventual_success(self):
        """Service starts cold, fails first 2 attempts, then wakes up and passes."""
        # 1st loop: /health fails, /docs fails
        # 2nd loop: /health passes, /docs fails
        # 3rd loop: both pass
        call_count = {"health": 0, "docs": 0}

        def mock_check(url, timeout=10.0):
            if "/health" in url:
                call_count["health"] += 1
                if call_count["health"] < 3:
                    return False, 503, "Waking up"
                return True, 200, "OK"
            elif "/docs" in url:
                call_count["docs"] += 1
                if call_count["docs"] < 3:
                    return False, 503, "Waking up"
                return True, 200, "OK"
            return False, 404, "Not found"

        with patch("smoke_test.check_endpoint", side_effect=mock_check), \
             patch("time.sleep", return_value=None):
            result = smoke_test.wait_for_cold_boot(
                base_url="https://mock-space.hf.space",
                timeout=60.0,
                interval=0.01,
                endpoints=["/health", "/docs"]
            )
            assert result is True
            assert call_count["health"] == 3
            assert call_count["docs"] == 3

    def test_wait_for_cold_boot_timeout_exceeded(self):
        """When service remains unavailable beyond timeout, returns False."""
        with patch("smoke_test.check_endpoint", return_value=(False, 503, "Booting")), \
             patch("time.sleep", return_value=None):
            # Set short timeout of 0.05s
            result = smoke_test.wait_for_cold_boot(
                base_url="https://stuck-space.hf.space",
                timeout=0.02,
                interval=0.01
            )
            assert result is False

    def test_main_cli_with_url_argument(self):
        """Verify CLI main correctly passes arguments to wait_for_cold_boot."""
        test_args = [
            "smoke_test.py",
            "--url", "https://custom.hf.space",
            "--timeout", "30",
            "--interval", "2",
            "--skip-import"
        ]
        with patch.object(sys, "argv", test_args), \
             patch("smoke_test.wait_for_cold_boot", return_value=True) as mock_wait, \
             patch("sys.exit") as mock_exit:
            smoke_test.main()
            mock_wait.assert_called_once_with(
                base_url="https://custom.hf.space",
                timeout=30.0,
                interval=2.0
            )
            mock_exit.assert_called_once_with(0)

    def test_main_cli_timeout_exits_code_1(self):
        """Verify that when cold boot times out, main exits with code 1."""
        test_args = [
            "smoke_test.py",
            "--url", "https://failing.hf.space",
            "--skip-import"
        ]
        with patch.object(sys, "argv", test_args), \
             patch("smoke_test.wait_for_cold_boot", return_value=False), \
             patch("sys.exit") as mock_exit:
            smoke_test.main()
            mock_exit.assert_called_once_with(1)
