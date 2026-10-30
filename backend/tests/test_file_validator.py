cat > backend/tests/test_file_validator.py << 'EOF'
"""
Tests for file metadata constraint validation — issue #3893.

Covers:
- File size exceeding 5MB → 413
- Disallowed extensions → 415
- Permitted extensions pass validation
- Edge cases (no extension, empty filename)
"""

import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import HTTPException
from backend.utils.file_validator import (
    validate_file_metadata,
    get_file_extension,
    MAX_FILE_SIZE_BYTES,
    PERMITTED_EXTENSIONS,
)


def make_mock_file(filename: str, size_bytes: int):
    """Create a mock UploadFile with given filename and content size."""
    mock = MagicMock()
    mock.filename = filename
    content = b"x" * size_bytes
    mock.read = AsyncMock(return_value=content)
    return mock


# ---------------------------------------------------------------------------
# get_file_extension
# ---------------------------------------------------------------------------

class TestGetFileExtension:
    def test_pdf_extension(self):
        assert get_file_extension("report.pdf") == "pdf"

    def test_png_extension(self):
        assert get_file_extension("screenshot.PNG") == "png"

    def test_jpg_extension(self):
        assert get_file_extension("photo.JPG") == "jpg"

    def test_log_extension(self):
        assert get_file_extension("error.log") == "log"

    def test_no_extension(self):
        assert get_file_extension("filename") == ""

    def test_empty_string(self):
        assert get_file_extension("") == ""

    def test_none_filename(self):
        assert get_file_extension(None) == ""

    def test_double_extension(self):
        assert get_file_extension("archive.tar.gz") == "gz"


# ---------------------------------------------------------------------------
# File size validation
# ---------------------------------------------------------------------------

class TestFileSizeValidation:
    @pytest.mark.asyncio
    async def test_file_within_limit_passes(self):
        mock_file = make_mock_file("doc.pdf", 1 * 1024 * 1024)  # 1MB
        contents = await validate_file_metadata(mock_file)
        assert len(contents) == 1 * 1024 * 1024

    @pytest.mark.asyncio
    async def test_file_exactly_at_limit_passes(self):
        mock_file = make_mock_file("doc.pdf", MAX_FILE_SIZE_BYTES)
        contents = await validate_file_metadata(mock_file)
        assert len(contents) == MAX_FILE_SIZE_BYTES

    @pytest.mark.asyncio
    async def test_file_exceeding_limit_raises_413(self):
        mock_file = make_mock_file("doc.pdf", MAX_FILE_SIZE_BYTES + 1)
        with pytest.raises(HTTPException) as exc:
            await validate_file_metadata(mock_file)
        assert exc.value.status_code == 413
        assert "5MB" in exc.value.detail

    @pytest.mark.asyncio
    async def test_large_file_raises_413(self):
        mock_file = make_mock_file("big.pdf", 10 * 1024 * 1024)  # 10MB
        with pytest.raises(HTTPException) as exc:
            await validate_file_metadata(mock_file)
        assert exc.value.status_code == 413


# ---------------------------------------------------------------------------
# Extension validation
# ---------------------------------------------------------------------------

class TestExtensionValidation:
    @pytest.mark.asyncio
    async def test_pdf_is_permitted(self):
        mock_file = make_mock_file("report.pdf", 100)
        contents = await validate_file_metadata(mock_file)
        assert contents is not None

    @pytest.mark.asyncio
    async def test_png_is_permitted(self):
        mock_file = make_mock_file("image.png", 100)
        contents = await validate_file_metadata(mock_file)
        assert contents is not None

    @pytest.mark.asyncio
    async def test_jpg_is_permitted(self):
        mock_file = make_mock_file("photo.jpg", 100)
        contents = await validate_file_metadata(mock_file)
        assert contents is not None

    @pytest.mark.asyncio
    async def test_log_is_permitted(self):
        mock_file = make_mock_file("error.log", 100)
        contents = await validate_file_metadata(mock_file)
        assert contents is not None

    @pytest.mark.asyncio
    async def test_exe_is_blocked_415(self):
        mock_file = make_mock_file("malware.exe", 100)
        with pytest.raises(HTTPException) as exc:
            await validate_file_metadata(mock_file)
        assert exc.value.status_code == 415

    @pytest.mark.asyncio
    async def test_js_is_blocked_415(self):
        mock_file = make_mock_file("script.js", 100)
        with pytest.raises(HTTPException) as exc:
            await validate_file_metadata(mock_file)
        assert exc.value.status_code == 415

    @pytest.mark.asyncio
    async def test_php_is_blocked_415(self):
        mock_file = make_mock_file("shell.php", 100)
        with pytest.raises(HTTPException) as exc:
            await validate_file_metadata(mock_file)
        assert exc.value.status_code == 415

    @pytest.mark.asyncio
    async def test_no_extension_is_blocked_415(self):
        mock_file = make_mock_file("noextension", 100)
        with pytest.raises(HTTPException) as exc:
            await validate_file_metadata(mock_file)
        assert exc.value.status_code == 415

    @pytest.mark.asyncio
    async def test_error_message_lists_permitted_extensions(self):
        mock_file = make_mock_file("file.zip", 100)
        with pytest.raises(HTTPException) as exc:
            await validate_file_metadata(mock_file)
        assert "pdf" in exc.value.detail
        assert "png" in exc.value.detail


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

class TestConstants:
    def test_max_file_size_is_5mb(self):
        assert MAX_FILE_SIZE_BYTES == 5 * 1024 * 1024

    def test_permitted_extensions_contains_required(self):
        assert "pdf" in PERMITTED_EXTENSIONS
        assert "png" in PERMITTED_EXTENSIONS
        assert "jpg" in PERMITTED_EXTENSIONS
        assert "log" in PERMITTED_EXTENSIONS

    def test_dangerous_extensions_not_permitted(self):
        assert "exe" not in PERMITTED_EXTENSIONS
        assert "php" not in PERMITTED_EXTENSIONS
        assert "js" not in PERMITTED_EXTENSIONS
        assert "sh" not in PERMITTED_EXTENSIONS
EOF