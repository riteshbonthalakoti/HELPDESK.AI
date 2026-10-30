import os
import pytest
from backend.services.attachment_sanitizer import get_safe_attachment_path


def test_get_safe_attachment_path_valid_file(tmp_path):
    base_dir = str(tmp_path)
    filename = "report.pdf"

    safe_path = get_safe_attachment_path(base_dir, filename)
    assert safe_path.startswith(str(tmp_path.resolve()))
    assert safe_path.endswith("report.pdf")


def test_get_safe_attachment_path_blocks_path_traversal(tmp_path):
    base_dir = str(tmp_path)
    illegal_filenames = [
        "../etc/passwd",
        "..\\Windows\\System32\\cmd.exe",
        "sub/../../secret.txt",
        "/etc/shadow",
    ]

    for filename in illegal_filenames:
        with pytest.raises(ValueError, match="Path traversal detected"):
            get_safe_attachment_path(base_dir, filename)


def test_get_safe_attachment_path_handles_empty_filename(tmp_path):
    with pytest.raises(ValueError, match="Invalid attachment filename"):
        get_safe_attachment_path(str(tmp_path), "")
