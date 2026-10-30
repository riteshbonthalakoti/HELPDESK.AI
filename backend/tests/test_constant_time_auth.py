import pytest
from backend.services.auth_service import (
    hash_password,
    verify_password_constant_time,
    verify_token_constant_time,
)


def test_password_hashing_and_constant_time_verification():
    password = "SuperSecretPassword123!"
    hash_hex, salt_hex = hash_password(password)

    # Valid password should match
    assert verify_password_constant_time(password, hash_hex, salt_hex) is True

    # Invalid password should fail
    assert verify_password_constant_time("WrongPassword123!", hash_hex, salt_hex) is False


def test_empty_or_invalid_inputs():
    assert verify_password_constant_time("", "abc", "123") is False
    assert verify_password_constant_time("pass", "", "123") is False
    assert verify_password_constant_time("pass", "abc", "") is False


def test_token_constant_time_verification():
    token = "secret-api-token-xyz"
    assert verify_token_constant_time(token, "secret-api-token-xyz") is True
    assert verify_token_constant_time(token, "attacker-token-abc") is False
    assert verify_token_constant_time("", token) is False
