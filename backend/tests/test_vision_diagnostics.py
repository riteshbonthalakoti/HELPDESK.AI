"""
Unit tests for multi-modal Gemini Vision Diagnostics (Issue #4114).
Tests screenshot diagnostic extraction, error code recovery, fallback handling,
and structured JSON response parsing.
"""

import sys
import os

# Filter out repo root so real site-packages numpy is imported instead of root dummy shim
_repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path = [p for p in sys.path if os.path.abspath(p) != _repo_root and p != ""]
_backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

import json
import pytest
from unittest.mock import MagicMock, patch

from services.gemini_service import GeminiService


# 1x1 valid transparent PNG base64 string for testing
VALID_PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


@pytest.fixture
def gemini_svc():
    """Create a test instance of GeminiService with mocked client."""
    svc = GeminiService()
    svc.api_key = "test_fake_api_key"
    svc._initialized = True
    svc.client = MagicMock()
    return svc


class TestVisionDiagnostics:
    """Test suite for GeminiService.diagnose_screenshot."""

    def test_diagnose_screenshot_uninitialized_fallback(self):
        """When Gemini is not initialized, return degraded structured response."""
        svc = GeminiService()
        svc._initialized = False
        svc.client = None

        result = svc.diagnose_screenshot(VALID_PNG_BASE64)
        assert result["detected_application"] == "Unknown Application"
        assert result["error_code"] is None
        assert "unavailable" in result["root_cause_hypothesis"].lower()
        assert result["status"] == "degraded"

    def test_diagnose_screenshot_empty_or_whitespace_input(self, gemini_svc):
        """Empty or whitespace-only image strings return invalid_input without API call."""
        for empty_val in ["", "   ", "\t\n", None]:
            result = gemini_svc.diagnose_screenshot(empty_val)
            assert result["status"] == "invalid_input"
            assert result["error_code"] is None
            assert result["detected_application"] == "None"

        assert gemini_svc.client.models.generate_content.call_count == 0

    def test_diagnose_screenshot_valid_json_response(self, gemini_svc):
        """Standard valid JSON response is parsed into expected schema."""
        mock_response = MagicMock()
        mock_response.text = json.dumps({
            "detected_application": "Microsoft Outlook",
            "error_code": "0x8004010F",
            "root_cause_hypothesis": "The Outlook data file (.ost) is missing or inaccessible.",
            "recommended_remediation": "Recreate the user mail profile via Control Panel > Mail."
        })
        gemini_svc.client.models.generate_content.return_value = mock_response

        result = gemini_svc.diagnose_screenshot(VALID_PNG_BASE64, text="User cannot open inbox")
        assert result["status"] == "success"
        assert result["detected_application"] == "Microsoft Outlook"
        assert result["error_code"] == "0x8004010F"
        assert "data file" in result["root_cause_hypothesis"]
        assert "Recreate" in result["recommended_remediation"]

    def test_diagnose_screenshot_with_markdown_fences(self, gemini_svc):
        """Markdown code block formatting (```json ... ```) is cleanly stripped."""
        raw_json = json.dumps({
            "detected_application": "Windows Terminal",
            "error_code": "0x80070002",
            "root_cause_hypothesis": "The specified command or executable was not found.",
            "recommended_remediation": "Verify the command path and environment PATH variables."
        })
        mock_response = MagicMock()
        mock_response.text = f"```json\n{raw_json}\n```"
        gemini_svc.client.models.generate_content.return_value = mock_response

        result = gemini_svc.diagnose_screenshot(VALID_PNG_BASE64)
        assert result["status"] == "success"
        assert result["detected_application"] == "Windows Terminal"
        assert result["error_code"] == "0x80070002"

    def test_diagnose_screenshot_regex_recovery_on_malformed_json(self, gemini_svc):
        """If response text contains malformed JSON, regex fallback extracts fields."""
        mock_response = MagicMock()
        # Simulating broken JSON with invalid trailing syntax
        mock_response.text = (
            'Here is the diagnosis:\n'
            '{\n'
            '  "detected_application": "Blue Screen (BSOD)",\n'
            '  "error_code": "CRITICAL_PROCESS_DIED",\n'
            '  "root_cause_hypothesis": "A critical system process terminated unexpectedly.",\n'
            '  "recommended_remediation": "Run SFC /scannow and verify disk health."\n'
            '} (Note: additional telemetry text)'
        )
        gemini_svc.client.models.generate_content.return_value = mock_response

        result = gemini_svc.diagnose_screenshot(VALID_PNG_BASE64)
        assert result["status"] == "partial_json_recovered"
        assert result["detected_application"] == "Blue Screen (BSOD)"
        assert result["error_code"] == "CRITICAL_PROCESS_DIED"
        assert "critical system process" in result["root_cause_hypothesis"]
        assert "SFC" in result["recommended_remediation"]

    def test_diagnose_screenshot_null_error_code(self, gemini_svc):
        """Null error code is handled as None."""
        mock_response = MagicMock()
        mock_response.text = json.dumps({
            "detected_application": "Chrome Browser",
            "error_code": None,
            "root_cause_hypothesis": "Website certificate untrusted or expired.",
            "recommended_remediation": "Check the system clock and install root certificates."
        })
        gemini_svc.client.models.generate_content.return_value = mock_response

        result = gemini_svc.diagnose_screenshot(VALID_PNG_BASE64)
        assert result["status"] == "success"
        assert result["error_code"] is None
        assert result["detected_application"] == "Chrome Browser"

    def test_diagnose_screenshot_with_data_uri_prefix(self, gemini_svc):
        """Accepts base64 strings prefixed with data:image/png;base64."""
        mock_response = MagicMock()
        mock_response.text = json.dumps({
            "detected_application": "Slack",
            "error_code": None,
            "root_cause_hypothesis": "WebSocket connection failure.",
            "recommended_remediation": "Check firewall rules."
        })
        gemini_svc.client.models.generate_content.return_value = mock_response

        data_uri = f"data:image/png;base64,{VALID_PNG_BASE64}"
        result = gemini_svc.diagnose_screenshot(data_uri)
        assert result["status"] == "success"
        assert result["detected_application"] == "Slack"

    def test_diagnose_screenshot_corrupt_base64_returns_error(self, gemini_svc):
        """Corrupt base64 data returns error status without unhandled exception."""
        result = gemini_svc.diagnose_screenshot("not_a_valid_base64_string_!!!")
        assert result["status"] == "error"
        assert "Unknown" in result["detected_application"]
        assert result["error_code"] is None
        assert "Diagnostics failed" in result["root_cause_hypothesis"]

    def test_analyze_image_signature_compatibility(self, gemini_svc):
        """Verifies analyze_image accepts both 1-arg and 2-arg calls without TypeError."""
        mock_response = MagicMock()
        mock_response.text = "Description: BSOD screen\nOCR: STOP 0x0000007B\nProblem: Boot device inaccessible"
        gemini_svc.client.models.generate_content.return_value = mock_response

        # 1-argument call
        res1 = gemini_svc.analyze_image(VALID_PNG_BASE64)
        assert "image_description" in res1
        assert "ocr_text" in res1

        # 2-argument call
        res2 = gemini_svc.analyze_image(VALID_PNG_BASE64, "User reports boot failure")
        assert "image_description" in res2
        assert "ocr_text" in res2
