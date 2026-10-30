"""
FastAPI Router for Agentic Self-Healing Actions Engine.
"""

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.services.agentic_action_engine import (
    PlaybookAuthorizationError,
    PlaybookValidationError,
    agentic_action_engine,
)

try:
    from backend.supabase_client import supabase
except ImportError:
    supabase = None  # type: ignore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/actions", tags=["Agentic Actions"])


class ExecutePlaybookRequest(BaseModel):
    """Request schema for executing or simulating a registered remediation playbook."""

    ticket_id: str = Field(..., description="Target ticket identifier")
    playbook_name: str = Field(..., description="Registered playbook name")
    parameters: Dict[str, Any] = Field(default_factory=dict)
    hmac_token: str = Field(..., description="HMAC-SHA256 authorization token")
    dry_run: bool = Field(default=False, description="Validate and simulate without mutating state")
    company_id: Optional[str] = Field(default=None)
    timestamp: Optional[int] = Field(default=None, description="Optional unix timestamp bound to token")
    nonce: Optional[str] = Field(default=None, description="Optional single-use nonce bound to token")


@router.get("/playbooks")
def get_registered_playbooks():
    """Return all allowed deterministic self-healing playbooks."""
    return {"playbooks": agentic_action_engine.list_playbooks()}


@router.post("/execute")
def execute_playbook_endpoint(payload: ExecutePlaybookRequest):
    """Execute a sandboxed remediation playbook with HMAC verification and audit logging."""
    try:
        result = agentic_action_engine.execute_playbook(
            ticket_id=payload.ticket_id,
            playbook_name=payload.playbook_name,
            params=payload.parameters,
            hmac_token=payload.hmac_token,
            supabase_client=supabase,
            dry_run=payload.dry_run,
            company_id=payload.company_id,
            timestamp=payload.timestamp,
            nonce=payload.nonce,
        )
        return result
    except PlaybookValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PlaybookAuthorizationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"Unexpected error executing playbook: {exc}")
        raise HTTPException(status_code=500, detail="Playbook execution failed") from exc


@router.get("/logs")
def list_action_execution_logs(
    ticket_id: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
):
    """Fetch recent audit entries from `action_execution_logs`."""
    if supabase is None:
        return {"logs": [], "count": 0}

    try:
        query = (
            supabase.table("action_execution_logs")
            .select("*")
            .order("executed_at", desc=True)
            .limit(limit)
        )
        if ticket_id:
            query = query.eq("ticket_id", ticket_id)
        res = query.execute()
        logs = getattr(res, "data", None) or []
        return {"logs": logs, "count": len(logs)}
    except Exception as exc:
        logger.error(f"Failed to query action_execution_logs: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch action logs") from exc
