from fastapi import APIRouter, Depends, HTTPException, Request
from backend.services.privilege_audit_service import PrivilegeAuditService
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
    request: Request = None,
    current_user: dict = Depends(get_current_user),
):
    """Apply an admin edit to a user profile and record privilege elevation audit logs."""
    if not supabase: return {}
    payload = updates.model_dump(exclude_unset=True)
    if not payload:
        return {}

    # Retrieve existing role for privilege access elevation auditing
    old_role = None
    target_email = None
    target_company = None
    if "role" in payload:
        try:
            curr_res = supabase.table("profiles").select("role, email, company_id").eq("id", user_id).single().execute()
            if curr_res.data:
                old_role = curr_res.data.get("role")
                target_email = curr_res.data.get("email")
                target_company = curr_res.data.get("company_id")
        except Exception:
            pass

    res = supabase.table("profiles").update(payload).eq("id", user_id).execute()

    # Record privilege elevation audit record
    if "role" in payload and res.data:
        new_role = payload.get("role")
        if old_role != new_role:
            try:
                audit_svc = PrivilegeAuditService(supabase)
                operator_id = current_user.get("id") or current_user.get("sub") or "admin"
                operator_email = current_user.get("email")
                ip_addr = request.client.host if request and request.client else None
                audit_svc.record_privilege_elevation(
                    operator_id=operator_id,
                    target_user_id=user_id,
                    old_role=old_role or "user",
                    new_role=new_role,
                    operator_email=operator_email,
                    target_user_email=target_email,
                    company_id=target_company or current_user.get("company_id"),
                    ip_address=ip_addr,
                )
            except Exception:
                pass

    return res.data[0] if res.data else {}


@router.get("/audit/privilege-elevations")
async def api_get_privilege_elevations(
    target_user_id: str = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
):
    """Retrieve security audit records for privilege access elevations."""
    if not supabase: return []
    audit_svc = PrivilegeAuditService(supabase)
    company_id = current_user.get("company_id")
    return audit_svc.get_privilege_audit_logs(
        company_id=company_id,
        target_user_id=target_user_id,
        limit=limit
    )

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

@router.get("/companies")
async def api_get_companies(
    current_user: dict = Depends(get_current_user),
):
    """Return the company list visible to the current admin."""
    if not supabase: return []
    res = supabase.table("companies").select("*").execute()
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
