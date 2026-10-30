cat > backend/utils/file_validator.py << 'EOF'
"""
file_validator.py — File metadata constraint validation for asset uploads.

Validates:
- File size does not exceed 5MB
- File extension belongs to permitted list (pdf, png, jpg, log)
"""

import os
from fastapi import UploadFile, HTTPException

MAX_FILE_SIZE_MB = 5
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

PERMITTED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg", "log"}


def get_file_extension(filename: str) -> str:
    """Extract and return lowercased file extension."""
    _, ext = os.path.splitext(filename or "")
    return ext.lstrip(".").lower()


async def validate_file_metadata(file: UploadFile) -> bytes:
    """
    Validates file size and extension before mapping to disk.

    Args:
        file: The uploaded file from FastAPI.

    Returns:
        File contents as bytes if valid.

    Raises:
        HTTPException 413 if file exceeds 5MB.
        HTTPException 415 if file extension is not permitted.
    """
    # Validate extension
    ext = get_file_extension(file.filename)
    if ext not in PERMITTED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=(
                f"File type '.{ext}' is not permitted. "
                f"Allowed extensions: {', '.join(sorted(PERMITTED_EXTENSIONS))}"
            ),
        )

    # Read file and validate size
    contents = await file.read(MAX_FILE_SIZE_BYTES + 1)

    if len(contents) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File size exceeds the {MAX_FILE_SIZE_MB}MB limit.",
        )

    return contents
EOF