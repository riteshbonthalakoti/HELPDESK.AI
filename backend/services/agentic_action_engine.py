import hmac
import hashlib
import time
import json
import logging
from typing import Dict, Any, Optional, Tuple, Callable
from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)

# --- Playbook Input Schemas ---

class PasswordResetSchema(BaseModel):
    user_id: str = Field(..., min_length=3, description="Target user identifier")
    tenant_id: str = Field(..., description="Enterprise organization tenant ID")
    notify_email: Optional[str] = Field(None, description="Email for temporary token delivery")

class VpnCertRefreshSchema(BaseModel):
    user_id: str = Field(..., description="Target employee user ID")
    device_id: str = Field(..., description="Registered corporate device hardware ID")
    region: str = Field(default="global", description="VPN gateway cluster region")

class DnsFlushSchema(BaseModel):
    tenant_id: str = Field(..., description="Tenant namespace identifier")
    cluster_node: Optional[str] = Field(default="edge-primary", description="DNS cluster resolver node")

# --- Playbook Handlers ---

def execute_password_reset(params: Dict[str, Any], dry_run: bool = False) -> Dict[str, Any]:
    if dry_run:
        return {
            "status": "dry_run_success",
            "action": "password_reset",
            "message": f"Preflight valid: temporary reset token would be issued for user {params['user_id']}."
        }
    temp_token = hashlib.sha256(f"{params['user_id']}:{time.time()}".encode()).hexdigest()[:16]
    return {
        "status": "success",
        "action": "password_reset",
        "user_id": params["user_id"],
        "temp_token_expiry_sec": 900,
        "token_prefix": temp_token[:4] + "****",
        "message": f"Password reset token generated and dispatched for user {params['user_id']}."
    }

def execute_vpn_cert_refresh(params: Dict[str, Any], dry_run: bool = False) -> Dict[str, Any]:
    if dry_run:
        return {
            "status": "dry_run_success",
            "action": "vpn_cert_refresh",
            "message": f"Preflight valid: VPN profile {params['device_id']} would be re-issued in region {params.get('region', 'global')}."
        }
    new_cert_serial = hashlib.sha1(f"{params['device_id']}:{params['user_id']}:{time.time()}".encode()).hexdigest()[:12]
    return {
        "status": "success",
        "action": "vpn_cert_refresh",
        "device_id": params["device_id"],
        "cert_serial": new_cert_serial,
        "message": f"VPN tunnel certificate refreshed for device {params['device_id']}."
    }

def execute_dns_flush(params: Dict[str, Any], dry_run: bool = False) -> Dict[str, Any]:
    if dry_run:
        return {
            "status": "dry_run_success",
            "action": "dns_flush",
            "message": f"Preflight valid: DNS cache would be purged on node {params.get('cluster_node', 'edge-primary')}."
        }
    return {
        "status": "success",
        "action": "dns_flush",
        "purged_records": 128,
        "cluster_node": params.get("cluster_node", "edge-primary"),
        "message": f"DNS resolver cache flushed on {params.get('cluster_node', 'edge-primary')}."
    }

# --- Core Action Engine ---

class AgenticActionEngine:
    """
    Deterministic sandboxed action execution engine for automated Tier-1 helpdesk deflection.
    """
    PLAYBOOK_REGISTRY: Dict[str, Dict[str, Any]] = {
        "password_reset": {
            "schema": PasswordResetSchema,
            "handler": execute_password_reset,
            "description": "Deterministic user credential reset and temporary token provisioning"
        },
        "vpn_cert_refresh": {
            "schema": VpnCertRefreshSchema,
            "handler": execute_vpn_cert_refresh,
            "description": "Revoke and re-issue corporate client VPN access profile"
        },
        "dns_flush": {
            "schema": DnsFlushSchema,
            "handler": execute_dns_flush,
            "description": "Purge edge resolver cache for high-latency or connection issue deflection"
        }
    }

    def __init__(self, hmac_secret: str = "helpdesk_action_engine_secure_key_2026", db_client: Optional[Any] = None):
        self.hmac_secret = hmac_secret
        self.db = db_client

    def generate_token(self, playbook_name: str, ticket_id: str, timestamp: Optional[int] = None) -> str:
        ts = timestamp or int(time.time())
        message = f"{playbook_name}:{ticket_id}:{ts}".encode()
        signature = hmac.new(self.hmac_secret.encode(), message, hashlib.sha256).hexdigest()
        return f"{ts}.{signature}"

    def verify_token(self, token: str, playbook_name: str, ticket_id: str, max_age_seconds: int = 300) -> bool:
        try:
            parts = token.split(".")
            if len(parts) != 2:
                return False
            ts_str, signature = parts
            ts = int(ts_str)
            now = int(time.time())

            if abs(now - ts) > max_age_seconds:
                return False

            expected = hmac.new(
                self.hmac_secret.encode(),
                f"{playbook_name}:{ticket_id}:{ts}".encode(),
                hashlib.sha256
            ).hexdigest()

            return hmac.compare_digest(signature, expected)
        except Exception:
            return False

    def execute_action(
        self,
        playbook_name: str,
        ticket_id: str,
        auth_token: str,
        parameters: Dict[str, Any],
        dry_run: bool = False
    ) -> Dict[str, Any]:
        start_time = time.time()

        # 1. Playbook Existence Check
        if playbook_name not in self.PLAYBOOK_REGISTRY:
            return {
                "success": False,
                "error": f"Unknown playbook: '{playbook_name}'. Available: {list(self.PLAYBOOK_REGISTRY.keys())}",
                "execution_time_ms": round((time.time() - start_time) * 1000, 2)
            }

        # 2. Strict HMAC Authorization Check
        if not self.verify_token(auth_token, playbook_name, ticket_id):
            return {
                "success": False,
                "error": "Unauthorized: Invalid or expired HMAC execution token",
                "execution_time_ms": round((time.time() - start_time) * 1000, 2)
            }

        # 3. Parameter Schema Validation
        playbook = self.PLAYBOOK_REGISTRY[playbook_name]
        schema_cls: Callable = playbook["schema"]
        try:
            validated_params = schema_cls(**parameters).dict()
        except ValidationError as e:
            return {
                "success": False,
                "error": f"Schema validation error: {e.errors()}",
                "execution_time_ms": round((time.time() - start_time) * 1000, 2)
            }

        # 4. Playbook Execution
        try:
            handler: Callable = playbook["handler"]
            output = handler(validated_params, dry_run=dry_run)
            execution_time = round((time.time() - start_time) * 1000, 2)

            result = {
                "success": True,
                "playbook": playbook_name,
                "ticket_id": ticket_id,
                "dry_run": dry_run,
                "result": output,
                "execution_time_ms": execution_time
            }

            # 5. Audit Logging to action_execution_logs
            self._log_audit(ticket_id, playbook_name, parameters, output, is_dry_run=dry_run, success=True)

            # 6. Auto-Deflection Loop
            if not dry_run:
                self._apply_auto_deflection(ticket_id, playbook_name, output)

            return result

        except Exception as exc:
            execution_time = round((time.time() - start_time) * 1000, 2)
            self._log_audit(ticket_id, playbook_name, parameters, {"error": str(exc)}, is_dry_run=dry_run, success=False)
            return {
                "success": False,
                "error": f"Execution error: {str(exc)}",
                "execution_time_ms": execution_time
            }

    def _log_audit(self, ticket_id: str, action: str, input_params: Dict[str, Any], output_data: Dict[str, Any], is_dry_run: bool, success: bool):
        payload = {
            "ticket_id": ticket_id,
            "action": action,
            "input_params": json.dumps(input_params),
            "output_data": json.dumps(output_data),
            "is_dry_run": is_dry_run,
            "success": success,
            "executed_at": time.strftime("%Y-%m-%d %H:%M:%SZ", time.gmtime())
        }
        if self.db and hasattr(self.db, "table"):
            try:
                self.db.table("action_execution_logs").insert(payload).execute()
            except Exception as e:
                logger.warning(f"Failed to record Supabase audit log: {e}")

    def _apply_auto_deflection(self, ticket_id: str, action: str, output: Dict[str, Any]):
        if self.db and hasattr(self.db, "table"):
            try:
                # Update ticket status to resolved
                self.db.table("tickets").update({
                    "status": "resolved",
                    "resolution_notes": f"Auto-deflected by Agentic Action Engine: {action}. {output.get('message', '')}"
                }).eq("id", ticket_id).execute()
            except Exception as e:
                logger.warning(f"Failed to update ticket deflection status: {e}")
