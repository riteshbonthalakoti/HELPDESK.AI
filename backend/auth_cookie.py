"""HttpOnly cookie session bridge for Supabase JWTs (issue #130)."""

from __future__ import annotations

import hashlib
import logging
import os
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from backend.services.rate_limit_config import limiter


logger = logging.getLogger(__name__)

from backend.limiter import limiter

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
ACCESS_MAX_AGE = 60 * 60
REFRESH_MAX_AGE = 60 * 60 * 24 * 7

# Redis key prefix for revoked tokens (TTL-keyed denylist)
_REVOKED_PREFIX = "helpdesk:revoked:"

router = APIRouter(prefix="/auth", tags=["auth"])


def _cookie_kwargs() -> dict[str, Any]:
    secure = os.getenv("ENV", "production").lower() != "development"
    return {
        "httponly": True,
        "secure": secure,
        "samesite": "strict",
        "path": "/",
    }


def _anon_supabase():
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "service_unavailable", "message": "Auth backend not configured (SUPABASE_URL / SUPABASE_ANON_KEY missing)"},
        )
    return create_client(url, key)


def _service_supabase():
    """Return a service-role Supabase client for admin operations."""
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    return create_client(url, key)


def _get_redis():
    """Return the shared Redis client if available, else None."""
    try:
        import redis as _redis

        url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        client = _redis.from_url(url, decode_responses=True, socket_connect_timeout=1)
        client.ping()
        return client
    except Exception:
        return None


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _revoke_token(token: str, ttl: int = ACCESS_MAX_AGE) -> None:
    """Add token to Redis denylist so it is rejected even before natural expiry."""
    try:
        redis = _get_redis()
        if redis:
            redis.setex(f"{_REVOKED_PREFIX}{_token_hash(token)}", ttl, "1")
    except Exception as exc:
        logger.warning("[Auth] Redis denylist write failed: %s", exc)


def _is_token_revoked(token: str) -> bool:
    """Return True if the token appears in the Redis denylist."""
    try:
        redis = _get_redis()
        if redis:
            return bool(redis.exists(f"{_REVOKED_PREFIX}{_token_hash(token)}"))
    except Exception as exc:
        logger.warning("[Auth] Redis denylist read failed: %s", exc)
    return False


def extract_token(request: Request) -> str | None:
    """Prefer HttpOnly cookie; fall back to Authorization bearer header."""
    cookie_token = request.cookies.get(ACCESS_COOKIE)
    if cookie_token:
        return cookie_token
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth.split(" ", 1)[1].strip() or None
    return None


def _set_session_cookies(response: Response, session: Any) -> None:
    if not session or not getattr(session, "access_token", None):
        return
    response.set_cookie(
        ACCESS_COOKIE,
        session.access_token,
        max_age=ACCESS_MAX_AGE,
        **_cookie_kwargs(),
    )
    refresh = getattr(session, "refresh_token", None)
    if refresh:
        response.set_cookie(
            REFRESH_COOKIE,
            refresh,
            max_age=REFRESH_MAX_AGE,
            **_cookie_kwargs(),
        )


def _clear_session_cookies(response: Response) -> None:
    kwargs = _cookie_kwargs()
    response.delete_cookie(ACCESS_COOKIE, path=kwargs["path"])
    response.delete_cookie(REFRESH_COOKIE, path=kwargs["path"])


def get_user_role(user: dict | None) -> str:
    """Return the normalized role from Supabase user metadata or direct payload."""
    if not user:
        return "user"

    metadata = user.get("user_metadata") or {}
    app_metadata = user.get("app_metadata") or {}
    role = (
        app_metadata.get("role")
        or app_metadata.get("user_role")
        or metadata.get("role")
        or user.get("role")
        or "user"
    )
    return str(role).strip().lower().replace("-", "_") or "user"


ADMIN_ROLES = frozenset({"admin", "company_admin", "super_admin", "master_admin"})
AGENT_ROLES = frozenset(
    {"agent", "support_agent", "admin", "company_admin", "super_admin", "master_admin"}
)


async def get_current_user(request: Request) -> dict:
    token = extract_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "unauthorized", "message": "Not authenticated"})

    # Reject tokens that were explicitly revoked via logout
    if _is_token_revoked(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "unauthorized", "message": "Session has been revoked. Please log in again."},
        )

    try:
        client = _anon_supabase()
        result = client.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "unauthorized", "message": "Invalid session"},
        ) from exc
    user = getattr(result, "user", None) or (result.get("user") if isinstance(result, dict) else None)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "unauthorized", "message": "Invalid session"})
    if hasattr(user, "model_dump"):
        return user.model_dump()
    if hasattr(user, "dict"):
        return user.dict()
    return dict(user)


def require_roles(*allowed_roles: str):
    """Build a FastAPI dependency that rejects authenticated users without a role."""
    normalized_roles = {
        role.strip().lower().replace("-", "_") for role in allowed_roles
    }

    async def _dependency(user: dict = Depends(get_current_user)) -> dict:
        role = get_user_role(user)
        if role not in normalized_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": "forbidden", "message": "Insufficient role permissions"},
            )
        return user

    return _dependency


get_current_active_admin = require_roles(*ADMIN_ROLES)
get_current_active_agent = require_roles(*AGENT_ROLES)


def _validate_email_format(email: str) -> str:
    """Shared email format validator."""
    pattern = r"^[a-zA-Z0-9_.+%\-]+@[a-zA-Z0-9\-]+\.[a-zA-Z0-9\-.]+$"
    if not re.match(pattern, email):
        raise ValueError("Invalid email format")
    return email


class LoginBody(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v: str) -> str:
        return _validate_email_format(v)


class SignupBody(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=6)
    full_name: str | None = None
    role: str | None = "user"
    company: str | None = None

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v: str) -> str:
        return _validate_email_format(v)


@router.post("/login")
@limiter.limit("5/minute")
async def auth_login(request: Request, body: LoginBody, response: Response):
    """Log in a user using email and password, setting HttpOnly session cookies."""
    try:
        client = _anon_supabase()
        result = client.auth.sign_in_with_password(
            {"email": str(body.email), "password": body.password}
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "unauthorized", "message": "Invalid email or password"}) from exc

    session = getattr(result, "session", None)
    user = getattr(result, "user", None)
    if not session or not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "unauthorized", "message": "Invalid email or password"})

    _set_session_cookies(response, session)
    user_payload = user.model_dump() if hasattr(user, "model_dump") else dict(user)
    return {"user": user_payload, "message": "Session cookies set"}


@router.post("/signup")
@limiter.limit("5/minute")
async def auth_signup(request: Request, body: SignupBody, response: Response):
    """Sign up a new user, setting HttpOnly session cookies upon success."""
    metadata: dict[str, str] = {}
    if body.full_name:
        metadata["full_name"] = body.full_name
    if body.role:
        metadata["role"] = body.role
    if body.company:
        metadata["company"] = body.company

    try:
        client = _anon_supabase()
        result = client.auth.sign_up(
            {
                "email": str(body.email),
                "password": body.password,
                "options": {"data": metadata} if metadata else {},
            }
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "bad_request", "message": "Signup failed. Please try again."}) from exc

    session = getattr(result, "session", None)
    user = getattr(result, "user", None)
    if session:
        _set_session_cookies(response, session)
    user_payload = user.model_dump() if user and hasattr(user, "model_dump") else None
    return {"user": user_payload, "message": "Signup complete"}


@router.post("/logout")
@limiter.limit("10/minute")
async def auth_logout(request: Request, response: Response):
    """Log out the current user.

    Performs three layers of session invalidation:
    1. Adds the access token to a Redis denylist so it is rejected immediately on
       any subsequent request, even before its natural JWT expiry.
    2. Calls the Supabase admin API (service role) to sign the user out server-side,
       which invalidates the refresh token and prevents silent token renewal.
    3. Clears both the access_token and refresh_token HttpOnly cookies from the browser.
    """
    token = extract_token(request)
    if token:
        # Layer 1: denylist the raw access token in Redis for its remaining lifetime
        _revoke_token(token, ttl=ACCESS_MAX_AGE)

        # Layer 2: sign out via Supabase admin API to invalidate the refresh token
        try:
            admin = _service_supabase()
            if admin:
                user_result = admin.auth.get_user(token)
                user = getattr(user_result, "user", None)
                user_id = getattr(user, "id", None) if user else None
                if user_id:
                    admin.auth.admin.sign_out(user_id)
        except Exception as exc:
            # Non-fatal: cookies are cleared regardless; Redis denylist still protects
            logger.warning("[Auth] Admin sign-out failed: %s", exc)

    # Layer 3: clear cookies from the browser
    _clear_session_cookies(response)
    return {"ok": True}


@router.get("/me")
@limiter.limit("60/minute")
async def auth_me(request: Request, user: dict = Depends(get_current_user)):
    """Return the profile data of the currently authenticated user session."""
    return {"user": user}


@router.get("/me/role")
async def auth_me_role(user: dict = Depends(get_current_user)):
    """Return the authoritative role and status from the database profiles table.

    This endpoint is the single source of truth for authorization decisions.
    Client-side caches (localStorage, Zustand persist) must NOT be trusted for
    role-based access control — always call this endpoint instead.
    """
    from supabase import create_client as _create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        raise HTTPException(status_code=503, detail={"error": "service_unavailable", "message": "Auth backend not configured"})

    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail={"error": "unauthorized", "message": "Invalid user session"})

    try:
        client = _create_client(url, key)
        result = client.table("profiles").select("role, status").eq("id", user_id).single().execute()
        data = getattr(result, "data", None) or {}
    except Exception as exc:
        logger.error("Profile lookup failed for user_id=%s", user_id, exc_info=exc)
        raise HTTPException(status_code=500, detail={"error": "internal_error", "message": "Profile lookup failed."}) from exc

    return {
        "role": data.get("role", "user"),
        "status": data.get("status", "pending_email_verification"),
    }
