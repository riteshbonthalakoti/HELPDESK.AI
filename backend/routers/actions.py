from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Dict, Any, Optional
from backend.services.agentic_action_engine import AgenticActionEngine

router = APIRouter(prefix="/actions", tags=["agentic-actions"])

# Global singleton or dependency-injected engine
action_engine = AgenticActionEngine()

class PlaybookExecuteRequest(BaseModel):
    ticket_id: str
    playbook_name: str
    parameters: Dict[str, Any]
    dry_run: Optional[bool] = False

class TokenGenerateRequest(BaseModel):
    ticket_id: str
    playbook_name: str

@router.get("/playbooks")
def list_available_playbooks():
    """Returns the list of allowed deterministic playbooks and descriptions."""
    return {
        "playbooks": [
            {
                "name": name,
                "description": info["description"]
            }
            for name, info in action_engine.PLAYBOOK_REGISTRY.items()
        ]
    }

@router.post("/token")
def generate_action_token(req: TokenGenerateRequest):
    """Generates a secure, time-bound HMAC token for triggering actions."""
    token = action_engine.generate_token(req.playbook_name, req.ticket_id)
    return {"ticket_id": req.ticket_id, "playbook_name": req.playbook_name, "token": token}

@router.post("/execute")
def execute_playbook(req: PlaybookExecuteRequest, x_action_token: Optional[str] = Header(None)):
    """Executes a sandboxed playbook with HMAC verification and dry-run safety."""
    if not x_action_token:
        raise HTTPException(status_code=401, detail="Missing required 'X-Action-Token' header")

    res = action_engine.execute_action(
        playbook_name=req.playbook_name,
        ticket_id=req.ticket_id,
        auth_token=x_action_token,
        parameters=req.parameters,
        dry_run=req.dry_run or False
    )

    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error"))

    return res
