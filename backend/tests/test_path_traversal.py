"""
Security regression tests for path traversal prevention — issue #3948.

Verifies that user-supplied filenames with traversal sequences are rejected
before they can be used to construct file paths on disk.
"""

import pytest
import os
from backend.services.ocr_service import _sanitize_filename, _verify_safe_path


# ---------------------------------------------------------------------------
# _sanitize_filename tests
# ---------------------------------------------------------------------------

class TestSanitizeFilename:
    def test_normal_filename_passes(self):
        assert _sanitize_filename("report.pdf") == "report.pdf"

    def test_basename_extracted(self):
        assert _sanitize_filename("/etc/passwd") == "passwd"

    def test_traversal_sequence_rejected(self):
        with pytest.raises(ValueError, match="traversal"):
            _sanitize_filename("../../etc/passwd")

    def test_traversal_in_middle_rejected(self):
        with pytest.raises(ValueError, match="traversal"):
            _sanitize_filename("uploads/../../../etc/shadow")

    def test_null_byte_rejected(self):
        with pytest.raises(ValueError, match="NULL"):
            _sanitize_filename("file\x00.pdf")

    def test_null_byte_url_encoded_rejected(self):
        with pytest.raises(ValueError):
            _sanitize_filename("file\x00/../etc/passwd")

    def test_absolute_path_rejected(self):
        with pytest.raises(ValueError, match="absolute"):
            _sanitize_filename("/absolute/path/file.pdf")

    def test_windows_absolute_path_rejected(self):
        with pytest.raises(ValueError, match="absolute"):
            _sanitize_filename("\\windows\\system32\\file.dll")

    def test_empty_string_rejected(self):
        with pytest.raises(ValueError):
            _sanitize_filename("")

    def test_none_rejected(self):
        with pytest.raises(ValueError):
            _sanitize_filename(None)

    def test_whitespace_only_rejected(self):
        with pytest.raises(ValueError):
            _sanitize_filename("   ")

    def test_nested_traversal_rejected(self):
        with pytest.raises(ValueError, match="traversal"):
            _sanitize_filename("....//....//etc/passwd")

    def test_filename_with_spaces_passes(self):
        result = _sanitize_filename("my report.pdf")
        assert result == "my report.pdf"

    def test_filename_with_extension_passes(self):
        assert _sanitize_filename("ticket_123.png") == "ticket_123.png"


# ---------------------------------------------------------------------------
# _verify_safe_path tests
# ---------------------------------------------------------------------------

class TestVerifySafePath:
    def test_valid_file_in_uploads_dir(self, tmp_path):
        result = _verify_safe_path(str(tmp_path), "report.pdf")
        assert result == str(tmp_path / "report.pdf")

    def test_traversal_escaping_base_dir_rejected(self, tmp_path):
        with pytest.raises(ValueError, match="traversal|path"):
            _verify_safe_path(str(tmp_path), "../../etc/passwd")

    def test_symlink_escape_prevented(self, tmp_path):
        """Verify realpath resolution prevents symlink-based escapes."""
        # Create a symlink pointing outside tmp_path
        target = tmp_path.parent / "secret.txt"
        target.write_text("secret")
        link = tmp_path / "link.txt"
        link.symlink_to(target)

        # The symlink resolves outside base_dir — should be rejected
        with pytest.raises(ValueError):
            _verify_safe_path(str(tmp_path), "link.txt")

    def test_normal_filename_returns_full_path(self, tmp_path):
        result = _verify_safe_path(str(tmp_path), "image.png")
        assert result.startswith(str(tmp_path))
        assert result.endswith("image.png")


# ---------------------------------------------------------------------------
# process_document filename sanitization integration tests
# ---------------------------------------------------------------------------

class TestProcessDocumentFilenameValidation:
    """Integration tests verifying process_document rejects traversal filenames."""

    @pytest.mark.asyncio
    async def test_traversal_filename_returns_error(self):
        from backend.services.ocr_service import OCRService
        svc = OCRService()

        # Minimal valid base64 PNG (1x1 pixel)
        tiny_png_b64 = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
            "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        )

        result = await svc.process_document(
            image_base64=tiny_png_b64,
            filename="../../etc/passwd"
        )

        assert result["success"] is False
        assert "Invalid filename" in result["error"] or "traversal" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_null_byte_filename_returns_error(self):
        from backend.services.ocr_service import OCRService
        svc = OCRService()

        tiny_png_b64 = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
            "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        )

        result = await svc.process_document(
            image_base64=tiny_png_b64,
            filename="file\x00.pdf"
        )

        assert result["success"] is False
        assert "Invalid filename" in result["error"] or "NULL" in result["error"]

    @pytest.mark.asyncio
    async def test_normal_filename_not_rejected_by_sanitizer(self):
        from backend.services.ocr_service import OCRService
        svc = OCRService()

        tiny_png_b64 = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
            "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        )

        result = await svc.process_document(
            image_base64=tiny_png_b64,
            filename="screenshot.png"
        )

        # Should NOT fail due to filename sanitization
        assert "Invalid filename" not in (result.get("error") or "")