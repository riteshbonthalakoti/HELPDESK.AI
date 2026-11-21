"""
Rule-Based Classification Engine
Provides deterministic, high-precision classifications for well-defined ticket
patterns using regex rules and weighted keyword matching.
Serves as the last model in the ensemble to add domain-expert signals.
"""

import re
import logging
import numpy as np

# Label list — kept in sync with tfidf_model.DEFAULT_LABELS to avoid circular imports
DEFAULT_LABELS = [
    "Access | Password Reset", "Access | Login Failure", "Access | Access Request",
    "Access | Permission Issue", "Access | MFA Problem", "Access | Account Expired",
    "Access | Role Change", "Access | Account Unlock",
    "Software | Software Install", "Software | Data Loss", "Software | Application Crash",
    "Software | Update Problem", "Software | Compatibility", "Software | Configuration",
    "Software | License Issue", "Software | Performance",
    "Hardware | Overheating", "Hardware | Hardware Failure", "Hardware | Keyboard/Mouse",
    "Hardware | Laptop Issue", "Hardware | Battery Issue", "Hardware | Blue Screen",
    "Hardware | Monitor Problem", "Hardware | Printer Error",
    "Network | DNS Problem", "Network | Internet Slow", "Network | Remote Access",
    "Network | VPN Connection", "Network | WiFi Issue", "Network | Firewall Block",
    "Network | Proxy Error", "Network | Network Drive",
]

logger = logging.getLogger(__name__)

# Each rule: (pattern, label, confidence_boost)
# Higher confidence_boost = stronger signal
RULES = [
    # ─── Access ───────────────────────────────────────────────────
    (r"\b(forgot|reset|change)\s+(my\s+)?password\b", "Access | Password Reset", 0.95),
    (r"\bpassword\s+(expired|reset|forgot|lost)\b", "Access | Password Reset", 0.92),
    (r"\b(can[' ]?t|unable to|fail(ed)?)\s+(to\s+)?(sign\s+in|log\s+in|login)\b", "Access | Login Failure", 0.93),
    (r"\baccount\s+(locked|suspended|disabled)\b", "Access | Account Unlock", 0.94),
    (r"\b(2fa|mfa|multi.?factor|authenticator|otp|one.?time.?pass)\b", "Access | MFA Problem", 0.92),
    (r"\b(access\s+denied|unauthorized|permission\s+denied|not\s+authorized|forbidden)\b", "Access | Permission Issue", 0.93),
    (r"\baccount\s+(expired|expir)\b", "Access | Account Expired", 0.91),
    (r"\b(request|need|grant|require)\s+access\b", "Access | Access Request", 0.87),
    (r"\b(role\s+change|role\s+update|change\s+(my\s+)?role|new\s+role)\b", "Access | Role Change", 0.89),

    # ─── Software ─────────────────────────────────────────────────
    (r"\b(blue\s+screen|bsod|kernel\s+panic)\b", "Hardware | Blue Screen", 0.98),
    (r"\b(application|app|software)\s+(crash(ed|ing)?|not\s+responding|freeze)\b", "Software | Application Crash", 0.94),
    (r"\b(install|installation|set\s*up)\s+(software|application|program)\b", "Software | Software Install", 0.91),
    (r"\b(update|upgrade|patch)\s+(fail(ed)?|error|problem|issue)\b", "Software | Update Problem", 0.90),
    (r"\b(license|activation|product\s+key)\s+(expir|invalid|error|fail)\b", "Software | License Issue", 0.93),
    (r"\b(data\s+loss|lost\s+data|missing\s+files?|corrupt(ed)?\s+(file|data))\b", "Software | Data Loss", 0.95),
    (r"\b(performance|slow|lag|freeze|high\s+cpu|memory\s+leak)\b", "Software | Performance", 0.85),
    (r"\b(config(uration)?|settings?)\s+(error|issue|problem|wrong|incorrect)\b", "Software | Configuration", 0.88),
    (r"\bcompatib(le|ility)\s+(issue|problem|error)\b", "Software | Compatibility", 0.89),

    # ─── Hardware ─────────────────────────────────────────────────
    (r"\b(overheat(ing)?|running\s+hot|fan\s+noise|cooling\s+problem)\b", "Hardware | Overheating", 0.95),
    (r"\b(hardware\s+fail|device\s+fail|component\s+fail|broken\s+hardware)\b", "Hardware | Hardware Failure", 0.93),
    (r"\b(keyboard|mouse|trackpad|touchpad)\s+(not\s+working|broken|fail|issue)\b", "Hardware | Keyboard/Mouse", 0.92),
    (r"\b(monitor|display|screen)\s+(blank|black|flickering|not\s+working)\b", "Hardware | Monitor Problem", 0.92),
    (r"\b(printer|scanner|print\s+queue)\s+(error|fail|jam|not\s+working)\b", "Hardware | Printer Error", 0.92),
    (r"\b(battery|charging)\s+(drain|not\s+charging|issue|fail|dead)\b", "Hardware | Battery Issue", 0.91),
    (r"\b(laptop|notebook)\s+(issue|problem|fail|broken)\b", "Hardware | Laptop Issue", 0.87),

    # ─── Network ──────────────────────────────────────────────────
    (r"\b(dns|domain\s+name\s+resolution|cannot\s+resolve)\b", "Network | DNS Problem", 0.94),
    (r"\b(internet\s+slow|slow\s+internet|bandwidth|speed\s+issue|high\s+latency)\b", "Network | Internet Slow", 0.92),
    (r"\b(vpn|virtual\s+private\s+network|tunnel|vpn\s+connect)\b", "Network | VPN Connection", 0.94),
    (r"\b(wifi|wi-fi|wireless)\s+(issue|problem|disconnecting|not\s+connect)\b", "Network | WiFi Issue", 0.92),
    (r"\b(firewall|port\s+blocked|traffic\s+blocked)\b", "Network | Firewall Block", 0.93),
    (r"\b(remote\s+desktop|rdp|teamviewer|anydesk|remote\s+access)\b", "Network | Remote Access", 0.92),
    (r"\b(proxy|proxy\s+server)\s+(error|fail|issue)\b", "Network | Proxy Error", 0.91),
    (r"\b(network\s+drive|mapped\s+drive|shared\s+drive|nas)\b", "Network | Network Drive", 0.90),
]


class RuleBasedEngine:
    """
    Deterministic rule engine that scans ticket text with regex patterns and
    returns a soft probability vector for ensemble combination.

    Design: matched rules add confidence mass to their target label.
    Unmatched labels receive a tiny base probability to avoid zero-mass issues.
    """

    def __init__(self):
        self.rules = RULES
        self.labels = list(DEFAULT_LABELS)
        logger.info(f"[Rules] Engine initialized with {len(self.rules)} rules.")

    def predict_proba(self, text: str) -> np.ndarray:
        """
        Return a probability array in DEFAULT_LABELS order.
        Multiple matching rules accumulate weight additively.
        """
        lower = text.lower()
        scores = np.ones(len(self.labels)) * 0.001  # base mass

        matched_any = False
        for pattern, label, boost in self.rules:
            if re.search(pattern, lower, re.IGNORECASE):
                if label in self.labels:
                    idx = self.labels.index(label)
                    scores[idx] += boost
                    matched_any = True

        # If no rules matched, return a uniform distribution
        if not matched_any:
            return np.ones(len(self.labels)) / len(self.labels)

        # Normalize to probabilities
        total = scores.sum()
        return scores / total

    def predict(self, text: str) -> dict:
        """Return top label, confidence score and full probability vector."""
        proba = self.predict_proba(text)
        best_idx = int(np.argmax(proba))
        return {
            "label": self.labels[best_idx],
            "confidence": float(proba[best_idx]),
            "probabilities": proba,
        }

    def get_matched_rules(self, text: str) -> list[str]:
        """Return list of matched rule patterns for explainability."""
        lower = text.lower()
        matched = []
        for pattern, label, _ in self.rules:
            if re.search(pattern, lower, re.IGNORECASE):
                matched.append(f"{label} (pattern: '{pattern}')")
        return matched


# Singleton
rule_engine = RuleBasedEngine()


# ─── LLM Policy Guardrail Engine (#4192) ───────────────────────────

class PolicyViolationError(Exception):
    """Raised when an LLM response or user prompt violates organizational policy."""
    def __init__(self, rule_name: str, message: str, details: dict = None):
        super().__init__(message)
        self.rule_name = rule_name
        self.message = message
        self.details = details or {}


class PolicyGuardrailEngine:
    """
    Deterministic LLM Behavioral Guardrails and Policy Enforcement Engine.
    Ensures LLM responses and drafts satisfy enterprise constraints:
    - Forbidden commitment words (unauthorized refunds, SLAs, legal promises)
    - Financial limits / Max credit caps
    - URL domain whitelisting (preventing internal infra leaks)
    - Prompt injection detection (direct & indirect jailbreak attempts)
    - PII scrubbing enforcement
    - Confidence threshold evaluation (<0.85 triggers human escalation)
    """

    DEFAULT_ALLOWED_DOMAINS = [
        "helpdesk.ai",
        "docs.helpdesk.ai",
        "support.helpdesk.ai",
        "status.helpdesk.ai",
        "github.com",
    ]

    # Forbidden commitments that AI cannot guarantee without human manager approval
    FORBIDDEN_COMMITMENT_PATTERNS = [
        (r"\b(promise|guarantee|assure)\s+(you\s+)?(a\s+)?refund\b", "unauthorized_refund_commitment"),
        (r"\b(will|shall)\s+(fully\s+)?refund\b", "unauthorized_refund_commitment"),
        (r"\b(100%|full)\s+money[- ]back\s+guarantee\b", "unauthorized_guarantee"),
        (r"\bguarantee\s+(\d+\s*(hour|minute|day)|zero[- ]downtime|100%\s*uptime)\b", "unauthorized_sla_commitment"),
        (r"\bwaive\s+(all\s+)?(fees?|charges?|penalt(y|ies))\b", "unauthorized_fee_waiver"),
        (r"\bwe\s+will\s+compensate\s+you\b", "unauthorized_compensation_promise"),
        (r"\bour\s+liability\s+is\s+unlimited\b", "unauthorized_legal_admission"),
    ]

    # Prompt injection patterns
    PROMPT_INJECTION_PATTERNS = [
        (r"ignore\s+(all\s+)?previous\s+(instructions|prompts|directions)", "jailbreak_ignore_instructions"),
        (r"system\s*:\s*you\s+are\s+now", "system_prompt_override"),
        (r"reveal\s+(your\s+)?(system\s+prompt|internal\s+instructions|secret\s+key)", "prompt_leakage_attempt"),
        (r"bypass\s+(all\s+)?(filters|guardrails|safety\s+checks)", "safety_bypass_attempt"),
        (r"you\s+are\s+in\s+developer\s+mode", "dan_developer_mode_jailbreak"),
    ]

    def __init__(
        self,
        allowed_domains: list[str] | None = None,
        max_credit_limit: float = 50.0,
        confidence_threshold: float = 0.85,
    ):
        self.allowed_domains = allowed_domains or list(self.DEFAULT_ALLOWED_DOMAINS)
        self.max_credit_limit = max_credit_limit
        self.confidence_threshold = confidence_threshold

    def check_prompt_injection(self, text: str) -> dict:
        """Scan input text for adversarial prompt injection / jailbreak markers."""
        if not text:
            return {"is_injection": False, "violations": []}

        violations = []
        for pattern, rule_name in self.PROMPT_INJECTION_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                violations.append({
                    "rule": rule_name,
                    "matched_text": match.group(0),
                })

        return {
            "is_injection": len(violations) > 0,
            "violations": violations,
        }

    def check_forbidden_commitments(self, text: str) -> list[dict]:
        """Detect unauthorized promises, refunds, SLA guarantees, or fee waivers."""
        violations = []
        for pattern, rule_name in self.FORBIDDEN_COMMITMENT_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                violations.append({
                    "rule": rule_name,
                    "matched_text": match.group(0),
                })
        return violations

    def check_credit_limit(self, text: str) -> list[dict]:
        """Verify that any proposed dollar credit / reimbursement is <= max_credit_limit."""
        violations = []
        # Match dollar expressions like "$100", "$ 250.50", "100 dollars", "credit of $75"
        dollar_matches = re.finditer(r"\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:dollars|usd)", text, re.IGNORECASE)
        for m in dollar_matches:
            val_str = m.group(1) or m.group(2)
            try:
                val = float(val_str)
                if val > self.max_credit_limit:
                    violations.append({
                        "rule": "credit_limit_exceeded",
                        "matched_amount": val,
                        "max_allowed": self.max_credit_limit,
                        "matched_text": m.group(0),
                    })
            except ValueError:
                pass
        return violations

    def check_url_whitelisting(self, text: str) -> list[dict]:
        """Ensure all URLs in text point to approved domains, blocking internal infra leakage."""
        violations = []
        url_matches = re.finditer(r"https?://([a-zA-Z0-9\.\-]+)(?::\d+)?(?:/[^\s]*)?", text, re.IGNORECASE)
        for m in url_matches:
            domain = m.group(1).lower()
            # Check if domain matches or is a subdomain of any allowed domain
            is_allowed = any(
                domain == allowed or domain.endswith("." + allowed)
                for allowed in self.allowed_domains
            )
            if not is_allowed:
                violations.append({
                    "rule": "unauthorized_url_domain",
                    "domain": domain,
                    "full_url": m.group(0),
                })
        return violations

    def validate_response(
        self,
        text: str,
        confidence: float = 1.0,
        auto_redact_pii: bool = True,
    ) -> dict:
        """
        Validate an automated LLM output against all deterministic policy rules.

        Returns structured report:
        {
            "passed": bool,
            "sanitized_text": str,
            "violations": list[dict],
            "action": "allow" | "pending_human" | "block",
            "escalation_reason": str | None
        }
        """
        from backend.services.pii_redactor import redact_pii

        violations = []

        # 1. Prompt injection check
        inj_res = self.check_prompt_injection(text)
        if inj_res["is_injection"]:
            violations.extend(inj_res["violations"])

        # 2. Forbidden commitments check
        violations.extend(self.check_forbidden_commitments(text))

        # 3. Credit limit check
        violations.extend(self.check_credit_limit(text))

        # 4. URL allowlist check
        violations.extend(self.check_url_whitelisting(text))

        # 5. PII sanitization pass
        sanitized_text = redact_pii(text) if auto_redact_pii else text

        # 6. Confidence threshold evaluation
        low_confidence = confidence < self.confidence_threshold
        if low_confidence:
            violations.append({
                "rule": "low_confidence_threshold",
                "confidence": confidence,
                "threshold": self.confidence_threshold,
            })

        passed = len(violations) == 0
        action = "allow"
        escalation_reason = None

        if not passed:
            action = "pending_human"
            escalation_reason = f"Policy violations detected: {', '.join(v['rule'] for v in violations)}"

        return {
            "passed": passed,
            "sanitized_text": sanitized_text,
            "violations": violations,
            "action": action,
            "escalation_reason": escalation_reason,
        }

    def record_audit_log(
        self,
        ticket_id: str,
        company_id: str,
        validation_result: dict,
        supabase_client=None,
    ) -> dict:
        """
        Log policy violation audit record in audit_logs.
        """
        audit_entry = {
            "ticket_id": ticket_id,
            "company_id": company_id,
            "action": "policy_guardrail_evaluation",
            "status": "pending_human" if not validation_result["passed"] else "passed",
            "performed_by": "system:policy_guardrail_engine",
            "old_value": {"status": "analyzing"},
            "new_value": {
                "action": validation_result["action"],
                "violations": validation_result["violations"],
                "passed": validation_result["passed"],
            },
        }

        if supabase_client:
            try:
                supabase_client.table("audit_logs").insert(audit_entry).execute()
            except Exception as e:
                logger.error(f"[PolicyGuardrailEngine] Failed to write audit_log: {e}")

        return audit_entry


policy_guardrail_engine = PolicyGuardrailEngine()
