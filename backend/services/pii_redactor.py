"""
PII Redaction Engine — scans text and replaces personally identifiable
information with [REDACTED] placeholders.

Supported patterns:
- Email addresses
- Phone numbers (international, domestic, with/without country code)
- API keys / tokens / secrets (high-entropy strings matching common key patterns)
"""

import re
from typing import List, Tuple


# ─── Patterns ─────────────────────────────────────────────────────

EMAIL_PATTERN = re.compile(
    r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
)

PHONE_PATTERN = re.compile(
    # Matches: +1 (555) 123-4567, 555-123-4567, +91 9876543210, etc.
    r'(?:\+?\d{1,3}[-.\s]?)?'          # optional country code
    r'\(?\d{2,4}\)?[-.\s]?'            # area code (optional parens)
    r'\d{3,4}[-.\s]?'                  # first part
    r'\d{3,4}'                         # second part
    r'(?:\s*(?:ext|x|内线)\s*\d{1,5})?' # optional extension
)

# Matches common API key / secret / token formats such as:
# ***, ghp_xxxxx, api_key=xxxx, secret=xxxx, bearer xxxx
KEY_PATTERN = re.compile(
    r'(?:'
    r'sk-(?:proj-)?[a-zA-Z0-9_\.-]{8,}'          # OpenAI keys (sk-xxx, sk-proj-xxx, ellipses)
    r'|pk-[a-zA-Z0-9_\.-]{8,}'                  # other API key format
    r'|ghp_[a-zA-Z0-9_\.-]{8,}'                 # GitHub PAT
    r'|gho_[a-zA-Z0-9_\.-]{8,}'                 # GitHub OAuth
    r'|ghu_[a-zA-Z0-9_\.-]{8,}'                 # GitHub user token
    r'|[a-fA-F0-9]{32,64}'                      # raw hex strings (32-64 chars)
    r'|(?:api[_-]?key|secret|token|auth|bearer)'
    r'(?:\s*[:=]\s*|\s+)'
    r'(?:[a-zA-Z0-9_\.-]{8,}|[a-fA-F0-9]{32,64})'
    r')',
)

# Combined pattern for full-text scan
ALL_PII_PATTERN = re.compile(
    f'({EMAIL_PATTERN.pattern})|({PHONE_PATTERN.pattern})|({KEY_PATTERN.pattern})',
    re.IGNORECASE,
)

REDACTED = '[REDACTED]'


# ─── Public API ───────────────────────────────────────────────────

def redact_pii(text: str, redact_emails=True, redact_phones=True, redact_keys=True) -> str:
    """
    Redact PII from a text string.

    Args:
        text: Input text that may contain PII.
        redact_emails: Whether to redact email addresses.
        redact_phones: Whether to redact phone numbers.
        redact_keys: Whether to redact API keys/secrets/tokens.

    Returns:
        Text with PII replaced by [REDACTED].
    """
    if not text:
        return text

    parts: List[str] = []
    last_end = 0

    matches = list(find_pii(text, redact_emails, redact_phones, redact_keys))
    for match in matches:
        start, end = match
        if start > last_end:
            parts.append(text[last_end:start])
        parts.append(REDACTED)
        last_end = end

    if last_end < len(text):
        parts.append(text[last_end:])

    return ''.join(parts)


def find_pii(text: str, redact_emails=True, redact_phones=True, redact_keys=True) -> List[Tuple[int, int]]:
    """
    Find PII locations in text. Returns list of (start, end) tuples.

    Useful for highlighting or partial redaction workflows.
    """
    if not text:
        return []

    matches: List[Tuple[int, int]] = []

    if redact_emails:
        for m in EMAIL_PATTERN.finditer(text):
            matches.append((m.start(), m.end()))

    if redact_phones:
        for m in PHONE_PATTERN.finditer(text):
            matches.append((m.start(), m.end()))

    if redact_keys:
        for m in KEY_PATTERN.finditer(text):
            matches.append((m.start(), m.end()))

    # Sort by position and merge overlapping ranges
    matches.sort()
    merged: List[Tuple[int, int]] = []
    for start, end in matches:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))

    return merged


def count_pii(text: str) -> int:
    """
    Count the number of PII items found in text.
    """
    if not text:
        return 0
    return len(list(ALL_PII_PATTERN.finditer(text)))