"""
Path Traversal Defense Service for Attachment Downloads.
Validates attachment file path containment within the designated uploads base directory (#3948).
"""

import os
from pathlib import Path


def get_safe_attachment_path(base_dir: str, filename: str) -> str:
    """
    Resolve absolute path for an attachment filename while preventing path traversal (../) escape.
    Raises ValueError if filename attempts to access files outside base_dir.
    """
    if not filename or not isinstance(filename, str):
        raise ValueError("Invalid attachment filename.")

    clean_filename = filename.replace("\0", "")

    # Reject path traversal markers and absolute path attempts
    if ".." in clean_filename or clean_filename.startswith(("/", "\\")) or ":" in clean_filename:
        raise ValueError(f"Path traversal detected for filename: '{filename}'")

    base_path = Path(base_dir).resolve()
    target_path = (base_path / clean_filename).resolve()

    # Verify target path is strictly contained within base_path directory
    try:
        target_path.relative_to(base_path)
    except ValueError:
        raise ValueError(f"Path traversal detected for filename: '{filename}'")

    return str(target_path)
