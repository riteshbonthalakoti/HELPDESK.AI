"""
Authentication Service providing constant-time password and token verification
to prevent timing side-channel attacks.
"""

import hashlib
import secrets
from typing import Optional


def hash_password(password: str, salt: Optional[bytes] = None) -> tuple[str, str]:
    """Hash a password using PBKDF2-SHA256 with a random salt."""
    if salt is None:
        salt = secrets.token_bytes(16)
    
    derived = hashlib.pbkdf2_hmac(
        hash_name="sha256",
        password=password.encode("utf-8"),
        salt=salt,
        iterations=100000,
        dklen=32,
    )
    return derived.hex(), salt.hex()


def verify_password_constant_time(provided_password: str, stored_hash_hex: str, salt_hex: str) -> bool:
    """
    Verify a password in constant time using secrets.compare_digest.
    
    Prevents side-channel timing attacks that measure comparison duration.
    """
    if not provided_password or not stored_hash_hex or not salt_hex:
        return False
    
    try:
        salt = bytes.fromhex(salt_hex)
        computed_hash_hex, _ = hash_password(provided_password, salt=salt)
        return secrets.compare_digest(computed_hash_hex, stored_hash_hex)
    except (ValueError, TypeError):
        return False


def verify_token_constant_time(provided_token: str, expected_token: str) -> bool:
    """Verify an API token or secret in constant time."""
    if not provided_token or not expected_token:
        return False
    
    return secrets.compare_digest(provided_token.strip(), expected_token.strip())
