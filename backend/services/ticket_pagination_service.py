"""Tenant-scoped pagination and caching for the tickets list (Issue #4185).

GET /tickets used to return every row in the tickets table and cache the
result under one shared key, so any logged-in user could read every
company's tickets. This service fixes that:

- the tenant (company_id) is derived from the authenticated user's
  profile, never trusted from the request, unless the user is a
  master_admin;
- results are paginated with limit (default 25, max 100) and offset;
- cache keys are scoped per tenant and per page, in the shape
  helpdesk:tickets:{company_id}:{cursor_or_page};
- a tenant's cached pages are invalidated when its tickets change.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException

from backend.services.redis_cache import redis_cache

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 25
MAX_LIMIT = 100
CACHE_TTL_SECONDS = 300
ALL_TENANTS = "all"


def normalize_pagination(limit: int, offset: int) -> tuple[int, int]:
    """Clamp pagination parameters into the allowed range."""
    limit = max(1, min(limit, MAX_LIMIT))
    offset = max(0, offset)
    return limit, offset


def build_cache_key(company_id: str | None, limit: int, offset: int) -> str:
    """Cache key for one tenant's page, e.g. helpdesk:tickets:abc:limit25_offset0."""
    tenant = company_id or ALL_TENANTS
    return f"helpdesk:tickets:{tenant}:limit{limit}_offset{offset}"


def resolve_company_id(
    supabase,
    user_id: str | None,
    user_role: str,
    requested_company_id: str | None,
) -> str | None:
    """Return the company_id the caller is allowed to read.

    master_admin may read one tenant (requested_company_id) or all
    tenants (None). Everyone else is pinned to the company on their
    own profile, mirroring the tenant resolution in save_ticket:
    a mismatched request is a 403, a profile with no company is a 400.
    """
    if user_role == "master_admin":
        return requested_company_id

    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    profile_res = (
        supabase.table("profiles")
        .select("company_id")
        .eq("id", user_id)
        .single()
        .execute()
    )
    profile = profile_res.data or {}
    profile_company_id = profile.get("company_id")

    if requested_company_id and profile_company_id != requested_company_id:
        raise HTTPException(
            status_code=403, detail="User not authorized for this tenant"
        )
    if not profile_company_id:
        raise HTTPException(status_code=400, detail="User has no tenant assignment")
    return profile_company_id


def list_tickets_page(
    supabase,
    company_id: str | None,
    limit: int,
    offset: int,
) -> list:
    """Return one page of tickets for a tenant, using the per-tenant cache."""
    limit, offset = normalize_pagination(limit, offset)
    cache_key = build_cache_key(company_id, limit, offset)

    if redis_cache.available:
        cached = redis_cache.get_json(cache_key)
        if cached is not None:
            return cached

    query = supabase.table("tickets").select("*").order("created_at", desc=True)
    if company_id:
        query = query.eq("company_id", company_id)
    res = query.range(offset, offset + limit - 1).execute()
    data = res.data or []

    if redis_cache.available:
        redis_cache.set_json(cache_key, data, ttl=CACHE_TTL_SECONDS)
    return data


def invalidate_tenant_ticket_cache(company_id: str | None) -> None:
    """Drop every cached list page for one tenant after its tickets change."""
    if not company_id:
        return
    deleted = redis_cache.delete_by_pattern(f"helpdesk:tickets:{company_id}:*")
    if deleted:
        logger.info(
            "Invalidated %s cached ticket pages for company %s", deleted, company_id
        )
