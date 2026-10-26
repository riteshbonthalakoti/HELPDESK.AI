"""
FastAPI Backend — AI Helpdesk Ticket Analyzer
POST /ai/analyze_ticket  →  full analysis of a support ticket
GET  /health             →  service health check
"""

import os
import sys
import uuid
import json
import datetime
import traceback
import warnings
import logging
import hashlib
from contextlib import asynccontextmanager

# Suppress harmless PyTorch CPU pin_memory warning
warnings.filterwarnings("ignore", message="'pin_memory'")

# HF Rebuild Trigger: 2026-03-08-2030
from fastapi import FastAPI, Depends, HTTPException, Request, Response, Header
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.encoders import jsonable_encoder
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# Load environment variables from backend/.env
env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=env_path)

# Request size limits (in bytes)
MAX_UPLOAD_SIZE = int(os.environ.get("MAX_UPLOAD_SIZE", "100")) * 1024 * 1024  # 100MB default
MAX_JSON_SIZE = int(os.environ.get("MAX_JSON_SIZE", "10")) * 1024 * 1024  # 10MB default

# OCR / image constraints
MAX_IMAGE_BASE64_CHARS = int(os.environ.get("MAX_IMAGE_BASE64_CHARS", "5000000"))  # ~3.75MB raw bytes (base64 chars)

# Request ID tracking for observability
# Use context-local storage to avoid cross-request bleed in async environments.
from contextvars import ContextVar
_request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)


# Initialize Supabase Client (Service Role for backend bypass)
try:
    from supabase import create_client, Client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("[ERROR] SUPABASE_URL or SUPABASE_SERVICE_KEY not set in backend/.env")
        supabase = None
    else:
        supabase = create_client(url, key)
        # Enable connection pooling (Supabase uses connection pooling internally)
        # Additional config for timeout and retry policy
        if hasattr(supabase, 'postgrest'):
            supabase.postgrest._client_options = {
                'timeout': 30,  # 30 second timeout for queries
                'retries': 3,   # Retry failed queries up to 3 times
            }
        print("[Supabase] Connection pooling enabled (Supabase handles pooling internally)")
except (ImportError, Exception) as e:
    print(f"[WARNING] Supabase initialization failed: {e}")
    supabase = None
    Client = None

# Query result caching (in-memory cache for frequently accessed queries)
import threading
_cache_lock = threading.Lock()
_query_cache = {}
_cache_ttl = int(os.environ.get("QUERY_CACHE_TTL", "300"))  # 5 minutes default

# Ensure project root is on path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.services.classifier_service import ClassifierService
from backend.services.classifier_v2 import classifier_v2
from backend.services.classifier_v3 import classifier_v3  # V3 Power Model
from backend.services.ner_service import NERService
from backend.services.duplicate_service import DuplicateService
from backend.services.rag_service import RagService


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------
def get_system_settings(company_id: str) -> dict:
    defaults = {
        "ai_confidence_threshold": 0.80,
        "duplicate_sensitivity": 0.85,
        "enable_auto_resolve": False,
    }
    if not supabase or not company_id:
        return defaults
    
    # Check cache first
    cache_key = f"system_settings:{company_id}"
    with _cache_lock:
        if cache_key in _query_cache:
            cached_data, cached_time = _query_cache[cache_key]
            if datetime.datetime.now().timestamp() - cached_time < _cache_ttl:
                return cached_data
    
    try:
        res = (
            supabase.table("system_settings")
            .select("ai_confidence_threshold, duplicate_sensitivity, enable_auto_resolve")
            .eq("company_id", company_id)
            .single()
            .execute()
        )
        if res.data:
            result = {**defaults, **res.data}
        else:
            result = defaults
    except Exception as e:
        print(f"[WARNING] Could not fetch system_settings for company_id={company_id}: {e}")
        result = defaults
    
    # Cache the result
    with _cache_lock:
        _query_cache[cache_key] = (result, datetime.datetime.now().timestamp())
    
    return result


class TicketRequest(BaseModel):
    text: str
    image_base64: str = ""
    image_text: str = ""  # Keep for backward compatibility
    user_id: str | None = None
    company: str | None = None
    image_url: str | None = None
    confidence_threshold: float = 0.20
    duplicate_sensitivity: float = 0.85


class TicketSaveRequest(BaseModel):
    user_id: str
    subject: str
    description: str
    category: str
    subcategory: str
    priority: str
    assigned_team: str
    status: str
    auto_resolve: bool
    is_duplicate: bool
    confidence: float
    image_url: str | None = None
    company: str | None = None
    company_id: str | None = None
    sla_breach_at: str
    metadata: dict
    entities: list = Field(default_factory=list)
    solution_steps: list = Field(default_factory=list)
    ocr_text: str = ""
    needs_review: bool = False
    routing_confidence: float


class DuplicateInfo(BaseModel):
    is_duplicate: bool
    duplicate_ticket_id: str | None = None
    similarity: float = 0.0


class EntityInfo(BaseModel):
    text: str
    label: str
    confidence: float


class TicketResponse(BaseModel):
    id: str | int | None = None
    ticket_id: str | None = None
    summary: str
    category: str
    subcategory: str
    priority: str
    auto_resolve: bool
    assigned_team: str
    entities: list[EntityInfo]
    duplicate_ticket: DuplicateInfo
    confidence: float
    needs_review: bool = False
    reasoning: str = ""
    decision_factors: list[str] = Field(default_factory=list)
    image_description: str = ""
    ocr_text: str = ""
    image_url: str | None = None
    highlights: list[str] = Field(default_factory=list)
    timeline: dict = Field(default_factory=dict)  # Map of step_name: timestamp
    env_metadata: dict = Field(default_factory=dict)  # IP, Hostname, Browser/OS
    sla_breach_at: str | None = None
    version: str = "2.1.0-Neural-Diagnostic"


# --- Persistence Models ---
class Message(BaseModel):
    sender: str
    message: str
    timestamp: str


class TicketRecord(BaseModel):
    ticket_id: str
    owner_id: str
    summary: str
    category: str
    subcategory: str
    priority: str
    status: str
    assigned_team: str
    created_at: str
    updated_at: str | None = None
    last_user_viewed_at: str | None = None
    messages: list[Message] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)
    timeline: dict = Field(default_factory=dict)  # Milestones: created, analyzed, triaged, routed, in_progress, resolved


# --- In-Memory Database (to be replaced with SQL later) ---
TICKETS_DB: list[TicketRecord] = []


class HealthResponse(BaseModel):
    status: str
    classifier_loaded: bool
    ner_loaded: bool


class ReadinessResponse(BaseModel):
    status: str
    checks: dict[str, bool]


# ---------------------------------------------------------------------------
# Service singletons
# ---------------------------------------------------------------------------
classifier_service = ClassifierService()
ner_service = NERService()
duplicate_service = DuplicateService()
rag_service = RagService()

try:
    from backend.services.gemini_service import GeminiService

    gemini_service = GeminiService()
except ImportError:
    gemini_service = None

try:
    from backend.services.ocr_service import OCRService

    ocr_service = OCRService()
except ImportError:
    ocr_service = None


# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown)
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load all models at startup."""
    print("[Startup] Loading AI models ...")
    try:
        classifier_service.load()
    except Exception as e:
        print(f"[WARNING] Classifier not loaded: {e}")
    try:
        ner_service.load()
    except Exception as e:
        print(f"[WARNING] NER not loaded: {e}")
    try:
        duplicate_service.load()
    except Exception as e:
        print(f"[WARNING] Duplicate service not loaded: {e}")
    try:
        rag_service.load()
    except Exception as e:
        print(f"[WARNING] RAG service not loaded: {e}")

    if gemini_service:
        print(
            f"[Startup] Gemini Service: {'Initialized' if gemini_service._initialized else 'FAILED (Key missing or SDK error)'}"
        )
    else:
        print("[Startup] Gemini Service: NOT LOADED (Import failed)")

    print("[Startup] Classifier V2 Shadow: Ready.")
    print("[Startup] Ready.")

    # Strict health checks: fail loudly when core model assets are unavailable.
    # Set ALLOW_DEGRADED_STARTUP=1 to permit degraded startup for local/dev convenience.
    try:
        strict_mode = os.environ.get("ALLOW_DEGRADED_STARTUP", "0") != "1"
    except Exception:
        strict_mode = True

    classifier_loaded_flag = getattr(classifier_service, "_loaded", False)
    ner_loaded_flag = getattr(ner_service, "_loaded", False)

    if strict_mode and not classifier_loaded_flag:
        raise RuntimeError(
            "[Startup-FATAL] Classifier assets not loaded. Set ALLOW_DEGRADED_STARTUP=1 to bypass."
        )

    # ── Background Workers ───────────────────────────────────────────────────
    auto_close_task = None
    try:
        from backend.services.auto_close_service import AutoCloseService
        async def _run_auto_close_loop():
            svc = AutoCloseService()
            while True:
                try:
                    await asyncio.to_thread(svc.run)
                except Exception as ex:
                    print(f"[AutoCloseService] Loop warning: {ex}")
                interval = int(os.environ.get("AUTO_CLOSE_INTERVAL_SECONDS", "3600"))
                await asyncio.sleep(interval)

        auto_close_task = asyncio.create_task(_run_auto_close_loop())
        print("[Startup] AutoCloseService: background sweep loop started.")
    except Exception as e:
        print(f"[Startup] AutoCloseService background task not started: {e}")

    # ── SLA Auto-Escalation Worker Loop ──────────────────────────────────
    sla_escalation_task = None
    try:
        from backend.services.sla_escalation_service import SLAEscalationService

        async def _run_sla_escalation_loop():
            svc = SLAEscalationService()
            while True:
                try:
                    if supabase:
                        await asyncio.to_thread(svc.run_sweep, supabase)
                except Exception as ex:
                    print(f"[SLAEscalationService] Background loop warning: {ex}")
                interval = int(os.environ.get("SLA_SWEEP_INTERVAL_SECONDS", "300"))
                await asyncio.sleep(interval)

        sla_escalation_task = asyncio.create_task(_run_sla_escalation_loop())
        print("[Startup] SLAEscalationService: background escalation worker started.")
    except Exception as e:
        print(f"[Startup] SLAEscalationService background task not started: {e}")

    yield

    if auto_close_task:
        auto_close_task.cancel()
    if sla_escalation_task:
        sla_escalation_task.cancel()
    print("[Shutdown] Cleaning up ...")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="AI Helpdesk Backend",
    description="Ticket classification, entity extraction, and duplicate detection",
    version="1.0.0",
    lifespan=lifespan,
)

# Unified middleware: enforce request size limits + add X-Request-ID tracking
@app.middleware("http")
async def limit_request_size_and_add_request_id(request: Request, call_next):
    """Enforce maximum request body size and attach request IDs for tracing."""

    # Add request ID tracking for distributed tracing and logging.
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    request.state.request_id = request_id
    _request_id_ctx.set(request_id)

    try:
        # Enforce maximum request body size to prevent DoS attacks.
        if request.method in ["POST", "PATCH", "PUT"]:
            content_length = request.headers.get("content-length")
            if content_length:
                try:
                    size = int(content_length)
                    if size > MAX_JSON_SIZE:
                        return JSONResponse(
                            status_code=413,
                            content={"detail": f"Request body too large (max: {MAX_JSON_SIZE} bytes)"},
                        )
                except ValueError:
                    pass

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response
    finally:
        _request_id_ctx.set(None)



# Rate limiter — 10 AI requests per minute per IP (free tier protection)
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — locked to production + local dev only
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://helpdeskaiv1.vercel.app",
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Root & Health check
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def root():
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>HELPDESK.AI - API Engine</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Inter', sans-serif; background-color: #0f172a; color: #f8fafc; }
            .glass-card {
                background: rgba(30, 41, 59, 0.7);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            }
            .gradient-text {
                background: linear-gradient(to right, #10b981, #3b82f6);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .btn-hover { transition: all 0.2s ease-in-out; }
            .btn-hover:hover { transform: translateY(-2px); text-decoration: none; }
        </style>
    </head>
    <body class="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden">
        
        <!-- Abstract Background Orbs -->
        <div class="absolute top-[-10%] left-[-10%] w-[40vw] h-[40vw] rounded-full bg-emerald-600/20 blur-[120px] pointer-events-none"></div>
        <div class="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] rounded-full bg-blue-600/20 blur-[120px] pointer-events-none"></div>

        <div class="glass-card rounded-2xl p-10 max-w-2xl w-full text-center relative z-10">
            <div class="mb-6 flex justify-center">
                <div class="bg-emerald-500/20 p-4 rounded-full border border-emerald-500/30">
                    <svg class="w-12 h-12 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                </div>
            </div>
            
            <h1 class="text-4xl md:text-5xl font-bold mb-4">HELPDESK<span class="gradient-text">.AI</span></h1>
            <p class="text-slate-400 text-lg mb-8">Next-Generation IT Ticket Inference Engine</p>
            <div class="inline-flex items-center space-x-2 bg-emerald-500/10 text-emerald-400 px-4 py-2 rounded-full border border-emerald-500/20 mb-10 text-sm font-semibold tracking-wide">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>System Online • v1.0.0</span>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                <!-- API Docs Button -->
                <a href="/docs" class="btn-hover block w-full bg-slate-800/80 border border-slate-700 hover:border-emerald-500/50 hover:bg-slate-700/80 rounded-xl p-5 group">
                    <h3 class="font-bold text-white mb-1 group-hover:text-emerald-400 transition-colors">Interactive API Docs</h3>
                    <p class="text-slate-400 text-sm text-center md:text-left">Test endpoints natively via Swagger UI</p>
                </a>
                
                <!-- Frontend Button -->
                <a href="https://helpdeskaiv1.vercel.app/" target="_blank" class="btn-hover block w-full bg-slate-800/80 border border-slate-700 hover:border-blue-500/50 hover:bg-slate-700/80 rounded-xl p-5 group">
                    <h3 class="font-bold text-white mb-1 group-hover:text-blue-400 transition-colors">Client Web Portal</h3>
                    <p class="text-slate-400 text-sm text-center md:text-left">Access the React/Vite dashboard</p>
                </a>

                <!-- System Health Button -->
                <a href="/health" class="btn-hover block w-full bg-slate-800/80 border border-slate-700 hover:border-emerald-500/50 hover:bg-slate-700/80 rounded-xl p-5 group md:col-span-2">
                        <div class="flex items-center justify-between">
                        <div>
                            <h3 class="font-bold text-white mb-1 group-hover:text-emerald-400 transition-colors">System Health Check</h3>
                            <p class="text-slate-400 text-sm text-center md:text-left">Verify AI model loading statuses</p>
                        </div>
                        <svg class="w-6 h-6 text-slate-500 group-hover:text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                </a>
            </div>
            
            <div class="mt-10 pt-6 border-t border-slate-800 text-sm text-slate-500">
                Powered by FastAPI & Hugging Face Transformers
            </div>
        </div>
    </body>
    </html>
    """


@app.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        status="ok",
        classifier_loaded=classifier_service._loaded,
        ner_loaded=ner_service._loaded,
    )


@app.get("/ready", response_model=ReadinessResponse)
async def readiness_check():
    require_supabase = os.environ.get("REQUIRE_SUPABASE", "false").lower() == "true"
    allow_degraded = os.environ.get("ALLOW_DEGRADED_STARTUP", "0") == "1"

    checks = {
        "api": True,
        "classifier_loaded": classifier_service._loaded,
        "ner_loaded": ner_service._loaded,
        "duplicate_index_loaded": duplicate_service.is_available(),
        "rag_loaded": rag_service.is_available(),
    }
    if require_supabase:
        checks["supabase_configured"] = supabase is not None

    # In degraded mode, duplicate and RAG services are optional
    if allow_degraded:
        required_checks = {
            k: v
            for k, v in checks.items()
            if k not in ["duplicate_index_loaded", "rag_loaded"]
        }
        all_required_pass = all(required_checks.values())

        if all_required_pass:
            return ReadinessResponse(status="ready", checks=checks)
    else:
        # Strict mode: all checks must pass
        if all(checks.values()):
            return ReadinessResponse(status="ready", checks=checks)

    return JSONResponse(
        status_code=503,
        content=jsonable_encoder(ReadinessResponse(status="not_ready", checks=checks)),
    )


# ---------------------------------------------------------------------------
# Auto-Close Endpoints
# ---------------------------------------------------------------------------
@app.get("/internal/auto-close/status")
async def auto_close_status():
    """Get status and configuration of AutoCloseService."""
    from backend.services.auto_close_service import get_instance, load as load_auto_close

    svc = get_instance() or load_auto_close()
    return {
        "status": "ready",
        "enabled": getattr(svc, "enabled", True),
        "default_auto_close_days": getattr(svc, "default_auto_close_days", 7),
        "cron_schedule": getattr(svc, "cron_schedule", "0 2 * * *"),
    }


@app.post("/internal/auto-close/run")
async def trigger_auto_close(authorization: str | None = Header(None)):
    """Trigger an on-demand AutoClose sweep.

    Can be called manually, via external cron (e.g. Vercel Cron, GitHub Actions), or admin tooling.
    Secured by INTERNAL_CRON_SECRET if configured in the environment.
    """
    cron_secret = os.environ.get("INTERNAL_CRON_SECRET")
    if cron_secret and authorization != f"Bearer {cron_secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        from backend.services.auto_close_service import load as load_auto_close

        svc = load_auto_close()
        result = await asyncio.to_thread(svc.run)
        return {"status": "success", "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class TroubleshootRequest(BaseModel):
    text: str
    category: str
    history: list[dict] = Field(default_factory=list)


class TroubleshootResponse(BaseModel):
    step_text: str
    options: list[str]
    is_final: bool


@app.post("/ai/troubleshoot", response_model=TroubleshootResponse)
async def troubleshoot(request: TroubleshootRequest):
    """Get dynamic troubleshooting steps from Gemini."""
    if not gemini_service or not gemini_service._initialized:
        return TroubleshootResponse(
            step_text="AI Troubleshooting is currently unavailable.",
            options=["Continue to tracking"],
            is_final=True,
        )

    result = gemini_service.get_troubleshooting_step(
        request.text,
        request.history,
        request.category,
    )
    return TroubleshootResponse(**result)


class BugReportAnalysisRequest(BaseModel):
    bug_title: str
    description: str
    steps_to_reproduce: str = ""
    console_errors: list[str] = Field(default_factory=list)


class BugReportAnalysisResponse(BaseModel):
    probable_cause: str


@app.post("/ai/analyze_bug", response_model=BugReportAnalysisResponse)
async def analyze_bug(request: BugReportAnalysisRequest):
    """Analyze a bug report using Gemini to generate a Probable Cause."""
    if not gemini_service or not gemini_service._initialized:
        return BugReportAnalysisResponse(probable_cause="AI Diagnostics are currently unavailable.")

    cause = gemini_service.analyze_bug_report(
        request.bug_title,
        request.description,
        request.steps_to_reproduce,
        request.console_errors,
    )
    return BugReportAnalysisResponse(probable_cause=cause)


# ---------------------------------------------------------------------------
# Admin Correction Logging endpoint
# ---------------------------------------------------------------------------
CORRECTIONS_LOG_PATH = Path(__file__).parent / "data" / "corrections_log.json"
import threading
_corrections_lock = threading.Lock()


@app.post("/ai/log_correction")
async def log_correction(raw_request: Request, user: dict = Depends(get_current_user)):
    """Log an admin correction when the AI prediction differs from the human decision.
    
    Requires authentication. Only admin users can log corrections.
    """
    try:
        body = await raw_request.json()
    except Exception as e:
        print(f"[CORRECTION ERROR] Could not parse request body: {e}")
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    # Verify user has admin/senior role
    user_role = user.get("user_metadata", {}).get("role", "user")
    if user_role not in ["admin", "senior_analyst"]:
        raise HTTPException(status_code=403, detail="Only admins can log corrections")

    print(f"[CORRECTION RECEIVED] User: {user.get('id')} | Payload keys: {list(body.keys())}")

    ticket_id = str(body.get("ticket_id", "unknown"))
    original_text = str(body.get("original_text", ""))
    ocr_text = str(body.get("ocr_text", ""))
    confidence = float(body.get("confidence") or 0.0)
    original_prediction = body.get("original_prediction") or {}
    corrected_prediction = body.get("corrected_prediction") or {}

    # Only log if something actually changed
    changed_fields = [
        field
        for field in ["category", "subcategory", "priority", "assigned_team"]
        if original_prediction.get(field) != corrected_prediction.get(field)
    ]

    if not changed_fields:
        return {"status": "no_change", "message": "Prediction matches correction, nothing logged."}

    entry = {
        "ticket_id": ticket_id,
        "original_text": original_text,
        "ocr_text": ocr_text,
        "original_prediction": original_prediction,
        "corrected_prediction": corrected_prediction,
        "changed_fields": changed_fields,
        "confidence": confidence,
        "corrected_by": user.get("id"),
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
    }

    try:
        with _corrections_lock:
            if CORRECTIONS_LOG_PATH.exists() and CORRECTIONS_LOG_PATH.stat().st_size > 2:
                with open(CORRECTIONS_LOG_PATH, "r", encoding="utf-8") as f:
                    logs = json.load(f)
            else:
                logs = []

            logs.append(entry)

            with open(CORRECTIONS_LOG_PATH, "w", encoding="utf-8") as f:
                json.dump(logs, f, indent=2)

        print(f"[CORRECTION SAVED] Ticket ID: {ticket_id} | Changed: {changed_fields}")
        return {"status": "saved", "changed_fields": changed_fields}

    except Exception as e:
        print(f"[CORRECTION ERROR] Could not save: {e}")
        raise HTTPException(status_code=500, detail="Failed to save correction")


# ---------------------------------------------------------------------------
# Ticket operations (Now via Supabase)
# ---------------------------------------------------------------------------
async def get_user_company_id(user: dict) -> str:
    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authenticated user")
    try:
        profile_res = (
            supabase.table("profiles")
            .select("company_id")
            .eq("id", user_id)
            .single()
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=403, detail="Could not verify user company") from exc

    company_id = profile_res.data.get("company_id") if profile_res.data else None
    if not company_id:
        raise HTTPException(status_code=403, detail="User has no company assignment")
    return company_id


@app.get("/tickets")
async def get_tickets(user: dict = Depends(get_current_user), company_id: str | None = None):
    """Fetch persistent tickets from Supabase."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database connection not initialized")

    user_company_id = await get_user_company_id(user)
    if company_id and company_id != user_company_id:
        raise HTTPException(status_code=403, detail="Not authorized to access this tenant")

    query = supabase.table("tickets").select("*").order("created_at", desc=True)
    query = query.eq("company_id", user_company_id)

    res = query.execute()
    return res.data


@app.post("/tickets/save")
async def save_ticket(request_body: TicketSaveRequest):
    """OFFICIAL PERSISTENCE: Saves the analyzed ticket to Supabase."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase connection not initialized.")

    logger = logging.getLogger(__name__)
    try:
        final_data = request_body.dict()

        # Resolve tenant linkage from user profile with authorization validation.
        profile = {}
        if request_body.user_id:
            try:
                profile_res = (
                    supabase.table("profiles")
                    .select("company_id, company")
                    .eq("id", request_body.user_id)
                    .single()
                    .execute()
                )
                profile = profile_res.data or {}
                if not profile:
                    raise HTTPException(status_code=404, detail="User profile not found")
            except HTTPException:
                raise
            except Exception as profile_error:
                user_hash = hashlib.sha256(str(request_body.user_id).encode()).hexdigest()[:8]
                logger.error(f"Tenant resolution error for user {user_hash}: {profile_error}")
                raise HTTPException(status_code=503, detail="Failed to resolve tenant linkage") from profile_error

        # Validate tenant consistency and authorization.
        profile_company_id = profile.get("company_id")
        if final_data.get("company_id"):
            if profile_company_id and final_data["company_id"] != profile_company_id:
                user_hash = hashlib.sha256(str(request_body.user_id).encode()).hexdigest()[:8]
                logger.warning(
                    f"Tenant mismatch: user {user_hash} attempted {final_data['company_id']}, assigned to {profile_company_id}"
                )
                raise HTTPException(status_code=403, detail="User not authorized for this tenant")
        elif profile_company_id:
            final_data["company_id"] = profile_company_id
        elif request_body.user_id:
            raise HTTPException(status_code=400, detail="User has no tenant assignment")

        # Backfill company name if missing.
        if not final_data.get("company") and profile.get("company"):
            final_data["company"] = profile["company"]

        user_hash = hashlib.sha256(str(request_body.user_id).encode()).hexdigest()[:8]
        logger.info(f"Tenant linkage: user_hash={user_hash}, company_id={final_data.get('company_id')}")

        res = supabase.table("tickets").insert(final_data).execute()
        if not res.data:
            raise Exception("Failed to insert ticket into database.")

        ticket_id = res.data[0]["id"]

        duplicate_indexed = True
        duplicate_index_warning = None
        description_text = (request_body.description or "").strip()
        subject_text = (request_body.subject or "").strip()
        duplicate_text = description_text or subject_text
        if duplicate_text:
            try:
                duplicate_service.add_ticket(str(ticket_id), duplicate_text)
            except Exception as index_error:
                duplicate_indexed = False
                duplicate_index_warning = "Duplicate index update failed."
                print(
                    f"[WARNING] {duplicate_index_warning} ticket_id={ticket_id} error={index_error}"
                )
        else:
            duplicate_indexed = False
            duplicate_index_warning = (
                "Duplicate index update skipped: no description or subject text was provided."
            )
            print(f"[WARNING] {duplicate_index_warning}")

        # Add initial system diagnostic message
        msg = "Our Neural Engine has successfully triaged your issue and routed it to the designated team."
        if final_data["auto_resolve"]:
            msg = (
                "AI Auto-Resolution active: A verified solution has been identified. Please review the attached resolution steps."
            )

        supabase.table("ticket_messages").insert(
            {
                "ticket_id": ticket_id,
                "sender_id": "00000000-0000-0000-0000-000000000000",  # System ID
                "sender_name": "AI Assistant",
                "sender_role": "admin",
                "message": msg,
            }
        ).execute()

        response = {"status": "success", "ticket_id": ticket_id, "duplicate_indexed": duplicate_indexed}
        if duplicate_index_warning:
            response["duplicate_index_warning"] = duplicate_index_warning
        return response

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tickets/{ticket_id}")
async def get_ticket_by_id(ticket_id: str, user: dict = Depends(get_current_user)):
    """Fetch single persistent ticket. Requires authentication."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database connection not initialized")

    user_company_id = await get_user_company_id(user)

    res = (
        supabase.table("tickets")
        .select("*")
        .eq("id", ticket_id)
        .eq("company_id", user_company_id)
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return res.data


@app.post("/tickets", response_model=TicketRecord)
async def create_ticket(ticket: TicketRecord):
    """Save a new ticket into the system."""
    existing = next((t for t in TICKETS_DB if t.ticket_id == ticket.ticket_id), None)
    if existing:
        return existing

    TICKETS_DB.append(ticket)
    print(f"[DB] Ticket #{ticket.ticket_id} created for user {ticket.owner_id}")
    return ticket


@app.patch("/tickets/{ticket_id}", response_model=TicketRecord)
async def update_ticket(ticket_id: str, updates: dict):
    """Partially update a ticket's fields (e.g., status, viewed_at)."""
    for i, ticket in enumerate(TICKETS_DB):
        if str(ticket.ticket_id) == str(ticket_id):
            ticket_dict = ticket.dict()
            ticket_dict.update(updates)
            updated_ticket = TicketRecord(**ticket_dict)
            TICKETS_DB[i] = updated_ticket
            return updated_ticket

    raise HTTPException(status_code=404, detail="Ticket not found")


# ---------------------------------------------------------------------------
# Main AI Analyzer endpoint
# ---------------------------------------------------------------------------
@app.post("/ai/analyze_ticket", response_model=TicketResponse)
@limiter.limit("10/minute")
async def analyze_ticket(request_body: TicketRequest, request: Request):
    """Main endpoint for analyzing a new ticket using the cascade of local AI models."""

    text = request_body.text

    settings = get_system_settings(request_body.company)
    confidence_threshold = settings["ai_confidence_threshold"]
    duplicate_sensitivity = settings["duplicate_sensitivity"]
    enable_auto_resolve = settings["enable_auto_resolve"]

    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "unknown")
    origin_host = request.headers.get("origin", "unknown")

    env_metadata = {"ip": client_ip, "user_agent": user_agent, "origin": origin_host}

    # --- Layer 1: Local OCR (CPU, no API required) ---
    local_ocr_text = ""
    if request_body.image_base64 and ocr_service:
        # Validate/normalize OCR image payload to avoid crashes/DoS from malformed base64.
        from backend.ocr_json_safety import sanitize_and_validate_base64_image

        try:
            safe_b64 = sanitize_and_validate_base64_image(
                request_body.image_base64,
                max_chars=MAX_IMAGE_BASE64_CHARS,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid image_base64: {e}") from e

        print("[AI] Extracting text via local OCR...")
        local_ocr_text = ocr_service.extract_text(safe_b64)

        if local_ocr_text:
            text = f"{text} {local_ocr_text}".strip()
            print(f"[AI] OCR added {len(local_ocr_text)} chars to context.")

    # Ensure OCR-enriched content is used by the analysis pipeline
    if local_ocr_text:
        request_body = request_body.copy(update={"text": text})

    return await analyze_only(request_body)


@app.post("/ai/analyze")
async def analyze_only(request_body: TicketRequest):
    """PERFORMANCE UPGRADE: AI Analysis phase only (read-only, no persistence)."""

    text = request_body.text
    print(f"[AI] Starting Analysis (READ-ONLY) for: {text[:50]}...")

    settings = get_system_settings(request_body.company)
    confidence_threshold = settings["ai_confidence_threshold"]
    duplicate_sensitivity = settings["duplicate_sensitivity"]
    enable_auto_resolve = settings["enable_auto_resolve"]

    # --- Context & Environment ---
    def get_now_ist():
        return datetime.datetime.utcnow().isoformat() + "Z"

    has_image = bool(request_body.image_base64)
    env_metadata = {
        "timestamp": get_now_ist(),
        "model_version": "3.0.0-PRO",
        "api_endpoint": "/ai/analyze",
        "has_image_base64": has_image,
        "image_base64_length": len(request_body.image_base64) if has_image else 0,
    }

    timeline = {"received": get_now_ist()}

    # --- Vision Logic (OCR Awareness) ---
    gemini_analysis = {"ocr_text": request_body.image_text or "", "image_description": ""}


    vision_requested = bool(request_body.image_base64)
    if request_body.image_base64 and not gemini_analysis["ocr_text"]:
        try:
            print("[AI] Detecting visual context via Gemini...")
            if not gemini_service:
                raise RuntimeError("Gemini service not initialized")
            vision_result = gemini_service.analyze_image(request_body.image_base64)
            gemini_analysis.update(vision_result)
        except Exception as e:
            print(f"[VISION ERROR] {e}")

    summary = text[:100] + ("…" if len(text) > 100 else "")

    # --- Classification ---
    try:
        classification_v3_res = classifier_v3.predict(text)
        if "error" in classification_v3_res:
            classification = classifier_service.predict(text)
        else:
            cat = classification_v3_res.get("Category", {}).get("prediction", "Unknown")
            sub = classification_v3_res.get("Subcategory", {}).get("prediction", "Unknown")
            pri = classification_v3_res.get("priority", {}).get("prediction", "Medium")
            conf = classification_v3_res.get("Category", {}).get("confidence", 0.0)

            from backend.services.classifier_service import TEAM_MAP, AUTO_RESOLVE_SUBS

            assigned_team = TEAM_MAP.get(cat, "General Support")
            auto_resolve = sub in AUTO_RESOLVE_SUBS

            classification = {
                "category": cat,
                "subcategory": sub,
                "priority": pri,
                "auto_resolve": auto_resolve,
                "assigned_team": assigned_team,
                "confidence": float(conf),
            }
    except Exception:
        traceback.print_exc()
        classification = {
            "category": "Unknown",
            "subcategory": "Unknown",
            "priority": "Medium",
            "auto_resolve": False,
            "assigned_team": "General Support",
            "confidence": 0.0,
        }

    timeline["ai_analyzed"] = get_now_ist()
    timeline["triaged"] = get_now_ist()

    # --- NER ---
    try:
        entities = ner_service.extract_entities(text)
    except Exception:
        entities = []

    timeline["metadata_harvested"] = get_now_ist()

    # --- Duplicate detection ---
    try:
        dup_result = duplicate_service.check_duplicate(text, threshold=duplicate_sensitivity)
    except Exception:
        dup_result = {"is_duplicate": False, "duplicate_ticket_id": None, "similarity": 0.0}

    # --- RAG Knowledge Base Check ---
    rag_match = None
    try:
        rag_match = rag_service.search_knowledge_base(text, threshold=0.85)
        if rag_match:
            classification["auto_resolve"] = True
            classification["assigned_team"] = "Auto-Resolve AI"
            classification["confidence"] = max(
                classification["confidence"], float(rag_match["similarity"])
            )
            print(f"[RAG SUCCESS] Found solution for: '{rag_match['title']}'")
    except Exception as e:
        print(f"[RAG ERROR] {e}")

    # --- Reasoning ---
    decision_factors = []
    if classification["confidence"] > confidence_threshold:
        decision_factors.append(f"High confidence match for '{classification['subcategory']}'")
    if entities:
        decision_factors.append(
            f"Detected entities: {', '.join([e['text'] for e in entities[:2]])}"
        )
    if dup_result["is_duplicate"]:
        decision_factors.append(f"Found similar incident ({int(dup_result['similarity']*100)}%)")
    if rag_match:
        decision_factors.append(f"Found solution article: '{rag_match['title']}'")

    reasoning = f"Categorized as '{classification['category']}' - {classification['subcategory']}."
    if (
        enable_auto_resolve
        and classification["confidence"] >= confidence_threshold
        and classification["auto_resolve"]
    ):
        classification["auto_resolve"] = True
    else:
        classification["auto_resolve"] = False

    if classification["auto_resolve"]:
        reasoning += " Flagged for AI auto-resolution via Knowledge Base." if rag_match else " Flagged for auto-resolution."

    timeline["routed"] = get_now_ist()

    # --- Gemini Summary ---
    if gemini_service and gemini_service._initialized:
        summary = gemini_service.get_summary(text)

    hours_map = {"Critical": 2, "High": 8, "Medium": 24, "Low": 72}
    sla_hours = hours_map.get(classification["priority"], 72)
    sla_breach_dt = datetime.datetime.utcnow() + datetime.timedelta(hours=sla_hours)

    env_metadata["vision_requested"] = vision_requested

    return TicketResponse(
        ticket_id=str(uuid.uuid4()),  # Temporary ID
        summary=summary,
        category=classification["category"],
        subcategory=classification["subcategory"],
        priority=classification["priority"],
        auto_resolve=classification["auto_resolve"],
        assigned_team=classification["assigned_team"],
        entities=[EntityInfo(**e) for e in entities],
        duplicate_ticket=DuplicateInfo(**dup_result),
        confidence=classification["confidence"],
        needs_review=classification["confidence"] < confidence_threshold,
        reasoning=reasoning,
        decision_factors=decision_factors,
        image_description=gemini_analysis["image_description"],
        ocr_text=gemini_analysis["ocr_text"],
        image_url=request_body.image_url,
        highlights=entities,  # Use entities as highlights for now
        timeline=timeline,
        env_metadata=env_metadata,
        sla_breach_at=sla_breach_dt.isoformat() + "Z",
    )


@app.post("/ai/analyze_stream")
async def analyze_stream(request_body: TicketRequest):
    """REAL-TIME SSE ENDPOINT: Streams the AI progress to the frontend dynamically."""

    def get_now_ist():
        return datetime.datetime.utcnow().isoformat() + "Z"

    async def event_generator():
        text = request_body.text
        env_metadata = {
            "timestamp": get_now_ist(),
            "model_version": "3.0.0-PRO",
            "api_endpoint": "/ai/analyze_stream",
        }
        timeline = {"received": get_now_ist()}
        settings = get_system_settings(request_body.company)
        confidence_threshold = settings["ai_confidence_threshold"]
        duplicate_sensitivity = settings["duplicate_sensitivity"]
        enable_auto_resolve = settings["enable_auto_resolve"]

        yield f"data: {json.dumps({'step': 'Reading your message', 'status': 'in_progress'})}\n\n"
        await asyncio.sleep(0.5)

        gemini_analysis = {"ocr_text": request_body.image_text or "", "image_description": ""}
        if request_body.image_base64 and not gemini_analysis["ocr_text"]:
            try:
                # GeminiService.analyze_image expects only (image_base64)
                vision_result = gemini_service.analyze_image(request_body.image_base64)
                if isinstance(vision_result, dict):
                    gemini_analysis.update(vision_result)
            except Exception:
                pass

        summary = text[:100] + ("…" if len(text) > 100 else "")

        yield f"data: {json.dumps({'step': 'Extracting technical entities', 'status': 'in_progress'})}\n\n"
        await asyncio.sleep(0.2)
        try:
            entities = ner_service.extract_entities(text)
        except Exception:
            entities = []
        timeline["metadata_harvested"] = get_now_ist()

        yield f"data: {json.dumps({'step': 'Detecting category and priority', 'status': 'in_progress'})}\n\n"
        await asyncio.sleep(0.2)
        try:
            classification_v3_res = classifier_v3.predict(text)
            if "error" in classification_v3_res:
                classification = classifier_service.predict(text)
            else:
                cat = classification_v3_res.get("Category", {}).get("prediction", "Unknown")
                sub = classification_v3_res.get("Subcategory", {}).get("prediction", "Unknown")
                pri = classification_v3_res.get("priority", {}).get("prediction", "Medium")
                conf = classification_v3_res.get("Category", {}).get("confidence", 0.0)

                from backend.services.classifier_service import TEAM_MAP, AUTO_RESOLVE_SUBS

                assigned_team = TEAM_MAP.get(cat, "General Support")
                auto_resolve = sub in AUTO_RESOLVE_SUBS

                classification = {
                    "category": cat,
                    "subcategory": sub,
                    "priority": pri,
                    "auto_resolve": auto_resolve,
                    "assigned_team": assigned_team,
                    "confidence": float(conf),
                }
        except Exception:
            classification = {
                "category": "Unknown",
                "subcategory": "Unknown",
                "priority": "Medium",
                "auto_resolve": False,
                "assigned_team": "General Support",
                "confidence": 0.0,
            }
        timeline["ai_analyzed"] = get_now_ist()
        timeline["triaged"] = get_now_ist()

        yield f"data: {json.dumps({'step': 'Checking duplicate issues', 'status': 'in_progress'})}\n\n"
        await asyncio.sleep(0.2)
        try:
            dup_result = duplicate_service.check_duplicate(text, threshold=duplicate_sensitivity)
        except Exception:
            dup_result = {"is_duplicate": False, "duplicate_ticket_id": None, "similarity": 0.0}

        yield f"data: {json.dumps({'step': 'Finding possible solutions', 'status': 'in_progress'})}\n\n"
        await asyncio.sleep(0.2)
        rag_match = None
        try:
            rag_match = rag_service.search_knowledge_base(text, threshold=0.85)
            if rag_match:
                classification["auto_resolve"] = True
                classification["assigned_team"] = "Auto-Resolve AI"
                classification["confidence"] = max(
                    classification["confidence"], float(rag_match["similarity"])
                )
        except Exception:
            pass

        decision_factors = []
        if classification["confidence"] > confidence_threshold:
            decision_factors.append(f"High confidence match for '{classification['subcategory']}'")
        if entities:
            decision_factors.append(
                f"Detected entities: {', '.join([e['text'] for e in entities[:2]])}"
            )
        if dup_result["is_duplicate"]:
            decision_factors.append(f"Found similar incident ({int(dup_result['similarity']*100)}%)")
        if rag_match:
            decision_factors.append(f"Found solution article: '{rag_match['title']}'")

        if not enable_auto_resolve:
            classification["auto_resolve"] = False

        reasoning = f"Categorized as '{classification['category']}' - {classification['subcategory']}."
        if classification["auto_resolve"]:
            reasoning += (
                " Flagged for AI auto-resolution via Knowledge Base."
                if rag_match
                else " Flagged for auto-resolution."
            )

        timeline["routed"] = get_now_ist()

        if gemini_service and gemini_service._initialized:
            summary = gemini_service.get_summary(text)

        hours_map = {"Critical": 2, "High": 8, "Medium": 24, "Low": 72}
        sla_hours = hours_map.get(classification["priority"], 72)
        sla_breach_dt = datetime.datetime.utcnow() + datetime.timedelta(hours=sla_hours)

        ticket_response_dict = {
            "ticket_id": str(uuid.uuid4()),
            "summary": summary,
            "category": classification["category"],
            "subcategory": classification["subcategory"],
            "priority": classification["priority"],
            "auto_resolve": classification["auto_resolve"],
            "assigned_team": classification["assigned_team"],
            "entities": [e for e in entities],
            "duplicate_ticket": dup_result,
            "confidence": classification["confidence"],
            "needs_review": classification["confidence"] < confidence_threshold,
            "reasoning": reasoning,
            "decision_factors": decision_factors,
            "image_description": gemini_analysis["image_description"],
            "ocr_text": gemini_analysis["ocr_text"],
            "image_url": request_body.image_url,
            "highlights": entities,
            "timeline": timeline,
            "env_metadata": env_metadata,
            "sla_breach_at": sla_breach_dt.isoformat() + "Z",
        }

        yield f"data: {json.dumps({'step': 'done', 'result': jsonable_encoder(ticket_response_dict)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/ai/analyze_ticket/legacy")
async def legacy_analyze_and_save(request_body: TicketRequest):
    """BACKWARD COMPATIBILITY: analysis-only; does NOT persist to DB."""
    return await analyze_only(request_body)


@app.post("/ai/analyze-v2")
async def analyze_ticket_v2(request: TicketRequest):
    text = request.text
    try:
        prediction = classifier_v2.predict(text)
        return {
            "status": "success",
            "category": prediction["category"]["prediction"],
            "subcategory": prediction["sub_category"]["prediction"],
            "priority": prediction["priority"]["prediction"],
            "auto_resolve": prediction["auto_resolve"]["prediction"].lower() == "true",
            "assigned_team": prediction["assigned_team"]["prediction"],
            "confidence": prediction["category"]["confidence"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Clean cookie-based Supabase Auth endpoints for /auth/me backward-compatibility
# ---------------------------------------------------------------------------
ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
ACCESS_MAX_AGE = 60 * 60
REFRESH_MAX_AGE = 60 * 60 * 24 * 7


def _cookie_kwargs() -> dict:
    secure = os.getenv("ENV", "production").lower() != "development"
    return {"httponly": True, "secure": secure, "samesite": "strict", "path": "/"}


def extract_token(request: Request) -> str | None:
    cookie_token = request.cookies.get(ACCESS_COOKIE)
    if cookie_token:
        return cookie_token
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth.split(" ", 1)[1].strip() or None
    return None


def _set_session_cookies(response: Response, session) -> None:
    if not session or not getattr(session, "access_token", None):
        return
    response.set_cookie(ACCESS_COOKIE, session.access_token, max_age=ACCESS_MAX_AGE, **_cookie_kwargs())
    refresh = getattr(session, "refresh_token", None)
    if refresh:
        response.set_cookie(REFRESH_COOKIE, refresh, max_age=REFRESH_MAX_AGE, **_cookie_kwargs())


def _clear_session_cookies(response: Response) -> None:
    kwargs = _cookie_kwargs()
    response.delete_cookie(ACCESS_COOKIE, path=kwargs["path"])
    response.delete_cookie(REFRESH_COOKIE, path=kwargs["path"])


async def get_current_user(request: Request) -> dict:
    token = extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not supabase:
        raise HTTPException(status_code=503, detail="Database connection offline")
    try:
        result = supabase.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Invalid session: {exc}") from exc

    user = getattr(result, "user", None) or (result.get("user") if isinstance(result, dict) else None)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid session")
    if hasattr(user, "model_dump"):
        return user.model_dump()
    if hasattr(user, "dict"):
        return user.dict()
    return dict(user)


class LoginBody(BaseModel):
    email: str
    password: str


class SignupBody(BaseModel):
    email: str
    password: str
    full_name: str | None = None
    role: str | None = "user"
    company: str | None = None


@app.post("/auth/login")
async def auth_login(body: LoginBody, response: Response):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database connection offline")
    try:
        result = supabase.auth.sign_in_with_password({"email": body.email, "password": body.password})
    except Exception as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    session = getattr(result, "session", None)
    user = getattr(result, "user", None)
    if not session or not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    _set_session_cookies(response, session)
    user_payload = user.model_dump() if hasattr(user, "model_dump") else dict(user)
    return {"user": user_payload, "message": "Session cookies set"}


@app.post("/auth/signup")
async def auth_signup(body: SignupBody, response: Response):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database connection offline")

    metadata = {}
    if body.full_name:
        metadata["full_name"] = body.full_name
    if body.role:
        metadata["role"] = body.role
    if body.company:
        metadata["company"] = body.company

    try:
        result = supabase.auth.sign_up(
            {
                "email": body.email,
                "password": body.password,
                "options": {"data": metadata} if metadata else {},
            }
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    session = getattr(result, "session", None)
    user = getattr(result, "user", None)
    if session:
        _set_session_cookies(response, session)

    user_payload = user.model_dump() if user and hasattr(user, "model_dump") else None
    return {"user": user_payload, "message": "Signup complete"}


@app.post("/auth/logout")
async def auth_logout(response: Response):
    _clear_session_cookies(response)
    return {"ok": True}


@app.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return {"user": user}



@app.post("/internal/sla/sweep")
async def internal_sla_sweep(
    company_id: Optional[str] = None,
    send_alerts: bool = True
):
    """
    On-demand management endpoint for triggering the SLA breach escalation sweep.
    Allows manual triggers, health-checks, or external cron orchestrators.
    """
    from backend.services.sla_escalation_service import SLAEscalationService
    svc = SLAEscalationService()
    try:
        stats = await asyncio.to_thread(svc.run_sweep, supabase, company_id=company_id, send_alerts=send_alerts)
        return {
            "success": True,
            "stats": stats,
            "message": f"SLA escalation sweep complete. {stats.get('escalated', 0)} tickets escalated."
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SLA escalation sweep failed: {exc}")
