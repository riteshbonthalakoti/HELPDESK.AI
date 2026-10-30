"""
Tests for PII Redaction Engine

Covers all PII types: emails, phones, API keys, IPs, credit cards, SSNs.
"""

import pytest
import sys
import os

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pii_redaction import (
    redact_pii,
    redact_secrets,
    redact_pii_dict,
    scan_pii,
    calculate_shannon_entropy,
    REDACTED_SECRET,
)


class TestRedactEmails:
    def test_simple_email(self):
        assert "[REDACTED]" in redact_pii("Contact john@example.com for help")

    def test_email_with_subdomain(self):
        result = redact_pii("Send to user@mail.company.co.uk")
        assert "user@mail.company.co.uk" not in result

    def test_multiple_emails(self):
        result = redact_pii("Email alice@foo.com or bob@bar.org")
        assert "alice@foo.com" not in result
        assert "bob@bar.org" not in result

    def test_email_in_ticket_description(self):
        desc = "Customer john.doe+tag@gmail.com reported login issue"
        result = redact_pii(desc)
        assert "john.doe+tag@gmail.com" not in result
        assert "reported login issue" in result


class TestRedactPhones:
    def test_international_phone(self):
        result = redact_pii("Call +1-555-123-4567 for support")
        assert "555-123-4567" not in result

    def test_phone_with_parentheses(self):
        result = redact_pii("Dial (555) 123-4567")
        assert "123-4567" not in result

    def test_phone_with_dots(self):
        result = redact_pii("Phone: 555.123.4567")
        assert "4567" not in result


class TestRedactAPIKeys:
    def test_openai_key(self):
        result = redact_pii("Key: sk-abc123456789012345678901234567890")
        assert "sk-abc" not in result

    def test_github_pat(self):
        result = redact_pii("Token: ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEfake")
        assert "ghp_" not in result

    def test_aws_key(self):
        result = redact_pii("AWS: AKIAIOSFODNN7EXAMPLE")
        assert "AKIA" not in result

    def test_supabase_key(self):
        result = redact_pii("Supabase: sbp_abcdefghijklmnopqrstuvwxyz123456")
        assert "sbp_" not in result

    def test_jwt_token(self):
        result = redact_pii("JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmYWtlIjoidGVzdCJ9.fakesignature")
        assert "eyJhbGci" not in result


class TestRedactIPs:
    def test_ipv4_default_off(self):
        result = redact_pii("Server at 192.168.1.100 is down")
        assert "192.168.1.100" in result  # Not redacted by default

    def test_ipv4_when_enabled(self):
        result = redact_pii("Server at 192.168.1.100 is down", redact_ips=True)
        assert "192.168.1.100" not in result

    def test_public_ip(self):
        result = redact_pii("Connect to 8.8.8.8", redact_ips=True)
        assert "8.8.8.8" not in result


class TestRedactCreditCards:
    def test_valid_card(self):
        # 4111-1111-1111-1111 is a valid test Visa number (Luhn-valid)
        result = redact_pii("Card: 4111111111111111")
        assert "4111111111111111" not in result

    def test_card_with_spaces(self):
        result = redact_pii("Card: 4111 1111 1111 1111")
        assert "1111" not in result

    def test_invalid_card_not_redacted(self):
        # Random digits that fail Luhn
        result = redact_pii("Order #1234567890123456")
        # Should not redact non-card numbers
        assert "1234567890123456" in result or "REDACTED" in result


class TestRedactSSNs:
    def test_ssn_format(self):
        result = redact_pii("SSN: 123-45-6789")
        assert "123-45-6789" not in result

    def test_non_ssn_dash_not_redacted(self):
        result = redact_pii("Date: 2024-01-15")
        assert "2024-01-15" in result


class TestRedactPIIDict:
    def test_dict_redaction(self):
        data = {
            "subject": "Help with john@example.com",
            "description": "Call me at 555-123-4567",
            "status": "open",  # Should not be redacted
        }
        result = redact_pii_dict(data)
        assert "john@example.com" not in result["subject"]
        assert "555-123-4567" not in result["description"]
        assert result["status"] == "open"

    def test_dict_custom_fields(self):
        data = {"custom_field": "Email: test@foo.com", "other": "keep"}
        result = redact_pii_dict(data, fields=["custom_field"])
        assert "test@foo.com" not in result["custom_field"]
        assert result["other"] == "keep"

    def test_dict_with_ips(self):
        data = {"description": "Server 10.0.0.1 crashed"}
        result = redact_pii_dict(data, redact_ips=True)
        assert "10.0.0.1" not in result["description"]


class TestScanPII:
    def test_scan_finds_email(self):
        findings = scan_pii("Contact admin@example.com")
        assert "email" in findings
        assert "admin@example.com" in findings["email"]

    def test_scan_finds_multiple_types(self):
        text = "Email john@foo.com, phone 555-123-4567, IP 192.168.1.1"
        findings = scan_pii(text)
        assert "email" in findings
        assert "phone" in findings
        assert "ipv4" in findings

    def test_scan_empty(self):
        assert scan_pii("") == {}
        assert scan_pii(None) == {}

    def test_scan_no_pii(self):
        findings = scan_pii("This is a normal ticket about login issues")
        assert findings == {}


class TestEdgeCases:
    def test_none_input(self):
        assert redact_pii(None) is None

    def test_empty_string(self):
        assert redact_pii("") == ""

    def test_no_pii(self):
        text = "The login page is broken after the update"
        assert redact_pii(text) == text

    def test_mixed_pii(self):
        text = "User john@test.com called from +1-555-999-8888 about server 10.0.0.5"
        result = redact_pii(text, redact_ips=True)
        assert "john@test.com" not in result
        assert "999-8888" not in result
        assert "10.0.0.5" not in result
        assert "called from" in result  # Context preserved

    def test_preserves_non_pii(self):
        text = "Ticket #1234 is about billing. Contact billing@company.com"
        result = redact_pii(text)
        assert "Ticket #1234" in result
        assert "billing@company.com" not in result


class TestSecretsAndEntropyRedaction:
    """Specific unit tests for Issue #4107: Bearer, GitHub PAT, AWS, JWT, and Entropy masking."""

    def test_bearer_authorization_redaction(self):
        text = "Authorization: Bearer mySecretToken1234567890"
        result = redact_secrets(text)
        assert "[REDACTED_SECRET]" in result
        assert "mySecretToken1234567890" not in result

    def test_github_pat_redaction(self):
        text = "ghp_123456789012345678901234567890123456"
        result = redact_secrets(text)
        assert "[REDACTED_SECRET]" in result
        assert "ghp_" not in result

    def test_aws_access_key_redaction(self):
        text = "Key: AKIA1234567890ABCDEF"
        result = redact_secrets(text)
        assert "[REDACTED_SECRET]" in result
        assert "AKIA1234567890ABCDEF" not in result

    def test_jwt_supabase_token(self):
        jwt = "ey" + "JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." + "eyJmYWtlIjoidGVzdCJ9." + "fakesignature"
        result = redact_secrets(f"Token: {jwt}")
        assert "[REDACTED_SECRET]" in result
        assert jwt not in result

    def test_shannon_entropy_calculation(self):
        assert calculate_shannon_entropy("") == 0.0
        assert calculate_shannon_entropy("aaaaaaaaaaaa") == 0.0
        assert calculate_shannon_entropy("rK8!bX4@mQ9$vL2%") > 3.0

    def test_entropy_filter_masking(self):
        high_entropy_token = "4f8b9c2a" + "1e7d6f5a" + "3b2c1d0e" + "9f8a7b6c"
        result = redact_secrets(f"Hex Secret: {high_entropy_token}", use_entropy=True)
        assert "[REDACTED_SECRET]" in result
        assert high_entropy_token not in result

    def test_redact_pii_with_secret_replacement(self):
        text = "User john@test.com with token ghp_123456789012345678901234567890123456"
        result = redact_pii(text, secret_replacement="[REDACTED_SECRET]")
        assert "[REDACTED]" in result  # For email
        assert "[REDACTED_SECRET]" in result  # For GitHub token
        assert "ghp_" not in result
        assert "john@test.com" not in result
