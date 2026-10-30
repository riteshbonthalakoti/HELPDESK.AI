"""
OCR Service – Local, CPU-only text extraction using EasyOCR.
No API key required. Runs entirely on the local machine.
"""

import base64
import io
import re

# Maximum base64 string length (~5MB payload limit)
MAX_BASE64_LENGTH = 5 * 1024 * 1024

SUPPORTED_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "application/pdf",
}

SUPPORTED_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "pdf"}

# Lazy import: easyocr is only imported once first use (heavy initialization ~3-5s)
_reader = None


def _get_reader():
    """Lazy-initialize EasyOCR reader in CPU-only mode."""
    global _reader
    if _reader is None:
        import easyocr
        print("[OCRService] Initializing EasyOCR (CPU mode)... this may take a moment on first load.")
        _reader = easyocr.Reader(["en"], gpu=False)
        print("[OCRService] Ready.")
    return _reader


class OCRService:
    def extract_text(self, image_base64: str) -> str:
        """
        Extract all text from a base64-encoded image using EasyOCR.

        Returns:
            A single cleaned string of extracted text, or "" on failure.
        """
        if not image_base64:
            return ""

        try:
            # Strip data URI prefix if present (e.g., "data:image/png;base64,...")
            if "," in image_base64:
                image_base64 = image_base64.split(",", 1)[1]
            
            # Add back missing padding
            missing_padding = len(image_base64) % 4
            if missing_padding:
                image_base64 += "=" * (4 - missing_padding)

            image_bytes = base64.b64decode(image_base64)
            reader = _get_reader()
            results = reader.readtext(image_bytes, detail=0, paragraph=True)
            extracted = " ".join(results).strip()
            print(f"[OCRService] Extracted {len(extracted)} chars from image.")
            return extracted
        except Exception as e:
            print(f"[OCRService] Error during OCR: {e}")
            return ""

    async def process_document(
        self, document_data: str, filename: str = None, content_type: str = None
    ) -> dict:
        """
        Process and validate an uploaded document (base64 encoded).

        Validates payload size, base64 syntax, MIME types, and file extensions.
        Extracts readable text and returns a structured status response.
        """
        if document_data is None:
            raise ValueError("Document data cannot be None")

        if not isinstance(document_data, str):
            raise ValueError("Document data must be a string")

        if not document_data.strip():
            raise ValueError("Document data cannot be empty or whitespace-only")

        raw_payload = document_data.strip()
        if "," in raw_payload:
            raw_payload = raw_payload.split(",", 1)[1].strip()

        # Validate base64 structure and characters
        cleaned_chars = re.sub(r"\s+", "", raw_payload)
        if not re.match(r"^[A-Za-z0-9+/=]+$", cleaned_chars):
            raise ValueError("Malformed base64 document data")

        # Validate maximum size limit
        if len(cleaned_chars) > MAX_BASE64_LENGTH:
            return {
                "success": False,
                "error": f"Payload size exceeds maximum limit of {MAX_BASE64_LENGTH} characters",
                "text": None,
            }

        # Validate content type if provided
        if content_type:
            ct = content_type.lower().strip()
            if ct not in SUPPORTED_MIME_TYPES:
                return {
                    "success": False,
                    "error": f"Unsupported content type: {content_type}",
                    "text": None,
                }

        # Validate file extension if filename provided
        if filename:
            ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
            if ext not in SUPPORTED_EXTENSIONS:
                return {
                    "success": False,
                    "error": f"Unsupported file extension: {ext}",
                    "text": None,
                }

        # Extract text via local OCR engine
        extracted_text = self.extract_text(document_data)
        if not extracted_text or not extracted_text.strip():
            return {
                "success": False,
                "error": "Document contains no readable text",
                "text": None,
            }

        return {
            "success": True,
            "text": extracted_text.strip(),
            "error": None,
        }
