"""
OCR Service — Local, CPU-only text extraction using EasyOCR (images)
and PyMuPDF/fitz (PDFs). No API key required. Runs entirely on the local machine.

Includes size validation and concurrency controls to prevent DoS via
oversized payloads (CWE-400, CWE-770), plus graceful handling of
corrupted / password-protected PDFs.
"""

import asyncio
import base64
import io
import logging
import os
from PIL import Image

logger = logging.getLogger(__name__)

# ── Path traversal prevention ─────────────────────────────────────────────────
_NULL_BYTE = "\x00"

def _sanitize_filename(filename: str) -> str:
    """
    Sanitize a user-supplied filename to prevent path traversal attacks.

    - Strips NULL bytes
    - Extracts basename only (removes any directory components)
    - Rejects filenames containing '..' traversal sequences
    - Rejects empty or whitespace-only filenames after sanitization

    Raises:
        ValueError if the filename is invalid or contains traversal sequences.
    """
    if not filename or not isinstance(filename, str):
        raise ValueError("Filename must be a non-empty string.")

    # Reject NULL bytes
    if _NULL_BYTE in filename:
        raise ValueError("Filename contains invalid NULL byte.")

    # Reject explicit traversal sequences before basename extraction
    if ".." in filename:
        raise ValueError("Filename contains path traversal sequence '..'.")

    # Reject leading slash (absolute path attempt)
    if filename.startswith("/") or filename.startswith("\\"):
        raise ValueError("Filename must not be an absolute path.")

    # Extract basename only — strips any directory components
    safe_name = os.path.basename(filename)

    if not safe_name or not safe_name.strip():
        raise ValueError("Filename is empty after sanitization.")

    return safe_name


def _verify_safe_path(base_dir: str, filename: str) -> str:
    """
    Resolve the full path and verify it stays inside base_dir.

    Raises:
        ValueError if the resolved path escapes base_dir.
    """
    safe_name = _sanitize_filename(filename)
    resolved = os.path.realpath(os.path.join(base_dir, safe_name))
    base_resolved = os.path.realpath(base_dir)

    if os.path.commonpath([resolved, base_resolved]) != base_resolved:
        raise ValueError(
            f"Path traversal detected: '{filename}' resolves outside the upload directory."
        )

    return resolved


# ── Size limits ──────────────────────────────────────────────────────────────
MAX_BASE64_LENGTH = 10 * 1024 * 1024          # 10 MB base64 string (~7.5 MB binary)
MAX_DECODED_BYTES = 8 * 1024 * 1024            # 8 MB decoded bytes
MAX_IMAGE_DIMENSION = 4096                      # max width or height in pixels
MAX_PIXELS = 4096 * 4096                        # ~16.7 MP — prevents decompression bombs
ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/tiff", "application/pdf"}

# PDF extraction — optional; PyMuPDF is not guaranteed to be installed
try:
    import fitz  # PyMuPDF
    _HAS_PDF_SUPPORT = True
except ImportError:
    _HAS_PDF_SUPPORT = False

# ── Concurrency / timeout ───────────────────────────────────────────────────
MAX_CONCURRENT_OCR = 2                          # EasyOCR is CPU-bound; limit parallel runs
OCR_TIMEOUT_SECONDS = 60                        # kill OCR/PDF extraction if it hangs

# Lazy import: easyocr is only imported on first use (heavy initialization ~3-5 s)
_reader = None

# Security Safeguards
MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_IMAGE_PIXELS = 16000000  # e.g., 4000x4000
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


def _get_reader():
    """Lazy-initialize EasyOCR reader in CPU-only mode."""
    global _reader
    if _reader is None:
        import easyocr
        logger.info("[OCRService] Initializing EasyOCR (CPU mode)... this may take a moment on first load.")
        _reader = easyocr.Reader(["en"], gpu=False)
        logger.info("[OCRService] Ready.")
    return _reader


def _validate_b64(image_base64: str) -> tuple[str | None, str | None]:
    """
    Shared validation for both image and PDF base64 payloads.

    Returns (content_type, clean_b64_or_None).
    On failure clean_b64_or_None is None and the caller should abort.
    """
    if not image_base64 or not image_base64.strip():
        return None, None

    raw = image_base64.strip()
    content_type = None

    # ── 1. Strip data-URI prefix ─────────────────────────────────────────────
    if "," in raw:
        header, raw = raw.split(",", 1)
        if ";base64" in header:
            content_type = header.split(";")[0].replace("data:", "")

    # ── 2. Validate content type ──────────────────────────────────────────────
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        logger.warning("[OCRService] Rejected: unsupported content type %s", content_type)
        return content_type, None

    # ── 3. Re-add padding ────────────────────────────────────────────────────
    missing_padding = len(raw) % 4
    if missing_padding:
        raw += "=" * (4 - missing_padding)

    # ── 4. Validate base64 characters ─────────────────────────────────────────
    _b64_chars = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")
    if not all(c in _b64_chars for c in raw):
        logger.warning("[OCRService] Rejected: invalid base64 characters detected.")
        return content_type, None

    # ── 5. Base64 length guard ────────────────────────────────────────────────
    if len(raw) > MAX_BASE64_LENGTH:
        logger.warning(
            "[OCRService] Rejected: base64 length %d exceeds limit %d",
            len(raw), MAX_BASE64_LENGTH,
        )
        return content_type, None

    return content_type, raw


class OCRService:
    def __init__(self):
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENT_OCR)

    # ── internal: synchronous OCR run (called via executor) ──────────────────
    def _run_ocr(self, image_bytes: bytes) -> list[str]:
        reader = _get_reader()
        return reader.readtext(image_bytes, detail=0, paragraph=True)

    # ── internal: PDF text extraction (synchronous, called via executor) ──────
    def _extract_pdf_text(self, pdf_bytes: bytes) -> str:
        """Extract text from a PDF using PyMuPDF (fitz)."""
        if not _HAS_PDF_SUPPORT:
            logger.warning("[OCRService] PDF support not available (PyMuPDF not installed). Cannot extract text.")
            return ""
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            if doc.needs_pass:
                logger.warning("[OCRService] Rejected: password-protected PDF.")
                doc.close()
                return ""
            pages = []
            for page in doc:
                text = page.get_text()
                if text and text.strip():
                    pages.append(text.strip())
            doc.close()
            extracted = "\n".join(pages).strip()
            logger.info("[OCRService] Extracted %d chars from PDF (%d pages).", len(extracted), len(pages))
            return extracted
        except Exception as pdf_err:
            logger.warning("[OCRService] Failed to extract text from PDF: %s", pdf_err)
            return ""

    # ── internal: process an image (non-PDF) payload ─────────────────────────
    async def _extract_image_text(self, b64_payload: str) -> str:
        """Decode, validate, and OCR a base64-encoded image."""
        try:
            # ── Decode ────────────────────────────────────────────────────────
            image_bytes = base64.b64decode(b64_payload)

            # ── Decoded-bytes guard ───────────────────────────────────────────
            if len(image_bytes) > MAX_DECODED_BYTES:
                logger.warning(
                    "[OCRService] Rejected: decoded size %d exceeds limit %d",
                    len(image_bytes), MAX_DECODED_BYTES,
                )
                return ""

            # ── Image dimension & pixel-count guard (PIL) ─────────────────────
            try:
                img = Image.open(io.BytesIO(image_bytes))
                img.verify()  # validate image integrity
                # Re-open after verify() (verify() consumes the stream)
                img = Image.open(io.BytesIO(image_bytes))
                width, height = img.size

                if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
                    logger.warning(
                        "[OCRService] Rejected: image dimensions %dx%d exceed limit %d",
                        width, height, MAX_IMAGE_DIMENSION,
                    )
                    return ""

                if width * height > MAX_PIXELS:
                    logger.warning(
                        "[OCRService] Rejected: pixel count %d exceeds limit %d",
                        width * height, MAX_PIXELS,
                    )
                    return ""
            except Exception as img_err:
                logger.warning("[OCRService] Rejected: invalid or unreadable image — %s", img_err)
                return ""

            # ── OCR with concurrency cap + timeout ────────────────────────────
            loop = asyncio.get_event_loop()
            async with self._semaphore:
                try:
                    results = await asyncio.wait_for(
                        loop.run_in_executor(None, self._run_ocr, image_bytes),
                        timeout=OCR_TIMEOUT_SECONDS,
                    )
                    extracted = " ".join(results).strip()
                    logger.info("[OCRService] Extracted %d chars from image.", len(extracted))
                    return extracted
                except asyncio.TimeoutError:
                    logger.warning("[OCRService] OCR timed out after %ds", OCR_TIMEOUT_SECONDS)
                    return ""

        except Exception as e:
            logger.warning("[OCRService] Error during OCR: %s", e)
            return ""

    # ── internal: process a PDF payload ─────────────────────────────────────
    async def _extract_pdf_text_async(self, b64_payload: str) -> str:
        """Decode, validate, and extract text from a base64-encoded PDF."""
        try:
            pdf_bytes = base64.b64decode(b64_payload)

            if len(pdf_bytes) > MAX_DECODED_BYTES:
                logger.warning(
                    "[OCRService] Rejected PDF: decoded size %d exceeds limit %d",
                    len(pdf_bytes), MAX_DECODED_BYTES,
                )
                return ""

            loop = asyncio.get_event_loop()
            async with self._semaphore:
                try:
                    extracted = await asyncio.wait_for(
                        loop.run_in_executor(None, self._extract_pdf_text, pdf_bytes),
                        timeout=OCR_TIMEOUT_SECONDS,
                    )
                    return extracted
                except asyncio.TimeoutError:
                    logger.warning("[OCRService] PDF extraction timed out after %ds", OCR_TIMEOUT_SECONDS)
                    return ""
        except Exception as e:
            logger.warning("[OCRService] Error decoding PDF base64: %s", e)
            return ""

    # ── public API ───────────────────────────────────────────────────────────
    async def extract_text(self, image_base64: str) -> str:
        """
        Extract all text from a base64-encoded image or PDF using EasyOCR
        (images) or PyMuPDF (PDFs).

        Applies strict size, dimension, and concurrency guards to prevent
        CPU starvation and memory exhaustion from malicious payloads.
        Handles corrupted / password-protected PDFs gracefully, returning "".

        Returns:
            A single cleaned string of extracted text, or "" on failure.
        """
        content_type, b64_payload = _validate_b64(image_base64)
        if b64_payload is None:
            return ""

        # Route based on content type
        if content_type == "application/pdf":
            logger.info("[OCRService] Detected PDF content. Routing to PDF text extraction.")
            return await self._extract_pdf_text_async(b64_payload)

        # Default: treat as image
        return await self._extract_image_text(b64_payload)

    async def process_document(
        self,
        image_base64: str,
        content_type: str = None,
        filename: str = None
    ) -> dict:
        """
        Process a base64-encoded document or PDF, performing input validation,
        format validation, structure validation, and text extraction.

        Args:
            image_base64 (str): Base64-encoded document data (optionally with data-URI prefix).
            content_type (str, optional): The MIME content type.
            filename (str, optional): The name of the file being processed.

        Returns:
            dict: A dictionary containing:
                - "success" (bool): True if processing succeeded and text was found.
                - "text" (str): The extracted text.
                - "error" (str or None): Error description if success is False.
        """
        import os

        # ── 1. None/missing input validation ──────────────────────────────────
        if image_base64 is None:
            raise ValueError("Document data cannot be None")
        if not isinstance(image_base64, str):
            raise ValueError("Document data must be a string")
        if not image_base64.strip():
            raise ValueError("Document data cannot be empty or whitespace-only")

        raw = image_base64.strip()

        # ── 2. Structural validation & prefix parsing ─────────────────────────
        prefix_content_type = None
        if "," in raw:
            header, raw_data = raw.split(",", 1)
            if ";base64" in header:
                prefix_content_type = header.split(";")[0].replace("data:", "")
        else:
            raw_data = raw

        # Re-add padding to raw_data for base64 validation
        missing_padding = len(raw_data) % 4
        if missing_padding:
            raw_data += "=" * (4 - missing_padding)

        # Validate base64 structure/characters
        _b64_chars = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")
        if not all(c in _b64_chars for c in raw_data):
            raise ValueError("Malformed base64 document data: invalid characters")

        # Check payload length
        if len(raw_data) > MAX_BASE64_LENGTH:
            return {
                "success": False,
                "text": "",
                "error": f"Document payload size ({len(raw_data)} chars) exceeds maximum limit of {MAX_BASE64_LENGTH} chars"
            }

        # ── 3. Format/Extension validation ────────────────────────────────────
        supported_extensions_map = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".bmp": "image/bmp",
            ".tiff": "image/tiff",
            ".pdf": "application/pdf"
        }

        # ── Sanitize filename to prevent path traversal ───────────────────────
        if filename is not None:
            try:
                filename = _sanitize_filename(filename)
            except ValueError as path_err:
                return {
                    "success": False,
                    "text": "",
                    "error": f"Invalid filename: {path_err}"
                }

        resolved_content_type = content_type or prefix_content_type
        if not resolved_content_type and filename:
            _, ext = os.path.splitext(filename.lower())
            resolved_content_type = supported_extensions_map.get(ext)
            if resolved_content_type is None:
                return {
                    "success": False,
                    "text": "",
                    "error": f"Unsupported file extension: {ext}"
                }

        if resolved_content_type and resolved_content_type not in ALLOWED_CONTENT_TYPES:
            return {
                "success": False,
                "text": "",
                "error": f"Unsupported content type: {resolved_content_type}"
            }

        # ── 4. Call extract_text ──────────────────────────────────────────────
        # If we have resolved a content type and it wasn't present as a data URI,
        # prepending it ensures that extract_text routes it correctly.
        if resolved_content_type and not prefix_content_type:
            input_payload = f"data:{resolved_content_type};base64,{image_base64}"
        else:
            input_payload = image_base64

        try:
            extracted_text = await self.extract_text(input_payload)
        except Exception as err:
            logger.error("[OCRService] Text extraction failed: %s", err)
            return {
                "success": False,
                "text": "",
                "error": f"Internal extraction error: {str(err)}"
            }

        # ── 5. Empty documents rejection ──────────────────────────────────────
        if not extracted_text or not extracted_text.strip():
            return {
                "success": False,
                "text": "",
                "error": "Document contains no readable text"
            }

        return {
            "success": True,
            "text": extracted_text,
            "error": None
        }
