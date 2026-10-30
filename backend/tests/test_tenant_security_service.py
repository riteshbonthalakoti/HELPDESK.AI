import pytest
from backend.services.tenant_security_service import TenantSecurityService

@pytest.fixture
def tenant_service():
    return TenantSecurityService()

def test_verify_jwt_claims_success(tenant_service):
    payload = {"tenant_id": "tenant-123", "scopes": ["tickets:read", "tickets:write"]}
    tenant_id, scopes = tenant_service.verify_jwt_claims(payload, required_scopes=["tickets:read"])
    assert tenant_id == "tenant-123"
    assert "tickets:read" in scopes

def test_verify_jwt_claims_missing_tenant_id(tenant_service):
    payload = {"scopes": ["tickets:read"]}
    with pytest.raises(PermissionError, match="Missing or invalid tenant_id"):
        tenant_service.verify_jwt_claims(payload)

def test_verify_jwt_claims_missing_scope(tenant_service):
    payload = {"tenant_id": "tenant-123", "scopes": ["tickets:read"]}
    with pytest.raises(PermissionError, match="Missing required JWT scope"):
        tenant_service.verify_jwt_claims(payload, required_scopes=["tickets:admin"])

def test_apply_tenant_filter_auto_inject(tenant_service):
    query_filters = {"status": "open"}
    scoped = tenant_service.apply_tenant_filter(query_filters, jwt_tenant_id="tenant-123")
    assert scoped == {"status": "open", "tenant_id": "tenant-123"}

def test_apply_tenant_filter_matching_tenant(tenant_service):
    query_filters = {"status": "open", "tenant_id": "tenant-123"}
    scoped = tenant_service.apply_tenant_filter(query_filters, jwt_tenant_id="tenant-123")
    assert scoped == {"status": "open", "tenant_id": "tenant-123"}

def test_apply_tenant_filter_cross_tenant_rejection(tenant_service):
    query_filters = {"status": "open", "tenant_id": "tenant-456"}
    with pytest.raises(PermissionError, match="Cross-tenant query violation"):
        tenant_service.apply_tenant_filter(query_filters, jwt_tenant_id="tenant-123")
