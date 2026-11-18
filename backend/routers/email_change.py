"""
Verified Email Change Router (Company Admins & Users)

Allows any authenticated user or company admin (including RITESH PVT LTD admins)
to change their Gmail / email address securely via:
  1. POST /api/account/email-change/request — sends branded verification email with
     both a 6-digit OTP code and a one-click verification link.
  2. POST /api/account/email-change/verify  — verifies OTP or token, updates both
     Supabase auth.users and public.profiles atomically.
  3. GET  /api/account/email-change/status  — returns active pending request.
  4. DELETE /api/account/email-change/cancel — cancels active pending request.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from backend.database import supabase
from backend.auth_cookie import get_current_user
from backend.services.email_service import EmailChangeEmailContext, EmailService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/account/email-change", tags=["Account Email Change"])

EMAIL_REGEX = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
TOKEN_TTL_MINUTES = int(os.getenv("EMAIL_CHANGE_TTL_MINUTES", "30"))
MAX_OTP_ATTEMPTS = 5


class EmailChangeRequestBody(BaseModel):
    new_email: str = Field(..., min_length=5, max_length=254)
    frontend_origin: Optional[str] = Field(default=None, max_length=256)


class EmailChangeVerifyBody(BaseModel):
    token: Optional[str] = Field(default=None, min_length=16, max_length=256)
    otp_code: Optional[str] = Field(default=None, min_length=6, max_length=6)


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalize_email(email: str) -> str:
    cleaned = (email or "").strip().lower()
    if not EMAIL_REGEX.match(cleaned):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please provide a valid email address.",
        )
    return cleaned


def _build_verification_url(raw_token: str, frontend_origin: Optional[str] = None) -> str:
    base = (
        (frontend_origin or "").strip()
        or os.getenv("FRONTEND_URL", "").strip()
        or os.getenv("APP_BASE_URL", "").strip()
    ).rstrip("/")
    if not base:
        return ""
    return f"{base}/verify-email-change?token={raw_token}"


def _require_supabase():
    if not supabase:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database connection offline",
        )
    return supabase


def _sync_verified_email(sb, user_id: str, new_email: str) -> None:
    """Update both Supabase Auth user email and public.profiles email."""
    try:
        sb.auth.admin.update_user_by_id(
            user_id,
            {"email": new_email, "email_confirm": True},
        )
    except Exception as exc:
        logger.error("Supabase auth.admin.update_user_by_id failed for %s: %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to update authentication email: {exc}",
        ) from exc

    sb.table("profiles").update(
        {
            "email": new_email,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", user_id).execute()


@router.get("/status")
async def get_email_change_status(current_user: dict = Depends(get_current_user)):
    """Return any active pending email change request for the authenticated user."""
    sb = _require_supabase()
    user_id = current_user.get("id")
    now_iso = datetime.now(timezone.utc).isoformat()

    res = (
        sb.table("email_change_requests")
        .select("id, old_email, new_email, status, expires_at, created_at")
        .eq("user_id", user_id)
        .eq("status", "pending")
        .gt("expires_at", now_iso)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    pending = res.data[0] if res.data else None
    return {"pending": pending}


@router.post("/request")
async def request_email_change(
    body: EmailChangeRequestBody,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Initiate a verified email change by emailing a 6-digit OTP + secure link to the new address."""
    sb = _require_supabase()
    user_id = current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unable to resolve user identity")

    new_email = _normalize_email(body.new_email)

    # Load user's profile for current email, role, name, and company
    profile_res = (
        sb.table("profiles")
        .select("id, email, full_name, role, company, company_id")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    profile = profile_res.data[0] if profile_res.data else {}
    old_email = (profile.get("email") or current_user.get("email") or "").strip().lower()

    if new_email == old_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New email address must be different from your current email address.",
        )

    # Ensure no other profile already owns this email
    existing_res = (
        sb.table("profiles")
        .select("id")
        .ilike("email", new_email)
        .limit(1)
        .execute()
    )
    if existing_res.data and existing_res.data[0].get("id") != user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That email address is already registered to another account.",
        )

    # Cancel any earlier pending requests for this user
    sb.table("email_change_requests").update(
        {"status": "cancelled", "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("user_id", user_id).eq("status", "pending").execute()

    raw_token = secrets.token_urlsafe(32)
    otp_code = f"{secrets.randbelow(1_000_000):06d}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_TTL_MINUTES)

    record = {
        "user_id": user_id,
        "company_id": profile.get("company_id"),
        "old_email": old_email,
        "new_email": new_email,
        "token_hash": _sha256_hex(raw_token),
        "otp_code_hash": _sha256_hex(f"{user_id}:{new_email}:{otp_code}"),
        "status": "pending",
        "attempts": 0,
        "expires_at": expires_at.isoformat(),
    }
    sb.table("email_change_requests").insert(record).execute()

    origin = body.frontend_origin or request.headers.get("origin")
    verification_url = _build_verification_url(raw_token, origin)

    role_label = {
        "master_admin": "Master Admin",
        "super_admin": "Super Admin",
        "admin": "Company Admin",
        "agent": "Support Agent",
    }.get((profile.get("role") or "user").lower(), "User")

    email_service = EmailService()
    delivery = email_service.send_email_change_verification(
        EmailChangeEmailContext(
            recipient_email=new_email,
            old_email=old_email,
            otp_code=otp_code,
            verification_url=verification_url,
            recipient_name=profile.get("full_name") or "",
            company_name=profile.get("company") or "RITESH PVT LTD",
            account_role=role_label,
            expires_minutes=TOKEN_TTL_MINUTES,
        )
    )

    return {
        "status": "verification_sent" if delivery.sent else "pending_verification",
        "old_email": old_email,
        "new_email": new_email,
        "expires_at": expires_at.isoformat(),
        "email_sent": delivery.sent,
        "provider": delivery.provider,
        "delivery_note": (
            "Verification email dispatched with 6-digit code and confirmation link."
            if delivery.sent
            else f"Request saved; configure EMAIL_PROVIDER (smtp/sendgrid/resend) to deliver mail ({delivery.reason})."
        ),
    }


@router.post("/verify")
async def verify_email_change(
    body: EmailChangeVerifyBody,
    request: Request,
):
    """Complete an email change using either a one-click URL token or an authenticated 6-digit OTP."""
    sb = _require_supabase()
    now = datetime.now(timezone.utc)

    if body.token:
        token_hash = _sha256_hex(body.token.strip())
        res = (
            sb.table("email_change_requests")
            .select("*")
            .eq("token_hash", token_hash)
            .eq("status", "pending")
            .limit(1)
            .execute()
        )
        if not res.data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or already used verification link.",
            )
        req_row = res.data[0]
        expires_at = datetime.fromisoformat(req_row["expires_at"].replace("Z", "+00:00"))
        if expires_at < now:
            sb.table("email_change_requests").update({"status": "expired"}).eq("id", req_row["id"]).execute()
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="Verification link has expired. Please request a new one.",
            )

        _sync_verified_email(sb, req_row["user_id"], req_row["new_email"])
        sb.table("email_change_requests").update(
            {
                "status": "verified",
                "verified_at": now.isoformat(),
                "updated_at": now.isoformat(),
            }
        ).eq("id", req_row["id"]).execute()

        return {
            "verified": True,
            "old_email": req_row["old_email"],
            "new_email": req_row["new_email"],
            "message": "Email address verified and updated successfully.",
        }

    if not body.otp_code or not body.otp_code.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide either a valid verification token or a 6-digit verification code.",
        )

    current_user = await get_current_user(request)
    user_id = current_user.get("id")

    res = (
        sb.table("email_change_requests")
        .select("*")
        .eq("user_id", user_id)
        .eq("status", "pending")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pending email change request found.",
        )

    req_row = res.data[0]
    expires_at = datetime.fromisoformat(req_row["expires_at"].replace("Z", "+00:00"))
    if expires_at < now:
        sb.table("email_change_requests").update({"status": "expired"}).eq("id", req_row["id"]).execute()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Verification code has expired. Please request a new one.",
        )

    attempts = int(req_row.get("attempts") or 0)
    if attempts >= MAX_OTP_ATTEMPTS:
        sb.table("email_change_requests").update({"status": "expired"}).eq("id", req_row["id"]).execute()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed verification attempts. Please request a new code.",
        )

    expected_hash = _sha256_hex(f"{user_id}:{req_row['new_email']}:{body.otp_code.strip()}")
    if not secrets.compare_digest(expected_hash, req_row["otp_code_hash"]):
        sb.table("email_change_requests").update(
            {"attempts": attempts + 1, "updated_at": now.isoformat()}
        ).eq("id", req_row["id"]).execute()
        remaining = max(0, MAX_OTP_ATTEMPTS - attempts - 1)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Incorrect verification code. {remaining} attempt(s) remaining.",
        )

    _sync_verified_email(sb, user_id, req_row["new_email"])
    sb.table("email_change_requests").update(
        {
            "status": "verified",
            "verified_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }
    ).eq("id", req_row["id"]).execute()

    return {
        "verified": True,
        "old_email": req_row["old_email"],
        "new_email": req_row["new_email"],
        "message": "Email address verified and updated successfully.",
    }


@router.delete("/cancel")
async def cancel_email_change(current_user: dict = Depends(get_current_user)):
    """Cancel any active pending email change request for the authenticated user."""
    sb = _require_supabase()
    user_id = current_user.get("id")
    sb.table("email_change_requests").update(
        {"status": "cancelled", "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("user_id", user_id).eq("status", "pending").execute()
    return {"cancelled": True}
