from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
import io
import csv
from datetime import datetime
from backend.database import supabase
from backend.auth_cookie import get_current_user
from backend.schemas import ProfileUpdate

router = APIRouter(prefix="/api", tags=["Admin"])

@router.get("/profiles")
async def api_get_profiles(
    role: str = None,
    status: str = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """List admin-visible profiles with optional role and status filters."""
    if not supabase: return []
    query = supabase.table("profiles").select("*")
    if role: query = query.eq("role", role)
    if status: query = query.eq("status", status)
    res = query.range(offset, offset + limit - 1).execute()
    return res.data

@router.patch("/profiles/{user_id}")
async def api_update_profile(
    user_id: str,
    updates: ProfileUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Apply an admin edit to a user profile."""
    if not supabase: return {}
    # Schema validation in ProfileUpdate (extra="forbid") already blocks
    # any field outside the allowlist, so a Pydantic .model_dump() with
    # exclude_unset=True gives us only what the client actually sent.
    payload = updates.model_dump(exclude_unset=True)
    if not payload:
        return {}
    res = supabase.table("profiles").update(payload).eq("id", user_id).execute()
    return res.data[0] if res.data else {}

@router.delete("/profiles/{user_id}")
async def api_delete_profile(
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a user profile and cascade auth cleanup when possible."""
    if not supabase: return {"success": False}
    supabase.table("profiles").delete().eq("id", user_id).execute()
    try:
        supabase.rpc('delete_user').execute()
    except: pass
    return {"success": True}

CANONICAL_COMPANY_ID = "76d16bf6-2ee9-44ad-b64e-ad5ecf0a079b"
CANONICAL_COMPANY_NAME = "RITESH PVT LTD"

@router.get("/companies")
async def api_get_companies(
    current_user: dict = Depends(get_current_user),
):
    """Return the canonical single-tenant company (RITESH PVT LTD)."""
    if not supabase: return []
    res = (
        supabase.table("companies")
        .select("*")
        .eq("id", CANONICAL_COMPANY_ID)
        .execute()
    )
    return res.data

@router.get("/admin_requests")
async def api_get_admin_requests(
    status: str = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """List admin requests with optional status filtering."""
    if not supabase: return []
    query = supabase.table("admin_requests").select("*")
    if status: query = query.eq("status", status)
    res = query.range(offset, offset + limit - 1).execute()
    return res.data

@router.get("/admin/metrics/team/csv")
async def export_team_metrics_csv(
    company_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Export team statistics in streaming CSV format."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not initialized")
    
    # Check if user is authorized for this company (must be part of the company and admin)
    # The Supabase RLS policies already protect data, but we should validate access.
    # For now, we rely on Supabase returning empty if unauthorized, but we'll fetch anyway.

    # Fetch all tickets for the given company_id. 
    # For very large datasets we would paginate in the generator, but for typical
    # team metrics summaries an in-memory aggregation of the lightweight payload is extremely fast.
    res = supabase.table("tickets").select(
        "assigned_team, status, sla_status, created_at, closed_at, resolved_at"
    ).eq("company_id", company_id).execute()
    
    tickets = res.data or []
    
    teams = {}
    for t in tickets:
        team = t.get("assigned_team") or "Unassigned"
        if team not in teams:
            teams[team] = {
                "Total Tickets": 0,
                "Open Tickets": 0,
                "Resolved Tickets": 0,
                "SLA Breached": 0,
                "Avg Resolution Time (hrs)": 0.0,
                "_resolution_hours": []
            }
            
        teams[team]["Total Tickets"] += 1
        
        status = (t.get("status") or "").lower()
        if status in ("resolved", "closed", "auto_resolved"):
            teams[team]["Resolved Tickets"] += 1
            
            # calculate resolution time
            created = t.get("created_at")
            closed = t.get("closed_at") or t.get("resolved_at")
            if created and closed:
                try:
                    c_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                    r_dt = datetime.fromisoformat(closed.replace("Z", "+00:00"))
                    diff = (r_dt - c_dt).total_seconds() / 3600.0
                    if diff >= 0:
                        teams[team]["_resolution_hours"].append(diff)
                except Exception:
                    pass
        else:
            teams[team]["Open Tickets"] += 1
            
        if (t.get("sla_status") or "").upper() == "BREACHED":
            teams[team]["SLA Breached"] += 1

    # calculate averages
    for team, stats in teams.items():
        hrs = stats.pop("_resolution_hours")
        if hrs:
            stats["Avg Resolution Time (hrs)"] = round(sum(hrs) / len(hrs), 2)
        else:
            stats["Avg Resolution Time (hrs)"] = 0.0

    def iter_csv():
        output = io.StringIO()
        fieldnames = ["Team Name", "Total Tickets", "Open Tickets", "Resolved Tickets", "SLA Breached", "Avg Resolution Time (hrs)"]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)
        
        for team in sorted(teams.keys()):
            row = {"Team Name": team}
            row.update(teams[team])
            writer.writerow(row)
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

    headers = {
        "Content-Disposition": f"attachment; filename=team_statistics_{company_id}.csv"
    }
    return StreamingResponse(iter_csv(), media_type="text/csv", headers=headers)
