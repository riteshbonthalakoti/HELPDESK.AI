from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Numeric privilege hierarchy representing access elevation levels
ROLE_HIERARCHY: Dict[str, int] = {
    "user": 1,
    "viewer": 1,
    "member": 1,
    "employee": 1,
    "agent": 2,
    "support": 2,
    "technician": 2,
    "manager": 3,
    "lead": 3,
    "admin": 4,
    "super_admin": 5,
    "master_admin": 5,
}


def get_role_level(role: Optional[str]) -> int:
    """Returns numeric level for a given role name, defaulting to 1."""
    if not role:
        return 1
    return ROLE_HIERARCHY.get(role.strip().lower(), 1)


def is_privilege_elevation(old_role: Optional[str], new_role: Optional[str]) -> bool:
    """Determines if transition from old_role to new_role represents an access elevation."""
    if not new_role or old_role == new_role:
        return False
    return get_role_level(new_role) > get_role_level(old_role)


def get_elevation_severity(old_role: Optional[str], new_role: Optional[str]) -> str:
    """Classifies risk severity of privilege transition."""
    new_lvl = get_role_level(new_role)
    old_lvl = get_role_level(old_role)

    if new_lvl >= 4 and old_lvl < 4:
        return "CRITICAL"  # Elevated to Admin or Super/Master Admin
    elif new_lvl == 3 and old_lvl < 3:
        return "HIGH"  # Elevated to Manager
    elif new_lvl > old_lvl:
        return "MEDIUM"  # Elevated to Agent/Support
    elif new_lvl < old_lvl:
        return "DEMOTION"
    return "LOW"


class PrivilegeAuditService:
    """Service for tracking and persisting security audit records on privilege access elevations."""

    def __init__(self, supabase_client=None):
        self.supabase = supabase_client

    def record_privilege_elevation(
        self,
        operator_id: str,
        target_user_id: str,
        old_role: str,
        new_role: str,
        operator_email: Optional[str] = None,
        target_user_email: Optional[str] = None,
        company_id: Optional[str] = None,
        ip_address: Optional[str] = None,
        reason: Optional[str] = None,
        custom_metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Creates and stores an immutable security audit record for role/privilege changes.
        """
        now_utc = datetime.now(timezone.utc).isoformat()
        is_elevation = is_privilege_elevation(old_role, new_role)
        severity = get_elevation_severity(old_role, new_role)

        action_name = "privilege_access_elevation" if is_elevation else "role_modification"
        event_type = "auth_privilege_elevation" if is_elevation else "auth_role_update"

        operator_display = operator_email or operator_id or "system_operator"
        target_display = target_user_email or target_user_id or "unknown_user"

        message = (
            f"Security Audit: Operator [{operator_display}] elevated target user "
            f"[{target_display}] from role '{old_role}' to '{new_role}'"
            if is_elevation
            else f"Security Audit: Operator [{operator_display}] updated role of "
            f"[{target_display}] from '{old_role}' to '{new_role}'"
        )

        metadata: Dict[str, Any] = {
            "target_user_id": target_user_id,
            "target_user_email": target_user_email,
            "operator_id": operator_id,
            "operator_email": operator_email,
            "old_role": old_role,
            "new_role": new_role,
            "is_elevation": is_elevation,
            "severity": severity,
            "ip_address": ip_address,
            "reason": reason or "Administrative role assignment",
            "timestamp": now_utc,
        }

        if custom_metadata:
            metadata.update(custom_metadata)

        audit_entry = {
            "event_type": event_type,
            "action": action_name,
            "actor_type": "admin",
            "performed_by": operator_id,
            "company_id": company_id,
            "message": message,
            "old_value": {"role": old_role},
            "new_value": {"role": new_role},
            "metadata": metadata,
            "created_at": now_utc,
        }

        if self.supabase:
            try:
                res = self.supabase.table("audit_logs").insert(audit_entry).execute()
                if res.data:
                    return res.data[0]
            except Exception as e:
                logger.error(f"Failed to persist privilege audit record to Supabase: {e}")

        # Return synthesized record if DB unavailable or in local mode
        return audit_entry

    def get_privilege_audit_logs(
        self,
        company_id: Optional[str] = None,
        target_user_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """Queries privilege audit records filtered by company or target user."""
        if not self.supabase:
            return []

        try:
            query = (
                self.supabase.table("audit_logs")
                .select("*")
                .in_("event_type", ["auth_privilege_elevation", "auth_role_update", "privilege_access_elevation"])
                .order("created_at", desc=True)
                .limit(limit)
            )

            if company_id:
                query = query.eq("company_id", company_id)

            res = query.execute()
            data = res.data or []

            if target_user_id:
                data = [
                    d for d in data
                    if d.get("metadata", {}).get("target_user_id") == target_user_id
                ]

            return data
        except Exception as e:
            logger.error(f"Failed to fetch privilege audit records: {e}")
            return []
