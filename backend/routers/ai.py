
import json
import logging
import uuid
import datetime
import traceback
import asyncio
import os 
from pathlib import Path
from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.encoders import jsonable_encoder
from backend.auth_cookie import get_current_user
from backend.dependencies import (
    limiter, get_system_settings,
    classifier_service, classifier_v3, classifier_v2,
    ner_service, duplicate_service, rag_service,
    gemini_service, ocr_service
)
from backend.models import (
    TicketRequest, TicketResponse, EntityInfo, DuplicateInfo,
    TroubleshootRequest, TroubleshootResponse,
    BugReportAnalysisRequest, BugReportAnalysisResponse
)
from pydantic import BaseModel, Field, validator
import uuid as uuid_lib
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])

CORRECTIONS_LOG_PATH = Path(__file__).parent.parent / "data" / "corrections_log.json"
@router.post("/troubleshoot", response_model=TroubleshootResponse)
async def troubleshoot(request: TroubleshootRequest, user: dict = Depends(get_current_user)):
    """Get dynamic troubleshooting steps from Gemini."""
    if not gemini_service or not gemini_service._initialized:
        return TroubleshootResponse(
            step_text="AI Troubleshooting is currently unavailable.",
            options=["Continue to tracking"],
            is_final=True
        )
    
    result = gemini_service.get_troubleshooting_step(
        request.text,
        request.history,
        request.category
    )
    return TroubleshootResponse(**result)


@router.post("/analyze_bug", response_model=BugReportAnalysisResponse)
async def analyze_bug(request: BugReportAnalysisRequest, user: dict = Depends(get_current_user)):
    """Analyze a bug report using Gemini to generate a Probable Cause."""
    if not gemini_service or not gemini_service._initialized:
        return BugReportAnalysisResponse(
            probable_cause="AI Diagnostics are currently unavailable."
        )
    
    cause = gemini_service.analyze_bug_report(
        request.bug_title,
        request.description,
        request.steps_to_reproduce,
        request.console_errors
    )
    return BugReportAnalysisResponse(probable_cause=cause)


# --- Correction Log Schema ---
class PredictionSnapshot(BaseModel):
    category: str = Field("", max_length=100)
    subcategory: str = Field("", max_length=100)
    priority: str = Field("", max_length=50)
    assigned_team: str = Field("", max_length=100)

class CorrectionLogRequest(BaseModel):
    ticket_id: str = Field(..., max_length=100)
    original_text: str = Field("", max_length=5000)
    ocr_text: str = Field("", max_length=2000)
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    original_prediction: PredictionSnapshot = Field(default_factory=PredictionSnapshot)
    corrected_prediction: PredictionSnapshot = Field(default_factory=PredictionSnapshot)

    @validator("ticket_id")
    def ticket_id_must_not_be_empty(cls, v):
        if not v.strip():
            raise ValueError("ticket_id cannot be empty")
        return v.strip()
    
MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024  # 5MB

@router.post("/log_correction")
async def log_correction(body: CorrectionLogRequest, user: dict = Depends(get_current_user)):
    """Log an admin correction with schema validation, auth, log rotation and atomic writes."""

    changed_fields = [
        field for field in ["category", "subcategory", "priority", "assigned_team"]
        if getattr(body.original_prediction, field) != getattr(body.corrected_prediction, field)
    ]

    if not changed_fields:
        return {"status": "no_change", "message": "Prediction matches correction, nothing logged."}

    correlation_id = str(uuid_lib.uuid4())

    entry = {
        "correlation_id": correlation_id,
        "ticket_id": body.ticket_id,
        "original_text": body.original_text,
        "ocr_text": body.ocr_text,
        "original_prediction": body.original_prediction.dict(),
        "corrected_prediction": body.corrected_prediction.dict(),
        "changed_fields": changed_fields,
        "confidence": body.confidence,
        "logged_by": user.get("id", "unknown"),
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
    }

    try:
        # Log rotation: archive if over 5MB
        if CORRECTIONS_LOG_PATH.exists() and CORRECTIONS_LOG_PATH.stat().st_size > MAX_LOG_SIZE_BYTES:
            archive_path = CORRECTIONS_LOG_PATH.with_suffix(
                f".{datetime.datetime.utcnow().strftime('%Y%m%d%H%M%S')}.json"
            )
            CORRECTIONS_LOG_PATH.rename(archive_path)
            logger.info(f"[CORRECTION] Log rotated to {archive_path}")

        # Load existing logs
        if CORRECTIONS_LOG_PATH.exists() and CORRECTIONS_LOG_PATH.stat().st_size > 2:
            with open(CORRECTIONS_LOG_PATH, "r", encoding="utf-8") as f:
                logs = json.load(f)
        else:
            logs = []

        # Deduplication: skip if same ticket_id + changed_fields logged in last 60s
        now = datetime.datetime.utcnow()
        for existing in logs[-50:]:  # only check recent entries
            if (
                existing.get("ticket_id") == body.ticket_id
                and existing.get("changed_fields") == changed_fields
            ):
                existing_ts = datetime.datetime.fromisoformat(existing["timestamp"].rstrip("Z"))
                if (now - existing_ts).total_seconds() < 60:
                    return {"status": "duplicate", "message": "Duplicate correction ignored."}

        logs.append(entry)

        # Atomic write: write to .tmp then replace
        tmp_path = CORRECTIONS_LOG_PATH.with_suffix(".tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(logs, f, indent=2)
        os.replace(tmp_path, CORRECTIONS_LOG_PATH)

        logger.info(f"[CORRECTION SAVED] ticket_id={body.ticket_id} | changed={changed_fields} | correlation_id={correlation_id}")
        return {"status": "saved", "changed_fields": changed_fields, "correlation_id": correlation_id}

    except Exception as e:
        logger.error(f"[CORRECTION ERROR] {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to save correction log.")
    

@router.post("/analyze_ticket", response_model=TicketResponse)
@limiter.limit("10/minute")
async def analyze_ticket(request_body: TicketRequest, request: Request, user: dict = Depends(get_current_user)):
    """
    Main endpoint for analyzing a new ticket using the cascade of local AI models.
    """
    text = request_body.text

    settings = get_system_settings(request_body.company)
    confidence_threshold = settings["ai_confidence_threshold"]
    duplicate_sensitivity = settings["duplicate_sensitivity"]
    enable_auto_resolve = settings["enable_auto_resolve"]
    
    # Grab client metadata
    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "unknown")
    origin_host = request.headers.get("origin", "unknown")
    
    env_metadata = {
        "ip": client_ip,
        "user_agent": user_agent,
        "origin": origin_host
    }

    # --- Layer 1: Local OCR (CPU, no API required) ---
    local_ocr_text = ""
    if request_body.image_base64 and ocr_service:
        print("[AI] Extracting text via local OCR...")
        local_ocr_text = ocr_service.extract_text(request_body.image_base64)
        if local_ocr_text:
            text = f"{text} {local_ocr_text}".strip()
            print(f"[AI] OCR added {len(local_ocr_text)} chars to context.")

    # Initalize Timeline
    return await analyze_only(request_body)

@router.post("/analyze")
async def analyze_only(request_body: TicketRequest, user: dict = Depends(get_current_user)):
    """
    PERFORMANCE UPGRADE: AI Analysis phase only. 
    Does NOT persist to DB. This allows the user to review the analysis 
    and duplicate check before committing to a ticket creation.
    """
    text = request_body.text
    print(f"[AI] Starting Analysis (READ-ONLY) for: {text[:50]}...") 
    settings = get_system_settings(request_body.company)
    confidence_threshold = settings["ai_confidence_threshold"]
    duplicate_sensitivity = settings["duplicate_sensitivity"]
    enable_auto_resolve = settings["enable_auto_resolve"]
    enable_translation = settings.get("enable_translation", True)  # Translation enabled by default
    
    # --- Language Detection and Translation ---
    from backend.services.translation_service import detect_language, translate_text
    
    detected_language = None
    original_text = text
    translation_info = None
    
    if enable_translation and text.strip():
        try:
            print("[AI] Detecting language...")
            detected_language = detect_language(text)
            print(f"[AI] Detected language: {detected_language}")
            
            # Translate non-English tickets to English for classification
            if detected_language and detected_language != 'en':
                print(f"[AI] Translating from {detected_language} to English...")
                translation_result = translate_text(
                    text=text,
                    target_lang='en',
                    source_lang=detected_language
                )
                
                if translation_result.get('translated') and translation_result['translated'] != text:
                    translated_text = translation_result['translated']
                    text = translated_text  # Use translated text for classification
                    translation_info = {
                        'original_language': detected_language,
                        'original_text': original_text,
                        'translated_text': translated_text,
                        'translation_confidence': translation_result.get('confidence', 0.0)
                    }
                    print(f"[AI] Translation successful. Using translated text for classification.")
                else:
                    print("[AI] Translation returned same text, using original.")
            else:
                print("[AI] Text is in English, no translation needed.")
        except Exception as e:
            print(f"[AI] Language detection/translation error: {e}")
            # Continue with original text if translation fails
            detected_language = 'en'
    
    # --- Context & Environment ---
    import datetime
    def get_now_ist():
        return datetime.datetime.utcnow().isoformat() + "Z"

    env_metadata = {
        "timestamp": get_now_ist(),
        "model_version": "3.0.0-PRO",
        "api_endpoint": "/analyze",
        "detected_language": detected_language or 'en'
    }
    
    timeline = {"received": get_now_ist()}

    # --- Vision Logic (OCR Awareness) ---
    gemini_analysis = {
        "ocr_text": request_body.image_text or "",
        "image_description": ""
    }
    
    if request_body.image_base64 and not gemini_analysis["ocr_text"]:
        try:
            print("[AI] Detecting visual context via Gemini...")
            vision_result = gemini_service.analyze_image(request_body.image_base64, text)
            gemini_analysis.update(vision_result)
        except Exception as e:
            print(f"[VISION ERROR] {e}")

    # Multi-modal Vision Diagnostics (Issue #4114)
    if request_body.image_base64 and hasattr(gemini_service, "diagnose_screenshot"):
        try:
            vision_diag = gemini_service.diagnose_screenshot(request_body.image_base64, text)
            env_metadata["vision_diagnostics"] = vision_diag
        except Exception as e:
            print(f"[VISION DIAGNOSTICS WARNING] {e}")

    summary = text[:100] + ("…" if len(text) > 100 else "") 

    # --- Classification ---
    try:
        classification_v3_res = classifier_v3.predict(text)
        if "error" in classification_v3_res:
            # Fallback to V1
            classification = classifier_service.predict(text)
        else:
            # Parse V3 output
            cat = classification_v3_res.get("Category", {}).get("prediction", "Unknown")
            sub = classification_v3_res.get("Subcategory", {}).get("prediction", "Unknown")
            pri = classification_v3_res.get("priority", {}).get("prediction", "Medium")
            conf = classification_v3_res.get("Category", {}).get("confidence", 0.0)
            
            from backend.services.classifier_service import TEAM_MAP, AUTO_RESOLVE_SUBS
            assigned_team = TEAM_MAP.get(cat, "General Support")
            auto_resolve = sub in AUTO_RESOLVE_SUBS
            
            classification = {
                "category": cat,
                "subcategory": sub,
                "priority": pri,
                "auto_resolve": auto_resolve,
                "assigned_team": assigned_team,
                "confidence": float(conf)
            }
    except Exception as e:
        traceback.print_exc()
        classification = {
            "category": "Unknown", "subcategory": "Unknown", "priority": "Medium",
            "auto_resolve": False, "assigned_team": "General Support", "confidence": 0.0,
        }

    timeline["ai_analyzed"] = get_now_ist()
    timeline["triaged"] = get_now_ist()

    # --- NER ---
    try:
        entities = ner_service.extract_entities(text)
    except Exception:
        entities = []
    
    timeline["metadata_harvested"] = get_now_ist()

    # --- Duplicate detection ---
    try:
        dup_result = duplicate_service.check_duplicate(text, threshold=duplicate_sensitivity)
    except Exception:
        dup_result = {"is_duplicate": False, "duplicate_ticket_id": None, "similarity": 0.0}

    # --- RAG Knowledge Base Check ---
    rag_suggestions = []
    rag_recommendations = []
    rag_match = None
    try:
        rag_res = rag_service.search_enhanced(text, threshold=0.65, match_count=5, company_id=request_body.company)
        rag_match = rag_res.get("best_match")
        if rag_match:
            classification["auto_resolve"] = True
            classification["assigned_team"] = "Auto-Resolve AI"
            classification["confidence"] = max(classification["confidence"], float(rag_match["confidence"]))
            print(f"[RAG SUCCESS] Found solution for: '{rag_match['title']}'")
        rag_suggestions = rag_res.get("suggestions") or []
        rag_recommendations = rag_res.get("recommendations") or []
    except Exception as e:
        print(f"[RAG ERROR] {e}")

    # --- Reasoning ---
    decision_factors = []
    if classification["confidence"] > confidence_threshold:
        decision_factors.append(f"High confidence match for '{classification['subcategory']}'")
    if entities:
        decision_factors.append(f"Detected entities: {', '.join([e['text'] for e in entities[:2]])}")
    if dup_result["is_duplicate"]:
        decision_factors.append(f"Found similar incident ({int(dup_result['similarity']*100)}%)")
    if rag_match:
        decision_factors.append(f"Found solution article: '{rag_match['title']}'")

    reasoning = f"Categorized as '{classification['category']}' - {classification['subcategory']}."
    if (
        enable_auto_resolve
        and classification["confidence"] >= confidence_threshold
        and classification["auto_resolve"]
    ):
        classification["auto_resolve"] = True
    else:
        classification["auto_resolve"] = False
    if classification["auto_resolve"]:
        reasoning += " Flagged for AI auto-resolution via Knowledge Base." if rag_match else " Flagged for auto-resolution."
    
    timeline["routed"] = get_now_ist()
    
    # --- Gemini Summary ---
    if gemini_service and gemini_service._initialized:
        summary = gemini_service.get_summary(text)
    
    # Convert priority to SLA breached timestamp (for preview)
    hours_map = {"Critical": 2, "High": 8, "Medium": 24, "Low": 72}
    sla_hours = hours_map.get(classification["priority"], 72)
    sla_breach_dt = datetime.datetime.utcnow() + datetime.timedelta(hours=sla_hours)

    return TicketResponse(
        ticket_id=str(uuid.uuid4()), # Temporary ID
        summary=summary,
        category=classification["category"],
        subcategory=classification["subcategory"],
        priority=classification["priority"],
        auto_resolve=classification["auto_resolve"],
        assigned_team=classification["assigned_team"],
        entities=[EntityInfo(**e) for e in entities],
        duplicate_ticket=DuplicateInfo(**dup_result),
        confidence=classification["confidence"],
        needs_review=classification["confidence"] < confidence_threshold,
        reasoning=reasoning,
        decision_factors=decision_factors,
        image_description=gemini_analysis["image_description"],
        ocr_text=gemini_analysis["ocr_text"],
        image_url=request_body.image_url,
        highlights=entities, # Use entities as highlights for now
        timeline=timeline,
        env_metadata=env_metadata,
        sla_breach_at=sla_breach_dt.isoformat() + "Z",
        rag_suggestions=rag_suggestions,
        rag_recommendations=rag_recommendations,
        # Translation info
        detected_language=translation_info.get('original_language') if translation_info else None,
        original_text=translation_info.get('original_text') if translation_info else None,
        translated_text=translation_info.get('translated_text') if translation_info else None,
        translation_confidence=translation_info.get('translation_confidence') if translation_info else None
    )

@router.post("/analyze_stream")
async def analyze_stream(request_body: TicketRequest, user: dict = Depends(get_current_user)):
    """
    REAL-TIME SSE ENDPOINT: Streams the AI progress to the frontend dynamically.
    """
    import datetime
    def get_now_ist():
        return datetime.datetime.utcnow().isoformat() + "Z"

    async def event_generator():
        text = request_body.text
        env_metadata = {
            "timestamp": get_now_ist(),
            "model_version": "3.0.0-PRO",
            "api_endpoint": "/analyze_stream"
        }
        timeline = {"received": get_now_ist()} 
        settings = get_system_settings(request_body.company)
        confidence_threshold = settings["ai_confidence_threshold"]
        duplicate_sensitivity = settings["duplicate_sensitivity"]
        enable_auto_resolve = settings["enable_auto_resolve"]

        # 1. Reading
        yield f"data: {json.dumps({'step': 'Reading your message', 'status': 'in_progress'})}\n\n"
        await asyncio.sleep(0.5)

        gemini_analysis = {"ocr_text": request_body.image_text or "", "image_description": ""}
        if request_body.image_base64 and not gemini_analysis["ocr_text"]:
            try:
                vision_result = gemini_service.analyze_image(request_body.image_base64, text)
                gemini_analysis.update(vision_result)
            except Exception as e:
                pass

        if request_body.image_base64 and hasattr(gemini_service, "diagnose_screenshot"):
            try:
                vision_diag = gemini_service.diagnose_screenshot(request_body.image_base64, text)
                env_metadata["vision_diagnostics"] = vision_diag
            except Exception:
                pass

        summary = text[:100] + ("…" if len(text) > 100 else "") 

        # 2. NER
        yield f"data: {json.dumps({'step': 'Extracting technical entities', 'status': 'in_progress'})}\n\n"
        await asyncio.sleep(0.2)
        try:
            entities = ner_service.extract_entities(text)
        except Exception:
            entities = []
        timeline["metadata_harvested"] = get_now_ist()

        # 3. Classification
        yield f"data: {json.dumps({'step': 'Detecting category and priority', 'status': 'in_progress'})}\n\n"
        await asyncio.sleep(0.2)
        try:
            classification_v3_res = classifier_v3.predict(text)
            if "error" in classification_v3_res:
                classification = classifier_service.predict(text)
            else:
                cat = classification_v3_res.get("Category", {}).get("prediction", "Unknown")
                sub = classification_v3_res.get("Subcategory", {}).get("prediction", "Unknown")
                pri = classification_v3_res.get("priority", {}).get("prediction", "Medium")
                conf = classification_v3_res.get("Category", {}).get("confidence", 0.0)
                
                from backend.services.classifier_service import TEAM_MAP, AUTO_RESOLVE_SUBS
                assigned_team = TEAM_MAP.get(cat, "General Support")
                auto_resolve = sub in AUTO_RESOLVE_SUBS
                
                classification = {
                    "category": cat,
                    "subcategory": sub,
                    "priority": pri,
                    "auto_resolve": auto_resolve,
                    "assigned_team": assigned_team,
                    "confidence": float(conf)
                }
        except Exception as e:
            classification = {
                "category": "Unknown", "subcategory": "Unknown", "priority": "Medium",
                "auto_resolve": False, "assigned_team": "General Support", "confidence": 0.0,
            }
        timeline["ai_analyzed"] = get_now_ist()
        timeline["triaged"] = get_now_ist()

        # 4. Duplicates
        yield f"data: {json.dumps({'step': 'Checking duplicate issues', 'status': 'in_progress'})}\n\n"
        await asyncio.sleep(0.2)
        try:
            dup_result = duplicate_service.check_duplicate(text, threshold=duplicate_sensitivity)
        except Exception:
            dup_result = {"is_duplicate": False, "duplicate_ticket_id": None, "similarity": 0.0}

        # 5. RAG / Solutions
        yield f"data: {json.dumps({'step': 'Finding possible solutions', 'status': 'in_progress'})}\n\n"
        await asyncio.sleep(0.2)
        rag_suggestions = []
        rag_recommendations = []
        rag_match = None
        try:
            rag_res = rag_service.search_enhanced(text, threshold=0.65, match_count=5, company_id=request_body.company)
            rag_match = rag_res.get("best_match")
            if rag_match:
                classification["auto_resolve"] = True
                classification["assigned_team"] = "Auto-Resolve AI"
                classification["confidence"] = max(classification["confidence"], float(rag_match["confidence"]))
            rag_suggestions = rag_res.get("suggestions") or []
            rag_recommendations = rag_res.get("recommendations") or []
        except Exception as e:
            pass

        decision_factors = []
        if classification["confidence"] > confidence_threshold:
            decision_factors.append(f"High confidence match for '{classification['subcategory']}'")
        if entities:
            decision_factors.append(f"Detected entities: {', '.join([e['text'] for e in entities[:2]])}")
        if dup_result["is_duplicate"]:
            decision_factors.append(f"Found similar incident ({int(dup_result['similarity']*100)}%)")
        if rag_match:
            decision_factors.append(f"Found solution article: '{rag_match['title']}'")

        if not enable_auto_resolve:
            classification["auto_resolve"] = False
        reasoning = f"Categorized as '{classification['category']}' - {classification['subcategory']}."
        if classification["auto_resolve"]:
            reasoning += " Flagged for AI auto-resolution via Knowledge Base." if rag_match else " Flagged for auto-resolution."
        
        timeline["routed"] = get_now_ist()

        if gemini_service and gemini_service._initialized:
            summary = gemini_service.get_summary(text)
        
        hours_map = {"Critical": 2, "High": 8, "Medium": 24, "Low": 72}
        sla_hours = hours_map.get(classification["priority"], 72)
        sla_breach_dt = datetime.datetime.utcnow() + datetime.timedelta(hours=sla_hours)

        ticket_response_dict = {
            "ticket_id": str(uuid.uuid4()),
            "summary": summary,
            "category": classification["category"],
            "subcategory": classification["subcategory"],
            "priority": classification["priority"],
            "auto_resolve": classification["auto_resolve"],
            "assigned_team": classification["assigned_team"],
            "entities": [e for e in entities],
            "duplicate_ticket": dup_result,
            "confidence": classification["confidence"],
            "needs_review": classification["confidence"] < confidence_threshold,
            "reasoning": reasoning,
            "decision_factors": decision_factors,
            "image_description": gemini_analysis["image_description"],
            "ocr_text": gemini_analysis["ocr_text"],
            "image_url": request_body.image_url,
            "highlights": entities,
            "timeline": timeline,
            "env_metadata": env_metadata,
            "sla_breach_at": sla_breach_dt.isoformat() + "Z",
            "rag_suggestions": rag_suggestions,
            "rag_recommendations": rag_recommendations
        }

        # 6. Final Result
        yield f"data: {json.dumps({'step': 'done', 'result': jsonable_encoder(ticket_response_dict)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.post("/analyze_ticket/legacy")
async def legacy_analyze_and_save(request_body: TicketRequest, user: dict = Depends(get_current_user)):
    """
    BACKWARD COMPATIBILITY: Strictly performs analysis only. 
    Does NOT persist to DB to avoid foreign key violations.
    """
    return await analyze_only(request_body)

@router.post("/analyze-v2")
async def analyze_ticket_v2(request: TicketRequest, user: dict = Depends(get_current_user)):
    """Run the legacy V2 classifier and return its prediction payload."""
    text = request.text
    try:
        prediction = classifier_v2.predict(text)
        return {
            "status": "success",
            "category": prediction["category"]["prediction"],
            "subcategory": prediction["sub_category"]["prediction"],
            "priority": prediction["priority"]["prediction"],
            "auto_resolve": prediction["auto_resolve"]["prediction"].lower() == "true",
            "assigned_team": prediction["assigned_team"]["prediction"],
            "confidence": prediction["category"]["confidence"]
        }
    except Exception as e:
        logger.error("AI ticket analysis failed", exc_info=e)
        raise HTTPException(status_code=500, detail="Ticket analysis failed. Please try again later.")

