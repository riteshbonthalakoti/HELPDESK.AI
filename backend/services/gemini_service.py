import base64
import io
import logging
import os
from pathlib import Path
import re
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv
from PIL import Image

try:
    from google import genai
except ImportError:
    genai = None

logger = logging.getLogger(__name__)

# Load environment variables from backend/.env if available
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)


class GeminiService:
    """Service wrapper for Google Gemini API with graceful fallbacks and error handling."""

    def __init__(self, api_key: Optional[str] = None):
        raw_key = api_key if api_key is not None else os.getenv("GEMINI_API_KEY")
        self.api_key = str(raw_key).strip() if raw_key else ""
        self._initialized = False
        self.client = None
        self.model_name = "gemma-3-27b-it"

        if self.api_key and genai is not None:
            try:
                self.client = genai.Client(api_key=self.api_key)
                self._initialized = True
                logger.info(f"[GeminiService] Connected to Google GenAI API (Model: {self.model_name})")
            except Exception as e:
                logger.warning(f"[GeminiService] Initialization Error: {e}")
                self._initialized = False
                self.client = None
        else:
            logger.warning("[GeminiService] WARNING: GEMINI_API_KEY not found in environment.")

    def is_available(self) -> bool:
        """Returns True if the Gemini client is initialized with a valid key."""
        return self._initialized and self.client is not None

    def analyze_image(self, image_base64: str) -> dict:
        """Perform OCR and image analysis using Gemini logic."""
        if not self.is_available():
            return {
                "image_description": "[Gemini API Key Missing] Could not analyze image.",
                "ocr_text": "",
                "detected_problem": "",
            }

        try:
            image_bytes = base64.b64decode(image_base64)
            img = Image.open(io.BytesIO(image_bytes))

            prompt = (
                "Analyze this screenshot from a user reporting a technical issue. "
                "1. Provide a concise description of what is shown in the image. "
                "2. Perform OCR and extract any error messages or key text. "
                "3. Identify the main technical problem depicted. "
                "Return the result in the following format: "
                "Description: <description>\n"
                "OCR: <text>\n"
                "Problem: <problem>"
            )

            response = self.client.models.generate_content(
                model=self.model_name,
                contents=[prompt, img],
            )
            text_response = getattr(response, "text", "") or ""

            description_match = re.search(r"(?:Description|1\.)\s*[:\-]?\s*(.*)", text_response, re.IGNORECASE)
            ocr_match = re.search(r"(?:OCR|2\.)\s*[:\-]?\s*(.*)", text_response, re.IGNORECASE)
            problem_match = re.search(r"(?:Problem|3\.)\s*[:\-]?\s*(.*)", text_response, re.IGNORECASE)

            return {
                "image_description": description_match.group(1).strip() if description_match else text_response[:500],
                "ocr_text": ocr_match.group(1).strip() if ocr_match else "",
                "detected_problem": problem_match.group(1).strip() if problem_match else "",
            }

        except Exception as e:
            logger.error(f"[GeminiService] Image Analysis Error: {e}")
            return {
                "image_description": f"Error analyzing image: {str(e)}",
                "ocr_text": "",
                "detected_problem": "",
            }

    def get_summary(self, ticket_text: str) -> str:
        """Generate a concise, one-line summary of the ticket text."""
        cleaned_text = str(ticket_text or "").strip()
        fallback = cleaned_text[:100] + ("…" if len(cleaned_text) > 100 else "")

        if not self.is_available() or not cleaned_text:
            return fallback

        try:
            prompt = (
                "You are an expert IT triage specialized in extreme brevity. "
                "Summarize the following IT support ticket into exactly ONE concise, hard-hitting line (max 15 words) "
                "that captures the technical essence. NO intro, NO filler, just the core problem headline. "
                f"Ticket: '{cleaned_text}'"
            )
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt,
            )
            text = getattr(response, "text", "") or ""
            return text.strip().replace("\n", " ") or fallback
        except Exception as e:
            logger.error(f"[GeminiService] Summarization Error: {e}")
            return fallback

    def get_reasoning(self, ticket_text: str, category: str, team: str) -> dict:
        """Get a deeper AI explanation and key takeaways for the ticket."""
        if not self.is_available() or not ticket_text:
            return {"reasoning": "", "highlights": []}

        try:
            prompt = (
                f"Analyze this IT support ticket: '{ticket_text}'\n"
                f"It was categorized as '{category}' and routed to '{team}'.\n\n"
                "Please provide:\n"
                "1. Reasoning: A professional explanation of why this category/team was chosen (max 2 sentences).\n"
                "2. Highlights: 2-3 key technical points or symptoms mentioned in the ticket (short bullets).\n"
                "\nFormat the output strictly as:\n"
                "REASONING: <text>\n"
                "HIGHLIGHTS: <point1> | <point2> | <point3>"
            )
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt,
            )
            text_response = (getattr(response, "text", "") or "").strip()

            reasoning_match = re.search(r"REASONING:\s*(.*)", text_response, re.IGNORECASE)
            highlights_match = re.search(r"HIGHLIGHTS:\s*(.*)", text_response, re.IGNORECASE)

            reasoning = reasoning_match.group(1).strip() if reasoning_match else ""
            highlights_raw = highlights_match.group(1).strip() if highlights_match else ""
            highlights = [h.strip() for h in highlights_raw.split("|") if h.strip()]

            return {
                "reasoning": reasoning,
                "highlights": highlights,
            }
        except Exception as e:
            logger.error(f"[GeminiService] Reasoning Error: {e}")
            return {"reasoning": "", "highlights": []}

    def get_troubleshooting_step(self, ticket_text: str, history: list[dict], category: str) -> dict:
        """Get the next troubleshooting step from Gemini based on conversation history.

        Returns structured fallback if API key is missing or unhandled error occurs (Issue #4085).
        """
        if not self.is_available():
            return {
                "step_text": "AI Troubleshooting is currently unavailable.",
                "options": ["Try again later"],
                "is_final": True,
            }

        try:
            history_str = ""
            for msg in (history or []):
                role = "User" if msg.get("role") == "user" else "AI"
                history_str += f"{role}: {msg.get('text', '')}\n"

            prompt = (
                f"You are an expert IT support assistant. A user is reporting this issue: '{ticket_text}' (Category: {category}).\n\n"
                f"Previous conversation:\n{history_str}\n"
                "Provide the NEXT troubleshooting step. Follow these rules:\n"
                "1. If the issue seems resolved based on history, or if you've exhausted basic steps, set is_final: True.\n"
                "2. Provide exactly 2-3 short, actionable user options (e.g., 'Yes, I did that', 'I need help').\n"
                "3. Keep the bot message concise and professional.\n\n"
                "Format your response EXACTLY like this:\n"
                "STEP: <the instructions for the user>\n"
                "OPTIONS: <option1> | <option2> | <option3>\n"
                "FINAL: <True/False>"
            )

            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt,
            )
            text_response = (getattr(response, "text", "") or "").strip()

            step_match = re.search(r"STEP:\s*(.*)", text_response, re.IGNORECASE)
            options_match = re.search(r"OPTIONS:\s*(.*)", text_response, re.IGNORECASE)
            final_match = re.search(r"FINAL:\s*(True|False)", text_response, re.IGNORECASE)

            step_text = step_match.group(1).strip() if step_match else "Let's try checking your settings."
            raw_options = options_match.group(1).strip() if options_match else "Done | Stuck"
            options = [o.strip() for o in raw_options.split("|") if o.strip()]

            return {
                "step_text": step_text,
                "options": options or ["Done", "Stuck"],
                "is_final": final_match.group(1).lower() == "true" if final_match else False,
            }
        except Exception as e:
            logger.error(f"[GeminiService] Troubleshooting Error: {e}")
            return {
                "step_text": "I encountered an error. Let's try one more basic check.",
                "options": ["Okay", "Skip to agent"],
                "is_final": False,
            }

    def analyze_bug_report(self, bug_title: str, description: str, steps: str, errors: list) -> str:
        """Analyze a bug report and captured console errors to generate a Probable Cause."""
        fallback_msg = "AI Diagnostics unavailable (API key missing or disconnected)."
        if not self.is_available():
            return fallback_msg

        try:
            errors_schema = "\n".join([f"- {err}" for err in errors]) if errors else "None captured."
            prompt = (
                f"You are a Level 3 Senior System Engineer diagnosing a bug report.\n"
                f"Title: {bug_title}\n"
                f"Description: {description}\n"
                f"Steps to reproduce: {steps}\n"
                f"Captured Console/Network Errors: \n{errors_schema}\n\n"
                "Based on this exact telemetry and report, provide a concise 'Probable Root Cause' (1-3 sentences maximum). "
                "Focus purely on technical inference and what the developer should investigate first. "
                "Do not include pleasantries. Do not say 'The probable cause is', just state the technical theory."
            )

            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt,
            )
            return (getattr(response, "text", "") or "").strip() or fallback_msg
        except Exception as e:
            logger.error(f"[GeminiService] Bug Analysis Error: {e}")
            return f"Diagnostic analysis failed: {str(e)}"
