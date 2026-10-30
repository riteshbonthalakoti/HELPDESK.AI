"""
Tenant Security Service for Multi-Tenant Isolation and JWT Scope Verification (#3947).
Enforces tenant scoping on ticket query filters and validates JWT permission scopes.
"""

from typing import Dict, Any, List, Optional, Tuple

class TenantSecurityService:
    def __init__(self):
        pass

    def verify_jwt_claims(self, payload: Dict[str, Any], required_scopes: Optional[List[str]] = None) -> Tuple[str, List[str]]:
        """
        Validates JWT payload claims for tenant_id and scopes.
        Raises PermissionError if tenant_id is missing or required scopes are missing.
        """
        if not payload or not isinstance(payload, dict):
            raise PermissionError("Invalid or missing JWT payload")
            
        tenant_id = payload.get("tenant_id")
        if not tenant_id or not isinstance(tenant_id, str) or not tenant_id.strip():
            raise PermissionError("Missing or invalid tenant_id in JWT payload")

        user_scopes = payload.get("scopes", [])
        if not isinstance(user_scopes, list):
            user_scopes = []

        if required_scopes:
            missing_scopes = [scope for scope in required_scopes if scope not in user_scopes]
            if missing_scopes:
                raise PermissionError(f"Missing required JWT scope(s): {', '.join(missing_scopes)}")

        return tenant_id, user_scopes

    def apply_tenant_filter(self, query_filters: Dict[str, Any], jwt_tenant_id: str) -> Dict[str, Any]:
        """
        Enforces tenant isolation by injecting or verifying tenant_id filter.
        Raises PermissionError if query attempts to cross tenant boundaries.
        """
        if not jwt_tenant_id or not isinstance(jwt_tenant_id, str):
            raise PermissionError("Valid JWT tenant_id is required for query scoping")

        scoped_filters = dict(query_filters) if query_filters else {}

        if "tenant_id" in scoped_filters:
            requested_tenant = scoped_filters["tenant_id"]
            if requested_tenant != jwt_tenant_id:
                raise PermissionError(
                    f"Cross-tenant query violation: requested tenant '{requested_tenant}' does not match JWT tenant '{jwt_tenant_id}'"
                )
        else:
            scoped_filters["tenant_id"] = jwt_tenant_id

        return scoped_filters
