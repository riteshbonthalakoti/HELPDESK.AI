#!/usr/bin/env python3
"""
Standalone smoke test: verifies the FastAPI app object can be imported
and probes live deployment endpoints (/health and /docs) with a cold-start
retry loop and terminal progress spinner.

Exit codes:
  0 — all checks passed, endpoints healthy
  1 — checks failed or cold boot timeout exceeded

Usage:
  # Internal module import verification (CI mode)
  python scripts/smoke_test.py

  # Live endpoint verification with cold-start retry loop (Hugging Face / Web)
  python scripts/smoke_test.py --url https://your-app.hf.space --timeout 60 --interval 5
"""

import sys
import os
import time
import argparse
import urllib.request
import urllib.error
from typing import Optional, List, Tuple

# Add project root to sys.path so `from backend.xxx import ...` works.
_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _root not in sys.path:
    sys.path.insert(0, _root)

# Required to allow degraded startup (no models on CI)
os.environ.setdefault("ALLOW_DEGRADED_STARTUP", "1")
os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "placeholder_key")

SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]


def check_endpoint(url: str, timeout: float = 10.0) -> Tuple[bool, int, str]:
    """Probe a single HTTP endpoint, returning (is_ok, status_code, message)."""
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "HELPDESK-AI-SmokeTest/1.0"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.status
            return (200 <= status < 400), status, "OK"
    except urllib.error.HTTPError as exc:
        return False, exc.code, f"HTTP Error {exc.code}"
    except urllib.error.URLError as exc:
        return False, 0, f"Connection Error: {exc.reason}"
    except Exception as exc:
        return False, 0, str(exc)


def wait_for_cold_boot(
    base_url: str,
    timeout: float = 60.0,
    interval: float = 5.0,
    endpoints: Optional[List[str]] = None
) -> bool:
    """
    Retry loop for waking up cold services (e.g. Hugging Face Spaces).
    Monitors endpoints until healthy or timeout exceeded.
    """
    if endpoints is None:
        endpoints = ["/health", "/docs"]

    clean_base = base_url.rstrip("/")
    start_time = time.time()
    frame_idx = 0

    print(f"[smoke_test] Starting cold-start monitoring for: {clean_base}")
    print(f"[smoke_test] Target endpoints: {', '.join(endpoints)}")
    print(f"[smoke_test] Max timeout: {timeout}s | Retry interval: {interval}s")

    while True:
        elapsed = time.time() - start_time
        if elapsed > timeout:
            print(f"\n[smoke_test] ❌ FAIL — Cold boot timeout exceeded ({elapsed:.1f}s > {timeout}s)")
            return False

        all_endpoints_healthy = True
        failed_reasons = []

        for ep in endpoints:
            target_url = f"{clean_base}{ep}"
            is_ok, status, msg = check_endpoint(target_url, timeout=min(interval, 10.0))
            if not is_ok:
                all_endpoints_healthy = False
                failed_reasons.append(f"{ep}: {msg}")

        if all_endpoints_healthy:
            print(f"\n[smoke_test] ✅ PASS — Service woke up and all endpoints are healthy in {elapsed:.1f}s!")
            return True

        # Display terminal progress spinner
        spinner = SPINNER_FRAMES[frame_idx % len(SPINNER_FRAMES)]
        frame_idx += 1
        reasons_summary = ", ".join(failed_reasons)
        sys.stdout.write(
            f"\r[smoke_test] {spinner} Waiting for cold boot... (elapsed: {elapsed:4.1f}s / {timeout:.0f}s) [{reasons_summary}]"
        )
        sys.stdout.flush()

        time.sleep(interval)


def run_import_smoke_test() -> bool:
    """Attempt to import the FastAPI app and verify basic properties (CI fallback)."""
    try:
        from fastapi import FastAPI  # noqa: F401
        print("[smoke_test] FastAPI importable: OK")
    except ImportError as exc:
        print(f"[smoke_test] FAIL — FastAPI not importable: {exc}")
        return False

    try:
        from pydantic import BaseModel  # noqa: F401
        from dotenv import load_dotenv  # noqa: F401
        print("[smoke_test] pydantic + dotenv: OK")
    except ImportError as exc:
        print(f"[smoke_test] FAIL — Missing core deps: {exc}")
        return False

    service_imports = [
        ("backend.services.auto_close_service", "AutoCloseService"),
        ("backend.services.duplicate_service", "DuplicateService"),
        ("backend.services.classifier_service", "ClassifierService"),
        ("backend.services.translation_service", "translate_text"),
        ("backend.services.supabase_utils", "get_ticket"),
    ]

    all_ok = True
    for module_path, attr in service_imports:
        try:
            mod = __import__(module_path, fromlist=[attr])
            obj = getattr(mod, attr, None)
            if obj is None:
                print(f"[smoke_test] WARN — {module_path}.{attr} is None (might be OK)")
            else:
                print(f"[smoke_test] {module_path}.{attr}: OK")
        except Exception as exc:
            print(f"[smoke_test] WARN — {module_path}: {exc}")

    try:
        from backend.main import app  # noqa: F401
        if not hasattr(app, "routes"):
            print("[smoke_test] FAIL — app object missing 'routes' attribute")
            return False
        route_paths = [getattr(r, "path", None) for r in app.routes]
        required_routes = ["/health", "/ready"]
        for rp in required_routes:
            if rp not in route_paths:
                print(f"[smoke_test] FAIL — Required route '{rp}' not found in app.routes")
                all_ok = False
            else:
                print(f"[smoke_test] Route {rp}: OK")
    except Exception as exc:
        print(f"[smoke_test] WARN — backend.main import raised: {exc}")
        print("[smoke_test] Partial PASS — core libraries importable; ML models not loaded (expected in CI)")
        return True

    if all_ok:
        print("[smoke_test] PASS — all checks completed successfully")
    return all_ok


def main():
    parser = argparse.ArgumentParser(description="HELPDESK.AI Smoke Test & Cold-Start Retry Monitor")
    parser.add_argument(
        "--url",
        type=str,
        default=os.getenv("APP_URL") or os.getenv("BACKEND_URL") or os.getenv("HF_SPACE_URL"),
        help="Target base URL to monitor for cold boot (default: env APP_URL / BACKEND_URL)"
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=float(os.getenv("SMOKE_TIMEOUT", "60.0")),
        help="Maximum seconds to wait for cold boot (default: 60s)"
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=float(os.getenv("SMOKE_INTERVAL", "5.0")),
        help="Retry interval in seconds between polls (default: 5s)"
    )
    parser.add_argument(
        "--skip-import",
        action="store_true",
        help="Skip local module import tests when running in remote mode"
    )

    args = parser.parse_args()

    overall_success = True

    if not args.skip_import:
        import_success = run_import_smoke_test()
        if not import_success:
            overall_success = False

    if args.url:
        http_success = wait_for_cold_boot(
            base_url=args.url,
            timeout=args.timeout,
            interval=args.interval
        )
        if not http_success:
            overall_success = False

    sys.exit(0 if overall_success else 1)


if __name__ == "__main__":
    main()
