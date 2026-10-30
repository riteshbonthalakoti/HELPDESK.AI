"""
PII & Secret Redaction Engine for HELPDESK.AI

Scans ticket content (descriptions, subjects, comments) and automatically
masks Personally Identifiable Information (PII) and sensitive secrets/credentials
before storage, backup, or logging.

Supported PII & Secret types:
- Email addresses (RFC 5322 simplified)
- Phone numbers (international, domestic, dot/paren formatted)
- API keys & Tokens:
  * Bearer / Authorization headers (Bearer [A-Za-z0-9_-]+)
  * GitHub Personal Access Tokens (ghp_[A-Za-z0-9]{36}, gho_, ghu_, ghs_, ghr_)
  * AWS Access Key IDs (AKIA[0-9A-Z]{16})
  * Supabase & JWT Tokens (eyJ... . eyJ... . ...)
  * OpenAI, Slack, GitLab, Stripe, and other cloud provider credentials
- Shannon Entropy-based secret and credential detection
- IPv4 addresses (optional, controlled by admin toggle)
- Credit card numbers (Luhn checksum-validated)
- SSN-like patterns (US format)

Usage:
    from pii_redaction import redact_pii, redact_secrets, redact_pii_dict, scan_pii

    # Redact both PII and secrets
    cleaned = redact_pii("Authorization: Bearer mySecretToken123 with ghp_ABC123...")

    # Redact secrets specifically with [REDACTED_SECRET]
    secret_cleaned = redact_secrets("Token: ghp_123456789012345678901234567890123456")
"""

import re
import math
import logging
from typing import Optional, Dict, List, Any

logger = logging.getLogger(__name__)

# Module-level toggle — set by admin settings
_pii_redaction_enabled = False

def set_pii_redaction_enabled(enabled: bool) -> None:
    """Toggle PII redaction globally (called from system settings)."""
    global _pii_redaction_enabled
    _pii_redaction_enabled = enabled
    logger.info("[PIIRedaction] PII redaction %s", "ENABLED" if enabled else "DISABLED")

def is_pii_redaction_enabled() -> bool:
    """Check if PII redaction is currently enabled."""
    return _pii_redaction_enabled


# --- PII & Secret Patterns ---

# Email: standard RFC 5322 simplified
_EMAIL_RE = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"
)

# Phone: international (+1-555-123-4567, +44 20 7946 0958) and domestic (555-123-4567, (555) 123-4567)
_PHONE_RE = re.compile(
    r"(?<!\w)"
    r"(?:\+?\d{1,3}[\s.-]?)?"
    r"(?:\(?\d{2,4}\)?[\s.-]?)"
    r"\d{3,4}[\s.-]?\d{3,4}"
    r"(?!\w)"
)

# Specific High-Risk Secret Patterns (Issue #4107)
_BEARER_TOKEN_RE = re.compile(
    r"(?i)(?:Authorization:\s*)?Bearer\s+[A-Za-z0-9_\-\.~+/=]{10,}",
    re.IGNORECASE
)

_GITHUB_PAT_RE = re.compile(
    r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b",
    re.IGNORECASE
)

_AWS_ACCESS_KEY_RE = re.compile(
    r"\bAKIA[0-9A-Z]{16}\b"
)

_JWT_TOKEN_RE = re.compile(
    r"\beyJ[A-Za-z0-9_\-=]+\.eyJ[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-\.+/=]+\b"
)

# Comprehensive API keys / tokens pattern
_API_KEY_RE = re.compile(
    r"\b(?:"
    r"sk-[A-Za-z0-9]{20,}"                        # OpenAI
    r"|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}"  # GitHub tokens
    r"|glpat-[A-Za-z0-9\-]{20,}"                  # GitLab
    r"|xox[bpas]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,34}"  # Slack
    r"|xox[bpas]-[A-Za-z0-9\-]{10,}"              # Slack legacy
    r"|AKIA[0-9A-Z]{16}"                          # AWS access key
    r"|eyJ[A-Za-z0-9_\-=]+\.eyJ[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-\.+/=]+"  # Full JWT
    r"|sbp_[A-Za-z0-9]{20,}"                      # Supabase service role
    r"|AIza[0-9A-Za-z\-_]{20,}"                   # Google API Key
    r"|(?:sk|pk)_(?:test|live)_[A-Za-z0-9]{24,}"  # Stripe
    r")\b",
    re.IGNORECASE
)

# Combined Secret Regexes
SECRET_PATTERNS = [
    _BEARER_TOKEN_RE,
    _GITHUB_PAT_RE,
    _AWS_ACCESS_KEY_RE,
    _JWT_TOKEN_RE,
    _API_KEY_RE,
]

# IPv4: 0.0.0.0 to 255.255.255.255
_IPV4_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}"
    r"(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b"
)

# Credit card: 13-19 digit sequences with optional separators
_CREDIT_CARD_RE = re.compile(
    r"\b(?:\d{4}[\s-]?){3}\d{1,7}\b"
)

# SSN: 3-2-4 digit pattern (US)
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")

# Standard replacements
REDACTED = "[REDACTED]"
REDACTED_SECRET = "[REDACTED_SECRET]"


# --- Mathematical Entropy & Luhn Checks ---

def calculate_shannon_entropy(data: str) -> float:
    """
    Calculate the Shannon entropy of a given string.
    
    A higher entropy value (> 3.0 - 3.2 for strings >= 16 characters)
    indicates high randomness, commonly characteristic of cryptographic hashes,
    raw API keys, and private tokens.
    """
    if not data:
        return 0.0
    length = len(data)
    frequencies: Dict[str, int] = {}
    for char in data:
        frequencies[char] = frequencies.get(char, 0) + 1
    entropy = 0.0
    for count in frequencies.values():
        p_x = count / length
        if p_x > 0:
            entropy -= p_x * math.log2(p_x)
    return entropy


def _luhn_check(number_str: str) -> bool:
    """Validate a number string using the Luhn algorithm (for credit cards)."""
    digits = [int(d) for d in number_str if d.isdigit()]
    if len(digits) < 13 or len(digits) > 19:
        return False
    checksum = 0
    reverse = digits[::-1]
    for i, d in enumerate(reverse):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        checksum += d
    return checksum % 10 == 0


def _is_valid_credit_card(match: str) -> bool:
    """Check if a matched string is a valid credit card number (Luhn)."""
    digits_only = "".join(c for c in match if c.isdigit())
    return _luhn_check(digits_only)


# --- Redaction Functions ---

def redact_secrets(
    text: Optional[str],
    replacement: str = REDACTED_SECRET,
    use_entropy: bool = True,
    entropy_threshold: float = 3.2,
    min_entropy_length: int = 18,
) -> Optional[str]:
    """
    Redact API keys, tokens, Bearer headers, and high-entropy secrets from text.

    Args:
        text: Input text string.
        replacement: String to mask secrets with (default: [REDACTED_SECRET]).
        use_entropy: Whether to inspect unstructured strings for high Shannon entropy.
        entropy_threshold: Minimum Shannon entropy score to classify as secret.
        min_entropy_length: Minimum token length before evaluating entropy.

    Returns:
        String with secrets redacted.
    """
    if not text or not isinstance(text, str):
        return text

    result = text

    # 1. Bearer headers
    result = _BEARER_TOKEN_RE.sub(replacement, result)

    # 2. GitHub Personal Access Tokens
    result = _GITHUB_PAT_RE.sub(replacement, result)

    # 3. AWS Access Key IDs
    result = _AWS_ACCESS_KEY_RE.sub(replacement, result)

    # 4. Supabase / JWT tokens
    result = _JWT_TOKEN_RE.sub(replacement, result)

    # 5. Cloud provider API keys
    result = _API_KEY_RE.sub(replacement, result)

    # 6. Entropy-based masking for unknown raw tokens (e.g. hex/base64 blobs)
    if use_entropy:
        def _mask_entropy(match):
            token = match.group(0)
            if len(token) >= min_entropy_length:
                has_digit = any(c.isdigit() for c in token)
                has_letter = any(c.isalpha() for c in token)
                if (has_digit and has_letter) or token.startswith(("0x", "gh", "ak")):
                    entropy = calculate_shannon_entropy(token)
                    if entropy >= entropy_threshold:
                        return replacement
            return token

        candidate_re = re.compile(r"\b[A-Za-z0-9_\-\.~+/=]{16,}\b")
        result = candidate_re.sub(_mask_entropy, result)

    return result


def redact_pii(
    text: Optional[str],
    *,
    redact_emails: bool = True,
    redact_phones: bool = True,
    redact_api_keys: bool = True,
    redact_ips: bool = False,
    redact_credit_cards: bool = True,
    redact_ssns: bool = True,
    replacement: str = REDACTED,
    secret_replacement: Optional[str] = None,
    use_entropy: bool = False,
) -> Optional[str]:
    """
    Redact PII and sensitive credentials from a text string.

    Args:
        text: Input text to scan and redact.
        redact_emails: Mask email addresses.
        redact_phones: Mask phone numbers.
        redact_api_keys: Mask API keys, Bearer headers, and secrets.
        redact_ips: Mask IPv4 addresses.
        redact_credit_cards: Mask credit card numbers (Luhn-validated).
        redact_ssns: Mask SSN-like patterns.
        replacement: Default replacement string for general PII.
        secret_replacement: Custom replacement for secrets (defaults to replacement or [REDACTED_SECRET]).
        use_entropy: Toggle Shannon entropy filter for unstructured tokens.

    Returns:
        Text with PII and secrets replaced, or None if input is None.
    """
    if not text or not isinstance(text, str):
        return text

    sec_repl = secret_replacement if secret_replacement is not None else replacement
    result = text

    # Redact Bearer headers and secrets first to prevent partial token mismatch
    if redact_api_keys:
        result = _BEARER_TOKEN_RE.sub(sec_repl, result)
        result = _GITHUB_PAT_RE.sub(sec_repl, result)
        result = _AWS_ACCESS_KEY_RE.sub(sec_repl, result)
        result = _JWT_TOKEN_RE.sub(sec_repl, result)
        result = _API_KEY_RE.sub(sec_repl, result)
        if use_entropy:
            result = redact_secrets(result, replacement=sec_repl, use_entropy=True)

    if redact_credit_cards:
        def _cc_replace(m):
            return replacement if _is_valid_credit_card(m.group(0)) else m.group(0)
        result = _CREDIT_CARD_RE.sub(_cc_replace, result)

    if redact_emails:
        result = _EMAIL_RE.sub(replacement, result)

    if redact_phones:
        result = _PHONE_RE.sub(replacement, result)

    if redact_ssns:
        result = _SSN_RE.sub(replacement, result)

    if redact_ips:
        result = _IPV4_RE.sub(replacement, result)

    return result


def redact_pii_dict(
    data: dict,
    fields: Optional[List[str]] = None,
    redact_ips: bool = False,
    secret_replacement: Optional[str] = None,
) -> dict:
    """
    Redact PII and secrets from specified string fields in a dictionary.

    Args:
        data: Dictionary with ticket data.
        fields: List of keys to scan. Defaults to common text fields.
        redact_ips: Whether to also redact IP addresses.
        secret_replacement: Custom replacement string for API keys/secrets.

    Returns:
        New dictionary with PII redacted in specified fields.
    """
    if fields is None:
        fields = [
            "subject", "description", "text", "summary",
            "ocr_text", "company", "metadata",
        ]

    result = dict(data)
    for field in fields:
        if field in result and isinstance(result[field], str):
            result[field] = redact_pii(
                result[field],
                redact_ips=redact_ips,
                secret_replacement=secret_replacement
            )

    return result


def scan_pii(text: Optional[str], include_entropy: bool = True) -> Dict[str, List[str]]:
    """
    Scan text for PII and secrets without redacting. Returns found items grouped by type.

    Args:
        text: Input text to scan.
        include_entropy: Include entropy-detected secret candidates.

    Returns:
        Dict mapping PII/Secret type to list of found values.
    """
    if not text or not isinstance(text, str):
        return {}

    findings: Dict[str, List[str]] = {}

    emails = _EMAIL_RE.findall(text)
    if emails:
        findings["email"] = emails

    phones = _PHONE_RE.findall(text)
    if phones:
        findings["phone"] = phones

    bearer_tokens = _BEARER_TOKEN_RE.findall(text)
    if bearer_tokens:
        findings["bearer"] = bearer_tokens

    github_pats = _GITHUB_PAT_RE.findall(text)
    if github_pats:
        findings["github_pat"] = github_pats

    aws_keys = _AWS_ACCESS_KEY_RE.findall(text)
    if aws_keys:
        findings["aws_key"] = aws_keys

    jwts = _JWT_TOKEN_RE.findall(text)
    if jwts:
        findings["jwt"] = jwts

    api_keys = _API_KEY_RE.findall(text)
    if api_keys:
        findings["api_key"] = api_keys

    ips = _IPV4_RE.findall(text)
    if ips:
        findings["ipv4"] = ips

    cc_matches = _CREDIT_CARD_RE.findall(text)
    valid_cc = [m for m in cc_matches if _is_valid_credit_card(m)]
    if valid_cc:
        findings["credit_card"] = valid_cc

    ssns = _SSN_RE.findall(text)
    if ssns:
        findings["ssn"] = ssns

    if include_entropy:
        entropy_candidates = []
        tokens = re.findall(r"\b[A-Za-z0-9_\-\.~+/=]{18,}\b", text)
        for tok in tokens:
            if calculate_shannon_entropy(tok) >= 3.2:
                entropy_candidates.append(tok)
        if entropy_candidates:
            findings["entropy_secrets"] = entropy_candidates

    return findings
