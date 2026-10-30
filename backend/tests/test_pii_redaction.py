"""Self-contained tests for PII Redaction Engine.

Tests verify that all PII patterns are correctly detected and redacted,
with no false positives on safe data. Also tests the runtime toggle
and Luhn checksum validation. No external dependencies required.
"""

import sys
import os

# Add this directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.pii_redaction import (
    redact_emails,
    redact_phones,
    redact_api_keys,
    redact_credit_cards,
    redact_ssns,
    redact_ip_addresses,
    redact_all,
    redact_row,
    redact_payload,
    set_pii_redaction_enabled,
    is_pii_redaction_enabled,
    _luhn_check,
    REDACTED,
    REDACTED_SECRET,
    redact_secrets,
    calculate_shannon_entropy,
)


class TestLuhnChecksum:
    """Tests for the Luhn checksum validation used by credit card detection."""

    def test_valid_visa(self):
        # 4111 1111 1111 1111 passes Luhn
        assert _luhn_check("4111111111111111") is True

    def test_valid_amex(self):
        # 3782 822463 10005 passes Luhn
        assert _luhn_check("378282246310005") is True

    def test_invalid_numeric_string(self):
        # 1234-5678-9012-3456 does NOT pass Luhn (order ID / timestamp)
        assert _luhn_check("1234567890123456") is False

    def test_sequential_digits_fail(self):
        # 1234567890123 fails Luhn
        assert _luhn_check("1234567890123") is False

    def test_timestamp_digits_fail(self):
        # A unix timestamp like 1700000000000 (13 digits)
        assert _luhn_check("1700000000000") is False


class TestEmailRedaction:
    def test_basic_email(self):
        result = redact_emails("Contact us at user@example.com for help")
        assert REDACTED in result
        assert "user@example.com" not in result

    def test_multiple_emails(self):
        text = "CC: alice@test.com and bob@test.com"
        result = redact_emails(text)
        assert "alice@test.com" not in result
        assert "bob@test.com" not in result

    def test_no_email(self):
        text = "No email here"
        assert redact_emails(text) == text

    def test_non_string_input(self):
        assert redact_emails(12345) == 12345

    def test_subdomain_email(self):
        result = redact_emails("Email: john@mail.corporate.co.uk please")
        assert "john@mail.corporate.co.uk" not in result


class TestPhoneRedaction:
    def test_dot_format(self):
        result = redact_phones("Call 555.123.4567 now")
        assert REDACTED in result
        assert "555.123.4567" not in result

    def test_international_format(self):
        result = redact_phones("Phone: +1-555-000-1111")
        assert REDACTED in result

    def test_parentheses_format(self):
        result = redact_phones("Call (555) 123-4567")
        assert REDACTED in result

    def test_non_string_input(self):
        assert redact_phones(12345) == 12345

    def test_short_number_not_redacted(self):
        text = "The number 123 is small"
        assert redact_phones(text) == text

    def test_error_code_not_redacted(self):
        """Error codes like 40401 should NOT be redacted."""
        text = "Error code 40401 occurred"
        assert redact_phones(text) == text

    def test_port_number_not_redacted(self):
        """Port numbers like :8080 or 54321 should NOT be redacted."""
        text = "Connection on port 54321 failed"
        assert redact_phones(text) == text

    def test_bare_digit_group_not_redacted(self):
        """Bare 7-digit groups without phone formatting should not be redacted."""
        text = "Order ID 1234567 confirmed"
        assert redact_phones(text) == text

    def test_international_with_country_code(self):
        result = redact_phones("Phone: +44 20 7946 0958")
        assert REDACTED in result


class TestAPIKeyRedaction:
    def test_aws_access_key(self):
        result = redact_api_keys("Key: AKIAIOSFODNN7EXAMPLE")
        assert "AKIAIOSFODNN7EXAMPLE" not in result

    def test_github_pat(self):
        result = redact_api_keys("token: ghp_123456789012345678901234567890123456")
        assert "ghp_" not in result

    def test_google_api_key(self):
        result = redact_api_keys("API: AIzaSyA1234567890abcdefghijklmnop")
        assert "AIzaSy" not in result

    def test_stripe_key(self):
        result = redact_api_keys("Key: FAKE_STRIPE_KEY_PLACEHOLDER")
        # Should not crash, key pattern handled
        assert isinstance(result, str)

    def test_no_api_key(self):
        text = "No keys here"
        assert redact_api_keys(text) == text

    def test_bearer_token(self):
        result = redact_api_keys("Authorization: Bearer eyJhbG...ig")
        assert "eyJhbG" not in result


class TestCreditCardRedaction:
    def test_visa_format(self):
        # 4111-1111-1111-1111 passes Luhn
        result = redact_credit_cards("Card: 4111-1111-1111-1111")
        assert "4111" not in result

    def test_amex_format(self):
        # 3782-822463-10005 passes Luhn
        result = redact_credit_cards("AMEX: 3782-822463-10005")
        assert "3782" not in result

    def test_no_false_positive_on_order_id(self):
        """Order IDs that are 13-19 digits should NOT be redacted (fail Luhn)."""
        text = "Order #1234-5678-9012 is not a card"
        assert redact_credit_cards(text) == text

    def test_no_false_positive_on_timestamp(self):
        """Numeric timestamps should NOT be redacted (fail Luhn)."""
        text = "Timestamp: 1700000000000"
        assert redact_credit_cards(text) == text

    def test_no_false_positive_on_sequential_digits(self):
        """Sequential digit strings should NOT be redacted (fail Luhn)."""
        text = "Reference 1234567890123456"
        assert redact_credit_cards(text) == text


class TestSSNRedaction:
    def test_us_ssn(self):
        result = redact_ssns("SSN: 123-45-6789")
        assert "123-45-6789" not in result

    def test_no_false_positive(self):
        text = "Part 123-45 is fine"
        assert redact_ssns(text) == text


class TestIPRedaction:
    def test_public_ip(self):
        result = redact_ip_addresses("Server: 8.8.8.8")
        assert "8.8.8.8" not in result

    def test_private_ip_not_redacted(self):
        result = redact_ip_addresses("Internal: 10.0.0.1")
        assert "10.0.0.1" in result

    def test_10_network_not_redacted(self):
        result = redact_ip_addresses("Local: 10.0.0.1")
        assert "10.0.0.1" in result


class TestRedactAll:
    def test_combined_pii(self):
        text = "Email: test@test.com, Phone: +1-555-000-1111, SSN: 123-45-6789"
        result = redact_all(text)
        assert "test@test.com" not in result
        assert "123-45-6789" not in result

    def test_non_string(self):
        assert redact_all(123) == 123

    def test_preserves_non_pii(self):
        text = "Hello world, this is a normal message."
        assert redact_all(text) == text


class TestRowRedaction:
    def setup_method(self):
        # Enable redaction for these tests
        set_pii_redaction_enabled(True)

    def test_target_fields_redacted(self):
        row = {
            "id": 1,
            "contact_email": "user@test.com",
            "description": "Call +1-555-000-1111 for help",
            "subject": "Urgent: SSN 123-45-6789 leaked",
            "customer_name": "John Doe",
            "priority": "high",
        }
        result = redact_row(row)
        assert "user@test.com" not in result["contact_email"]
        assert "123-45-6789" not in result["subject"]
        assert result["id"] == 1
        assert result["priority"] == "high"

    def test_none_fields_skipped(self):
        row = {"id": 1, "contact_email": None, "description": "Safe text"}
        result = redact_row(row)
        assert result["contact_email"] is None

    def test_nested_metadata_redacted(self):
        """Nested dict fields like metadata['original_text'] should be redacted."""
        row = {
            "id": 1,
            "description": "Clean text",
            "metadata": {
                "original_text": "Contact alice@example.com for details",
                "notes": "SSN 123-45-6789 found",
            },
        }
        result = redact_row(row)
        assert "alice@example.com" not in str(result["metadata"]["original_text"])
        assert "123-45-6789" not in str(result["metadata"]["notes"])

    def test_nested_list_redacted(self):
        """Nested list values should be recursively redacted."""
        row = {
            "id": 1,
            "tags": ["Email: test@test.com", "Safe tag"],
        }
        result = redact_row(row)
        assert "test@test.com" not in str(result["tags"])

    def test_toggle_disabled_skips_redaction(self):
        """When toggle is off, redact_row returns the row unchanged."""
        set_pii_redaction_enabled(False)
        row = {"id": 1, "description": "Email: secret@test.com"}
        result = redact_row(row)
        assert result["description"] == "Email: secret@test.com"
        set_pii_redaction_enabled(True)  # restore


class TestPayloadRedaction:
    def setup_method(self):
        set_pii_redaction_enabled(True)

    def test_dict_payload(self):
        payload = {"email": "a@b.com", "subject": "SSN: 123-45-6789"}
        result = redact_payload(payload)
        assert "a@b.com" not in str(result)
        assert "123-45-6789" not in str(result)

    def test_list_payload(self):
        payload = [{"email": "x@y.com"}]
        result = redact_payload(payload)
        assert "x@y.com" not in str(result)

    def test_scalar_payload(self):
        assert redact_payload(42) == 42

    def test_nested_payload(self):
        payload = {"tickets": [{"email": "a@b.com", "subject": "SSN: 123-45-6789"}], "count": 1}
        result = redact_payload(payload)
        assert "a@b.com" not in str(result)
        assert "123-45-6789" not in str(result)
        assert result["count"] == 1

    def test_toggle_disabled_returns_unchanged(self):
        """When toggle is off, redact_payload returns the payload unchanged."""
        set_pii_redaction_enabled(False)
        payload = {"email": "secret@test.com", "subject": "SSN: 123-45-6789"}
        result = redact_payload(payload)
        assert result == payload
        set_pii_redaction_enabled(True)  # restore


class TestToggleMechanism:
    def test_default_disabled(self):
        """PII redaction toggle should be disabled by default."""
        # Reset to default
        set_pii_redaction_enabled(False)
        assert is_pii_redaction_enabled() is False

    def test_enable_disable(self):
        set_pii_redaction_enabled(True)
        assert is_pii_redaction_enabled() is True
        set_pii_redaction_enabled(False)
        assert is_pii_redaction_enabled() is False

    def test_redact_row_respects_toggle(self):
        set_pii_redaction_enabled(False)
        row = {"description": "Email: test@test.com"}
        result = redact_row(row)
        assert "test@test.com" in result["description"]
        # Re-enable
        set_pii_redaction_enabled(True)


class TestEntropyAndSecretMasking:
    """Tests for expanded PII redaction and Shannon entropy secret masking (Issue #4107)."""

    def test_shannon_entropy_calculation(self):
        # Empty string
        assert calculate_shannon_entropy("") == 0.0
        # Low entropy (repeated characters)
        low_ent = calculate_shannon_entropy("aaaaaaaaaaaaaaaa")
        assert low_ent == 0.0
        # High entropy (random cryptographic token)
        high_ent = calculate_shannon_entropy("dK9#mQ2$vL8*xP1@zT5!")
        assert high_ent > 3.5

    def test_bearer_authorization_header(self):
        dummy_tok = "ey" + "JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        sample = f"Authorization: Bearer {dummy_tok}"
        result = redact_secrets(sample, replacement=REDACTED_SECRET)
        assert REDACTED_SECRET in result
        assert "eyJhbGciOiJIUzI1Ni" not in result

    def test_bearer_custom_token(self):
        sample = "Headers: Bearer sec_token_1234567890abcdef"
        result = redact_secrets(sample, replacement=REDACTED_SECRET)
        assert REDACTED_SECRET in result
        assert "sec_token_1234567890abcdef" not in result

    def test_github_pat_redaction(self):
        sample = "My token is ghp_123456789012345678901234567890123456 for deployment"
        result = redact_secrets(sample, replacement=REDACTED_SECRET)
        assert REDACTED_SECRET in result
        assert "ghp_123456789012345678901234567890123456" not in result

    def test_aws_access_key_redaction(self):
        sample = "AWS_KEY=AKIAIOSFODNN7EXAMPLE"
        result = redact_secrets(sample, replacement=REDACTED_SECRET)
        assert REDACTED_SECRET in result
        assert "AKIAIOSFODNN7EXAMPLE" not in result

    def test_jwt_supabase_token_redaction(self):
        jwt = "ey" + "JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." + "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ." + "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        sample = f"Supabase auth token: {jwt}"
        result = redact_secrets(sample, replacement=REDACTED_SECRET)
        assert REDACTED_SECRET in result
        assert jwt not in result

    def test_entropy_based_secret_detection(self):
        # 32-char hex secret
        raw_secret = "4f8b9c2a" + "1e7d6f5a" + "3b2c1d0e" + "9f8a7b6c"
        sample = f"API secret: {raw_secret}"
        result = redact_secrets(sample, replacement=REDACTED_SECRET, use_entropy=True)
        assert REDACTED_SECRET in result
        assert raw_secret not in result

    def test_safe_text_preservation(self):
        safe_msg = "Please update ticket status to closed for customer inquiry."
        result = redact_secrets(safe_msg, replacement=REDACTED_SECRET)
        assert result == safe_msg
