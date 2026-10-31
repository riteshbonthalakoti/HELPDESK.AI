import os
import base64
import io
import re
from PIL import Image
from google import genai
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables from backend/.env
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

class GeminiService:
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        self._initialized = False
        self.model_name = 'gemma-3-27b-it'
        
        if self.api_key:
            try:
                self.client = genai.Client(api_key=self.api_key)
                self._initialized = True
                print(f"[GeminiService] Connected to Google GenAI API (Model: {self.model_name})")
            except Exception as e:
                print(f"[GeminiService] Initialization Error: {e}")
        else:
            print("[GeminiService] WARNING: GEMINI_API_KEY not found in environment.")

    def analyze_image(self, image_base64: str, text: str = "") -> dict:
        """
        Perform OCR and image analysis using Gemini logic.
        """
        if not self._initialized:
            return {
                "image_description": "[Gemini API Key Missing] Could not analyze image.",
                "ocr_text": "",
                "detected_problem": ""
            }

        try:
            # Decode base64 image (actually the new SDK handles base64 easily if we just pass bytes, 
            # but we can also use PIL if we need to process it)
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
                contents=[prompt, img]
            )
            text_response = response.text

            description_match = re.search(r"(?:Description|1\.)\s*[:\-]?\s*(.*)", text_response, re.IGNORECASE)
            ocr_match = re.search(r"(?:OCR|2\.)\s*[:\-]?\s*(.*)", text_response, re.IGNORECASE)
            problem_match = re.search(r"(?:Problem|3\.)\s*[:\-]?\s*(.*)", text_response, re.IGNORECASE)

            return {
                "image_description": description_match.group(1).strip() if description_match else text_response[:500],
                "ocr_text": ocr_match.group(1).strip() if ocr_match else "",
                "detected_problem": problem_match.group(1).strip() if problem_match else ""
            }

        except Exception as e:
            print(f"[GeminiService] Image Analysis Error: {e}")
            return {
                "image_description": f"Error analyzing image: {str(e)}",
                "ocr_text": "",
                "detected_problem": ""
            }

    def diagnose_screenshot(self, image_base64: str, text: str = "") -> dict:
        """
        Analyze screenshot attachments and extract structured multi-modal diagnostics:
        - detected_application: string (e.g. 'Outlook', 'Windows Terminal', 'BSOD')
        - error_code: string | null (e.g. '0x0000007B', 'ERR_CONNECTION_REFUSED', None)
        - root_cause_hypothesis: string
        - recommended_remediation: string
        - status: string ('success', 'degraded', 'error', 'invalid_input')
        """
        fallback_result = {
            "detected_application": "Unknown Application",
            "error_code": None,
            "root_cause_hypothesis": "AI Vision diagnostics unavailable (API key missing or disconnected).",
            "recommended_remediation": "Review system logs or submit textual details of the error.",
            "status": "degraded"
        }

        if not self._initialized or not getattr(self, "client", None):
            return fallback_result

        if not image_base64 or not str(image_base64).strip():
            return {
                "detected_application": "None",
                "error_code": None,
                "root_cause_hypothesis": "No image payload provided for vision diagnostics.",
                "recommended_remediation": "Attach a valid PNG or JPEG screenshot for vision inspection.",
                "status": "invalid_input"
            }

        try:
            clean_b64 = image_base64
            if "," in clean_b64:
                clean_b64 = clean_b64.split(",", 1)[1]

            image_bytes = base64.b64decode(clean_b64)
            img = Image.open(io.BytesIO(image_bytes))

            prompt = (
                "You are an expert IT Tier 3 Support and Diagnostics Engineer inspecting a user screenshot.\n"
                "Analyze the screenshot (UI modals, terminal windows, application crashes, dialogs, BSOD, or system tray alerts).\n"
                f"{f'User Context: {text}' if text else ''}\n"
                "Return a strict JSON object with EXACTLY the following keys:\n"
                "{\n"
                '  "detected_application": "<name of the foreground application or OS screen>",\n'
                '  "error_code": "<specific error code or hex identifier like 0x80070005, or null if none>",\n'
                '  "root_cause_hypothesis": "<concise explanation of why this error or crash occurred>",\n'
                '  "recommended_remediation": "<actionable step-by-step fix or troubleshooting guidance>"\n'
                "}\n"
                "Do not include markdown code fence formatting. Return raw JSON only."
            )

            vision_model = os.getenv("GEMINI_VISION_MODEL", "gemini-1.5-flash")
            try:
                response = self.client.models.generate_content(
                    model=vision_model,
                    contents=[prompt, img]
                )
            except Exception:
                response = self.client.models.generate_content(
                    model=self.model_name,
                    contents=[prompt, img]
                )

            text_response = (response.text or "").strip()

            if text_response.startswith("```"):
                text_response = re.sub(r"^```(?:json)?\s*", "", text_response)
                text_response = re.sub(r"\s*```$", "", text_response)

            import json
            try:
                parsed = json.loads(text_response)
                return {
                    "detected_application": parsed.get("detected_application") or "General System",
                    "error_code": parsed.get("error_code"),
                    "root_cause_hypothesis": parsed.get("root_cause_hypothesis") or "Application error identified in UI.",
                    "recommended_remediation": parsed.get("recommended_remediation") or "Restart application and check connection.",
                    "status": "success"
                }
            except json.JSONDecodeError:
                app_match = re.search(r'"detected_application"\s*:\s*"([^"]+)"', text_response)
                code_match = re.search(r'"error_code"\s*:\s*(?:"([^"]+)"|(null))', text_response)
                rc_match = re.search(r'"root_cause_hypothesis"\s*:\s*"([^"]+)"', text_response)
                rem_match = re.search(r'"recommended_remediation"\s*:\s*"([^"]+)"', text_response)

                return {
                    "detected_application": app_match.group(1) if app_match else "Detected in Screenshot",
                    "error_code": None if (not code_match or code_match.group(2) == "null") else code_match.group(1),
                    "root_cause_hypothesis": rc_match.group(1) if rc_match else text_response[:200],
                    "recommended_remediation": rem_match.group(1) if rem_match else "Verify system environment and dependencies.",
                    "status": "partial_json_recovered"
                }

        except Exception as e:
            print(f"[GeminiService] Vision Diagnostics Error: {e}")
            return {
                "detected_application": "Unknown (Analysis Error)",
                "error_code": None,
                "root_cause_hypothesis": f"Diagnostics failed: {str(e)}",
                "recommended_remediation": "Manual technical review required.",
                "status": "error"
            }

    def get_summary(self, ticket_text: str) -> str:
        """
        Generate a concise, one-line summary of the ticket text.
        """
        if not self._initialized:
            return ticket_text[:100] + ("…" if len(ticket_text) > 100 else "")

        try:
            prompt = (
                "You are an expert IT triage specialized in extreme brevity. "
                "Summarize the following IT support ticket into exactly ONE concise, hard-hitting line (max 15 words) "
                "that captures the technical essence. NO intro, NO filler, just the core problem headline. "
                f"Ticket: '{ticket_text}'"
            )
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt
            )
            return response.text.strip().replace("\n", " ")
        except Exception as e:
            print(f"[GeminiService] Summarization Error: {e}")
            return ticket_text[:100] + ("…" if len(ticket_text) > 100 else "")

    def get_reasoning(self, ticket_text: str, category: str, team: str) -> dict:
        """
        Get a deeper AI explanation and key takeaways for the ticket.
        """
        if not self._initialized:
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
                contents=prompt
            )
            text_response = response.text.strip()

            reasoning_match = re.search(r"REASONING:\s*(.*)", text_response, re.IGNORECASE)
            highlights_match = re.search(r"HIGHLIGHTS:\s*(.*)", text_response, re.IGNORECASE)

            reasoning = reasoning_match.group(1).strip() if reasoning_match else ""
            highlights_raw = highlights_match.group(1).strip() if highlights_match else ""
            highlights = [h.strip() for h in highlights_raw.split("|") if h.strip()]

            return {
                "reasoning": reasoning,
                "highlights": highlights
            }
        except Exception as e:
            print(f"[GeminiService] Reasoning Error: {e}")
            return {"reasoning": "", "highlights": []}

    def get_troubleshooting_step(self, ticket_text: str, history: list[dict], category: str) -> dict:
        """
        Get the next troubleshooting step from Gemini based on conversation history.
        """
        if not self._initialized:
            return {
                "step_text": "AI Troubleshooting is currently unavailable.",
                "options": ["Try again later"],
                "is_final": True
            }

        try:
            history_str = ""
            for msg in history:
                role = "User" if msg["role"] == "user" else "AI"
                history_str += f"{role}: {msg['text']}\n"

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
                contents=prompt
            )
            text_response = response.text.strip()

            step_match = re.search(r"STEP:\s*(.*)", text_response, re.IGNORECASE)
            options_match = re.search(r"OPTIONS:\s*(.*)", text_response, re.IGNORECASE)
            final_match = re.search(r"FINAL:\s*(True|False)", text_response, re.IGNORECASE)

            return {
                "step_text": step_match.group(1).strip() if step_match else "Let's try checking your settings.",
                "options": [o.strip() for o in (options_match.group(1).strip() if options_match else "Done | Stuck").split("|") if o.strip()],
                "is_final": final_match.group(1).lower() == "true" if final_match else False
            }
        except Exception as e:
            print(f"[GeminiService] Troubleshooting Error: {e}")
            return {
                "step_text": "I encountered an error. Let's try one more basic check.",
                "options": ["Okay", "Skip to agent"],
                "is_final": False
            }

    def analyze_bug_report(self, bug_title: str, description: str, steps: str, errors: list) -> str:
        """
        Analyze a bug report and captured console errors to generate a Probable Cause.
        """
        if not self._initialized:
            return "AI Diagnostics unavailable (API key missing or disconnected)."

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
                contents=prompt
            )
            return response.text.strip()
        except Exception as e:
            print(f"[GeminiService] Bug Analysis Error: {e}")
            return f"Diagnostic analysis failed: {str(e)}"
