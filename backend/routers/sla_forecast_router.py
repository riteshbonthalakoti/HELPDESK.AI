from fastapi import APIRouter, Query, HTTPException
from typing import Dict, Any, Optional
from backend.services.sla_forecasting_service import SLAForecastingService, TicketContext

router = APIRouter(prefix="/internal/sla", tags=["sla-forecasting"])

forecasting_service = SLAForecastingService()

@router.get("/forecast")
def get_sla_forecast_distribution(company_id: str = Query(..., description="Target company/tenant identifier")):
    """
    Returns real-time SLA breach probability distribution and capacity risk metrics.
    """
    if not company_id or not company_id.strip():
        raise HTTPException(status_code=400, detail="company_id query parameter is required")

    # In production, fetches active tickets from DB; fallback to structured tenant metrics
    distribution = forecasting_service.get_company_risk_distribution(company_id)
    return distribution

@router.post("/evaluate")
def evaluate_ticket_sla(context: TicketContext):
    """
    Evaluates SLA breach probability at ticket creation time and applies mitigation actions.
    """
    result = forecasting_service.evaluate_and_balance(context)
    return result
