import logging
import hashlib
import traceback
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from backend.auth_cookie import get_current_user, get_user_role
from backend.dependencies import supabase, duplicate_service
from backend.schemas import TicketSaveRequest
from backend.sanitization import sanitize_ticket_data

# NOTE (Issue #3212 -> #3380): `TicketRecord` / `TICKETS_DB` previously
# imported from `backend.models` did not exist anywhere in this codebase.
# Issue #3212 temporarily stubbed them locally just to restore importability.
# Issue #3380 replaces that stub entirely: the legacy in-memory endpoints
# below (POST /tickets, PATCH /tickets/{id}) now persist to Supabase via the
# same tested helpers used elsewhere in the app, instead of mutating a
# process-local list that is not thread-safe and is wiped on every restart.
from backend.services.supabase_utils import (
    create_ticket as _supabase_create_ticket,
    update_ticket as _supabase_update_ticket,
)
from backend.services.ticket_pagination_service import (
    invalidate_tenant_ticket_cache,
    list_tickets_page,
    resolve_company_id,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tickets", tags=["tickets"])


def _rollback_ticket_insert(ticket_id, log) -> bool:
    """
    Compensating rollback (Issue #3212): supabase-py has no native multi-table
    transaction support, so a failure in a step AFTER the initial `tickets`
    row insert (categorization/duplicate indexing, or the initial system
    message) must be compensated for manually, or the ticket row is left as
    an orphaned, inconsistent record with no messages/indexing.
    """
    try:
        supabase.table("tickets").delete().eq("id", ticket_id).execute()
        log.warning(f"Rolled back ticket insert for ticket_id={ticket_id} after downstream failure.")
        return True
    except Exception as rollback_error:
        log.error(f"CRITICAL: Failed to roll back orphaned ticket_id={ticket_id}: {rollback_error}")
        return False


@router.get("")
async def get_tickets(
    company_id: str | None = None,
    limit: int = 25,
    offset: int = 0,
    user: dict = Depends(get_current_user),
):
    """Fetch persistent tickets from Supabase (Issue #4185).

    The tenant is derived from the authenticated user's profile, results
    are paginated, and cache keys are scoped per tenant and per page.
    See backend.services.ticket_pagination_service.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database connection not initialized")

    effective_company_id = resolve_company_id(
        supabase, user.get("id"), get_user_role(user), company_id
    )
    return list_tickets_page(supabase, effective_company_id, limit, offset)


@router.post("/save")
async def save_ticket(request_body: TicketSaveRequest, user: dict = Depends(get_current_user)):
    """
    OFFICIAL PERSISTENCE: Saves the analyzed ticket to Supabase.
    This is called AFTER the user confirms the analysis results.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase connection not initialized.")

    logger = logging.getLogger(__name__)
    try:
        final_data = sanitize_ticket_data(request_body.dict())

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
            # User provided company_id: verify it matches their profile.
            if profile_company_id and final_data["company_id"] != profile_company_id:
                user_hash = hashlib.sha256(str(request_body.user_id).encode()).hexdigest()[:8]
                logger.warning(f"Tenant mismatch: user {user_hash} attempted {final_data['company_id']}, assigned to {profile_company_id}")
                raise HTTPException(status_code=403, detail="User not authorized for this tenant")
        elif profile_company_id:
            # Backfill company_id from profile.
            final_data["company_id"] = profile_company_id
        elif request_body.user_id:
            # User has no tenant assignment.
            raise HTTPException(status_code=400, detail="User has no tenant assignment")

        # Backfill company name if missing.
        if not final_data.get("company") and profile.get("company"):
            final_data["company"] = profile["company"]

        user_hash = hashlib.sha256(str(request_body.user_id).encode()).hexdigest()[:8]
        logger.info(f"Tenant linkage: user_hash={user_hash}, company_id={final_data.get('company_id')}")


        # ── Jaccard keyword duplicate gate (Issue #3228) ────────────────
        # Fast pre-filter: check for near-duplicate submissions using
        # keyword-based Jaccard similarity within a 24-hour window.
        try:
            from backend.services.jaccard_duplicate_filter import jaccard_filter
            dup_text = (
                (request_body.description or "").strip()
                + " "
                + (request_body.subject or "").strip()
            ).strip()
            if dup_text:
                dup_check = jaccard_filter.check_duplicate(dup_text)
                if dup_check.get("is_duplicate"):
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "message": "Duplicate ticket detected",
                            "duplicate_ticket_id": dup_check["duplicate_ticket_id"],
                            "similarity": dup_check["similarity"],
                        },
                    )
        except HTTPException:
            raise
        except Exception as jf_err:
            logger.warning(f"Jaccard filter check skipped: {jf_err}")
        # ── End Jaccard gate ──────────────────────────────────────────

        res = supabase.table("tickets").insert(final_data).execute()

        if not res.data:
            raise Exception("Failed to insert ticket into database.")

        ticket_id = res.data[0]["id"]

        # Everything below this point has already written the `tickets` row.
        # Issue #3212: if any of these subsequent steps fail, that row must
        # be rolled back (deleted) rather than left as an orphaned record
        # with no categorization index and no initial message.
        try:
            duplicate_indexed = True
            duplicate_index_warning = None
            description_text = (request_body.description or "").strip()
            subject_text = (request_body.subject or "").strip()
            duplicate_text = description_text or subject_text
            if duplicate_text:
                duplicate_service.add_ticket(str(ticket_id), duplicate_text)
                try:
                    from backend.services.jaccard_duplicate_filter import jaccard_filter
                    jaccard_filter.add_ticket(str(ticket_id), duplicate_text)
                except Exception as jf_add_err:
                    # Auxiliary/secondary duplicate signal - soft-fail on its own,
                    # unlike the primary duplicate_service call above.
                    logger.warning(f"Failed to add ticket to Jaccard filter: {jf_add_err}")
            else:
                duplicate_indexed = False
                duplicate_index_warning = "Duplicate index update skipped: no description or subject text was provided."
                print(f"[WARNING] {duplicate_index_warning}")

            # Add initial system diagnostic message
            msg = "Our Neural Engine has successfully triaged your issue and routed it to the designated team."
            if final_data["auto_resolve"]:
                msg = "AI Auto-Resolution active: A verified solution has been identified. Please review the attached resolution steps."

            supabase.table("ticket_messages").insert({
                "ticket_id": ticket_id,
                "sender_id": "00000000-0000-0000-0000-000000000000", # System ID
                "sender_name": "AI Assistant",
                "sender_role": "admin",
                "message": msg
            }).execute()

        except Exception as post_insert_error:
            logger.error(f"Post-insert step failed for ticket_id={ticket_id}: {post_insert_error}")
            _rollback_ticket_insert(ticket_id, logger)
            raise HTTPException(
                status_code=500,
                detail="Failed to fully create ticket; the operation was rolled back. Please try again."
            ) from post_insert_error

        response = {"status": "success", "ticket_id": ticket_id, "duplicate_indexed": duplicate_indexed}
        if duplicate_index_warning:
            response["duplicate_index_warning"] = duplicate_index_warning
        invalidate_tenant_ticket_cache(final_data.get("company_id"))
        return response

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        logger.error("Failed to create ticket", exc_info=e)
        raise HTTPException(status_code=500, detail="Failed to create ticket. Please try again later.")

@router.get("/{ticket_id}")
async def get_ticket_by_id(ticket_id: str, user: dict = Depends(get_current_user)):
    """Fetch single persistent ticket."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database connection not initialized")

    res = supabase.table("tickets").select("*").eq("id", ticket_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return res.data


@router.post("")
async def create_ticket(ticket: dict, user: dict = Depends(get_current_user)):
    """
    Persist a new ticket (Issue #3380).

    Previously appended to an in-memory `TICKETS_DB` list - not thread-safe,
    and every ticket created through this endpoint was silently lost on the
    next restart/redeploy. Now delegates to the same tested Supabase
    persistence layer (backend.services.supabase_utils) used elsewhere.

    Accepts a generic dict body rather than the old rigid TicketRecord
    schema (summary/owner_id/timeline/...) - no real caller of this endpoint
    was found using that schema; field names should match the actual
    `tickets` table columns (see POST /tickets/save for the canonical shape
    used by the rest of the app).
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database connection not initialized")

    sanitized = sanitize_ticket_data(ticket)
    created = _supabase_create_ticket(supabase, sanitized)
    if not created:
        raise HTTPException(status_code=500, detail="Failed to create ticket.")
    invalidate_tenant_ticket_cache(
        created.get("company_id") if isinstance(created, dict) else None
    )
    return created


@router.patch("/{ticket_id}")
async def update_ticket(ticket_id: str, updates: dict, user: dict = Depends(get_current_user)):
    """
    Partially update a ticket's fields (Issue #3380).

    Previously mutated an in-memory `TICKETS_DB` list - now persists via
    Supabase directly, matching the real `tickets` table used everywhere
    else in the app.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database connection not initialized")

    sanitized_updates = sanitize_ticket_data(updates)
    updated = _supabase_update_ticket(supabase, ticket_id, sanitized_updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Ticket not found")
    invalidate_tenant_ticket_cache(
        updated.get("company_id") if isinstance(updated, dict) else None
    )
    return updated
