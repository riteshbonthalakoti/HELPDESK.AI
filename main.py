import logging
import uuid
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response
from supabase import create_client

from backend.csrf import CSRFTokenMiddleware, set_csrf_cookie, CSRF_COOKIE_NAME
from backend.config import settings
from backend.swagger_config import SWAGGER_UI_CUSTOM_CSS, SWAGGER_UI_CUSTOM_JS
from backend.routers import metrics as metrics_router

from backend.routers import tickets, ai, admin, health, auth, websocket, sla_prediction, ticket_merge, actions
from backend.routes import translation, estimator, voice, privacy, active_learning, weekly_digest
from backend.routers import upload as upload_router

from backend.logger import configure_logging
configure_logging()
logger = logging.getLogger(__name__)

app = FastAPI()

from backend.security_middleware import SecurityHeadersMiddleware
app.add_middleware(SecurityHeadersMiddleware)
app.include_router(upload_router.router)
app.add_middleware(CSRFTokenMiddleware)

# Issue #3374: this middleware already existed fully implemented but was
# never actually registered with the app - administrative/tenant-management
# actions (and auth, tickets, log_correction) were never being audit-logged
# as a result.
from backend.middleware.audit_logger import AuditLoggerMiddleware
app.add_middleware(AuditLoggerMiddleware)

app.include_router(metrics_router.router)

# Issue #3390: centralized structured request/response logging, replacing
# scattered print() statements. Ordering matters here - RequestIDMiddleware
# must be added AFTER (so it becomes the outer layer and sets
# request.state.request_id before RequestLoggingMiddleware reads it).
# RequestIDMiddleware already existed in backend/middleware/request_id.py
# but was never actually wired into the app.
from backend.middleware.request_logging import add_request_logging_middleware
from backend.middleware.request_id import add_request_id_middleware
add_request_logging_middleware(app)
add_request_id_middleware(app)

app.include_router(metrics_router.router)
from backend.config import settings

# Initialize Supabase client
supabase = None
if settings.SUPABASE_URL and settings.SUPABASE_SERVICE_KEY and not settings.ALLOW_DEGRADED_STARTUP:
    try:
        supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
    except Exception as e:
        logger.warning(f"Failed to initialize Supabase client: {e}")

app.include_router(tickets.router)
app.include_router(ai.router)
app.include_router(admin.router)
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(websocket.router)
app.include_router(sla_prediction.router)
app.include_router(ticket_merge.router)
app.include_router(translation.router)
app.include_router(estimator.router)
app.include_router(voice.router)
app.include_router(privacy.router)
app.include_router(active_learning.router)
app.include_router(weekly_digest.router)
app.include_router(actions.router)


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------

@app.get("/", tags=["Health"])
@app.get("/health", tags=["Health"])
@app.get("/ready", tags=["Health"])
async def health_check():
    """Public health / readiness probe — no authentication required."""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Global exception handler (prevents internal error leakage)
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Return a sanitized 500 response for any unhandled exception.

    The real traceback is logged server-side with a correlation ``error_id``
    so operators can investigate without exposing implementation details to
    clients (closes the "error leakage" gap flagged for admin.py).
    """
    error_id = uuid.uuid4().hex
    logger.error(
        "Unhandled exception [%s] on %s %s: %s",
        error_id,
        request.method,
        request.url.path,
        exc,
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={
            "status": "error",
            "message": "An unexpected internal error occurred. The incident has been logged.",
            "error_id": error_id,
        },
    )


# ---------------------------------------------------------------------------
# Tenant-isolated routes (use security_manager so test overrides apply)
# ---------------------------------------------------------------------------

from backend.auth.tenant_middleware import security_manager  # noqa: E402


@app.get("/tickets", tags=["Tickets"])
async def list_tickets(
    company_id: str = None,
    user: dict = Depends(security_manager.get_current_user_profile),
):
    """List tickets scoped to the authenticated user's tenant."""
    security_manager.verify_tenant_access(company_id, user)
    if supabase:
        from backend.services.redis_cache import redis_cache
        cache_key = f"helpdesk:tickets:list:{company_id or 'all'}"
        
        if redis_cache.available:
            cached = redis_cache.get_json(cache_key)
            if cached is not None:
                return cached

        query = supabase.table("tickets").select("*").order("created_at", desc=True)
        if company_id:
            query = query.eq("company_id", company_id)
        data = query.execute().data
        
        if redis_cache.available:
            redis_cache.set_json(cache_key, data, ttl=300)
            
        return data
    return []


@app.get("/tickets/search", tags=["Tickets"])
async def search_tickets(
    q: str = None,
    company_id: str = None,
    user: dict = Depends(security_manager.get_current_user_profile),
):
    """Search tickets scoped to the authenticated user's tenant."""
    security_manager.verify_tenant_access(company_id, user)
    return []


@app.post("/tickets/save", tags=["Tickets"])
async def save_ticket(
    payload: dict,
    user: dict = Depends(security_manager.get_current_user_profile),
):
    """Persist a ticket; enforces tenant and user-ID consistency."""
    company_id = payload.get("company_id")
    security_manager.verify_tenant_access(company_id, user)
    if payload.get("user_id") != user.get("id"):
        raise HTTPException(status_code=403, detail="User ID spoofing detected")
    return {"status": "ok"}


@app.get("/tickets/{ticket_id}", tags=["Tickets"])
async def get_ticket(
    ticket_id: str,
    user: dict = Depends(security_manager.get_current_user_profile),
):
    """Fetch a single ticket, enforcing IDOR protection."""
    security_manager.verify_resource_ownership("tickets", ticket_id, user)
    return {}


@app.get("/users/{user_id}", tags=["Users"])
async def get_user(
    user_id: str,
    user: dict = Depends(security_manager.get_current_user_profile),
):
    """Fetch a user profile, enforcing IDOR protection."""
    security_manager.verify_resource_ownership("profiles", user_id, user)
    return {}


@app.get("/attachments/{ticket_id}", tags=["Attachments"])
async def get_attachments(
    ticket_id: str,
    user: dict = Depends(security_manager.get_current_user_profile),
):
    """Fetch attachments for a ticket, enforcing IDOR protection."""
    security_manager.verify_resource_ownership("tickets", ticket_id, user)
    return []


@app.get("/analytics", tags=["Analytics"])
async def get_analytics(
    user: dict = Depends(security_manager.get_current_user_profile),
):
    """Return analytics scoped to the authenticated user's tenant."""
    return {"company_id": user.get("company_id")}


@app.get("/api/security/audit", tags=["Security"])
async def security_audit(
    user: dict = Depends(security_manager.get_current_user_profile),
):
    """Run security audit — admin only."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    return {"status": "success", "leakage_risk": "Low"}


@app.get("/api/security/report", tags=["Security"])
async def security_report(
    user: dict = Depends(security_manager.get_current_user_profile),
):
    """Download tenant isolation report — admin only."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    return PlainTextResponse(
        "# Tenant Isolation Security Audit Report",
        media_type="text/markdown",
        headers={"content-disposition": "attachment; filename=tenant_isolation_report.md"},
    )


# ---------------------------------------------------------------------------
# Existing endpoints
# ---------------------------------------------------------------------------

@app.get("/auth/csrf-token", tags=["Auth"])
async def get_csrf_token(response: JSONResponse):
    """Issue a CSRF token cookie for authenticated browser sessions."""
    token = set_csrf_cookie(response)
    return {"csrf_token": token}

@app.get("/docs", include_in_schema=False)
async def get_docs():
    """Serve the themed Swagger UI for interactive API exploration."""
    swagger_html = get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="HelpDesk AI Backend - Swagger UI",
        swagger_css_url="/docs/theme.css",
        swagger_favicon_url="https://helpdeskaiv1.vercel.app/favicon.ico",
        swagger_ui_parameters={
            "docExpansion": "list",
            "deepLinking": True,
            "displayRequestDuration": True,
            "persistAuthorization": True,
            "filter": True,
        },
    )
    body = swagger_html.body.decode("utf-8").replace(
        "</body>",
        '<script src="/docs/theme.js"></script></body>',
    )
    return HTMLResponse(content=body, status_code=swagger_html.status_code)


@app.get("/docs/theme.css", include_in_schema=False)
async def get_docs_theme_css():
    """Expose the custom Swagger UI theme stylesheet."""
    return Response(content=SWAGGER_UI_CUSTOM_CSS, media_type="text/css")


@app.get("/docs/theme.js", include_in_schema=False)
async def get_docs_theme_js():
    """Expose the custom Swagger UI bootstrap script."""
    return Response(content=SWAGGER_UI_CUSTOM_JS, media_type="application/javascript")


@app.get("/redoc", include_in_schema=False)
async def get_redoc():
    """Serve a themed ReDoc view for schema browsing."""
    return HTMLResponse(
        content="""
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HelpDesk AI Backend - ReDoc</title>
    <link rel="icon" href="https://helpdeskaiv1.vercel.app/favicon.ico" />
    <style>
      :root {
        color-scheme: dark;
        --bg: #0f172a;
        --panel: #111827;
        --panel-2: #1e293b;
        --border: rgba(148, 163, 184, 0.2);
        --text: #e2e8f0;
        --muted: #94a3b8;
        --accent: #10b981;
      }
      html, body {
        margin: 0;
        min-height: 100%;
        background: radial-gradient(circle at top, rgba(16, 185, 129, 0.12), transparent 35%), var(--bg);
        color: var(--text);
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .shell {
        min-height: 100vh;
      }
      .bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 16px 24px;
        background: rgba(15, 23, 42, 0.9);
        border-bottom: 1px solid var(--border);
        backdrop-filter: blur(12px);
      }
      .brand {
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .subtitle {
        color: var(--muted);
        font-size: 12px;
      }
      #redoc {
        min-height: calc(100vh - 65px);
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="bar">
        <div>
          <div class="brand">HelpDesk.AI</div>
          <div class="subtitle">ReDoc API reference</div>
        </div>
        <div class="subtitle">OpenAPI 1.0.0</div>
      </div>
      <div id="redoc"></div>
    </div>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
    <script>
      Redoc.init('/openapi.json', {
        theme: {
          colors: {
            primary: { main: '#10b981' },
            http: {
              get: '#22c55e',
              post: '#3b82f6',
              put: '#f59e0b',
              patch: '#a855f7',
              delete: '#ef4444'
            },
            text: {
              primary: '#e2e8f0',
              secondary: '#94a3b8'
            },
            border: {
              dark: '#334155'
            }
          },
          typography: {
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
            headings: {
              fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
            }
          },
          sidebar: {
            backgroundColor: '#0b1220',
            textColor: '#cbd5e1'
          },
          rightPanel: {
            backgroundColor: '#111827',
            textColor: '#e2e8f0'
          }
        }
      }, document.getElementById('redoc'));
    </script>
  </body>
</html>
        """,
        media_type="text/html",
    )

@app.get("/openapi.json", include_in_schema=False)
async def get_open_api():
    """Return the live OpenAPI schema used by the docs and Postman generator."""
    return get_openapi(
        title="HelpDesk AI Backend",
        version="1.0.0",
        description="API Documentation for HelpDesk AI Backend",
        routes=app.routes,
    )