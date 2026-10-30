#!/usr/bin/env python3
"""
Lightweight FastAPI E2E Runner for Cypress CI & Local E2E Suites.

Starts `backend.main:app` against the local stateful Supabase emulator in
degraded-ML mode (when heavy PyTorch/Transformer weights are absent in CI),
providing deterministic heuristic classification and entity extraction for
end-to-end tests.
"""

import importlib.machinery
import importlib.util
import os
import re
import sys
import types
from unittest.mock import MagicMock

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

os.environ.setdefault("ALLOW_DEGRADED_STARTUP", "1")
os.environ.setdefault("SUPABASE_URL", "http://127.0.0.1:54321")
os.environ.setdefault(
    "SUPABASE_SERVICE_KEY",
    "e2e-header.e2e-payload.e2e-signature",
)
os.environ.setdefault("ENV", "development")


def _make_stub_module(name: str) -> MagicMock:
    stub = MagicMock(name=name)
    stub.__spec__ = importlib.machinery.ModuleSpec(name, loader=None)
    stub.__path__ = []
    return stub


def _install_optional_ml_stubs() -> None:
    """Stub heavy optional ML libraries when running in lightweight CI."""
    if importlib.util.find_spec("torch") is None:
        torch_mod = types.ModuleType("torch")
        torch_mod.__spec__ = importlib.machinery.ModuleSpec("torch", loader=None)
        torch_mod.__path__ = []
        torch_mod.cuda = types.SimpleNamespace(is_available=lambda: False)
        torch_mod.device = lambda name="cpu": name
        torch_mod.no_grad = MagicMock()

        nn_mod = types.ModuleType("torch.nn")
        nn_mod.__spec__ = importlib.machinery.ModuleSpec("torch.nn", loader=None)

        class _BaseModule:
            def __init__(self, *args, **kwargs):
                pass

        nn_mod.Module = _BaseModule
        nn_mod.ModuleDict = dict
        nn_mod.Linear = MagicMock()
        nn_mod.Dropout = MagicMock()
        nn_mod.ReLU = MagicMock()
        nn_mod.Sequential = MagicMock()

        fn_mod = types.ModuleType("torch.nn.functional")
        fn_mod.__spec__ = importlib.machinery.ModuleSpec("torch.nn.functional", loader=None)
        fn_mod.softmax = MagicMock()
        optim_mod = types.ModuleType("torch.optim")
        optim_mod.__spec__ = importlib.machinery.ModuleSpec("torch.optim", loader=None)

        torch_mod.nn = nn_mod
        sys.modules["torch"] = torch_mod
        sys.modules["torch.nn"] = nn_mod
        sys.modules["torch.nn.functional"] = fn_mod
        sys.modules["torch.optim"] = optim_mod

    optional_pkgs = [
        "transformers",
        "sentence_transformers",
        "easyocr",
        "datasets",
        "sklearn",
        "sklearn.metrics",
        "pandas",
        "openpyxl",
        "prometheus_client",
        "google.genai",
        "google.generativeai",
        "PIL",
    ]
    missing_roots = set()
    for pkg in optional_pkgs:
        root_pkg = pkg.split(".")[0]
        if root_pkg not in sys.modules and importlib.util.find_spec(root_pkg) is None:
            missing_roots.add(root_pkg)

    for pkg in optional_pkgs:
        root_pkg = pkg.split(".")[0]
        if root_pkg in missing_roots and pkg not in sys.modules:
            if root_pkg not in sys.modules:
                sys.modules[root_pkg] = _make_stub_module(root_pkg)
            if pkg not in sys.modules:
                sys.modules[pkg] = _make_stub_module(pkg)


def _heuristic_classify(text: str) -> dict:
    lower = (text or "").lower()
    if any(k in lower for k in ("vpn", "wifi", "network", "firewall", "dns", "latency", "gateway")):
        return {
            "category": "Network",
            "subcategory": "VPN Connection",
            "priority": "High",
            "auto_resolve": False,
            "assigned_team": "Network Support",
            "confidence": 0.93,
        }
    if any(k in lower for k in ("login", "auth", "mfa", "permission", "access", "account", "sso")):
        return {
            "category": "Access",
            "subcategory": "Login Failure",
            "priority": "High",
            "auto_resolve": False,
            "assigned_team": "IAM Team",
            "confidence": 0.91,
        }
    if any(k in lower for k in ("laptop", "printer", "monitor", "battery", "hardware", "screen")):
        return {
            "category": "Hardware",
            "subcategory": "Hardware Failure",
            "priority": "High",
            "auto_resolve": False,
            "assigned_team": "Hardware Support",
            "confidence": 0.89,
        }
    return {
        "category": "Software",
        "subcategory": "Application Crash",
        "priority": "High",
        "auto_resolve": False,
        "assigned_team": "Application Support",
        "confidence": 0.90,
    }


def _heuristic_entities(text: str) -> list[dict]:
    patterns = {
        "IP_ADDRESS": r"\b(?:\d{1,3}\.){3}\d{1,3}\b",
        "HOSTNAME": r"\b(?:srv|db|app|web|dev|prod|fw)-[\w\d-]+\b",
        "NETWORK_ERROR": r"\b(?:VPN|Timeout|Connection failed|500|TLS)\b",
    }
    found = []
    for label, pattern in patterns.items():
        for match in re.finditer(pattern, text or "", flags=re.IGNORECASE):
            found.append(
                {
                    "text": match.group(0),
                    "label": label,
                    "confidence": 0.95,
                }
            )
    return found[:5]


def build_app():
    _install_optional_ml_stubs()

    import backend.main as backend_main

    # Disable IP rate-limiting during automated E2E runs so back-to-back specs never 429
    if hasattr(backend_main, "limiter"):
        backend_main.limiter.enabled = False

    # Provide deterministic fallback inference when local .pt weights are absent in CI
    orig_load = backend_main.classifier_service.load

    def _safe_classifier_load():
        try:
            orig_load()
        except Exception:
            backend_main.classifier_service._loaded = False

    backend_main.classifier_service.load = _safe_classifier_load

    if not getattr(backend_main.classifier_service, "_loaded", False):
        backend_main.classifier_v3.predict = lambda _text: {"error": "E2E heuristic fallback"}
        backend_main.classifier_service.predict = _heuristic_classify
        backend_main.ner_service.extract_entities = _heuristic_entities
        backend_main.duplicate_service.check_duplicate = lambda _text, threshold=0.85: {
            "is_duplicate": False,
            "duplicate_ticket_id": None,
            "similarity": 0.0,
        }
        backend_main.duplicate_service.add_ticket = lambda *_a, **_kw: None
        backend_main.rag_service.load = lambda: None

    return backend_main.app


def main() -> None:
    import uvicorn

    app = build_app()
    host = os.environ.get("BACKEND_HOST", "127.0.0.1")
    port = int(os.environ.get("BACKEND_PORT", "8000"))
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
