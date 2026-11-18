"""Unit tests for the verified email-change system (template, service, and router)."""

import hashlib
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

os.environ.setdefault("ALLOW_DEGRADED_STARTUP", "true")

import pytest

from backend.routers.email_change import (
    EmailChangeRequestBody,
    EmailChangeVerifyBody,
    _normalize_email,
    _sha256_hex,
    request_email_change,
    verify_email_change,
)
from backend.services.email_service import (
    EmailChangeEmailContext,
    EmailDeliveryResult,
    EmailService,
)


def test_email_change_template_renders_brand_otp_and_link():
    svc = EmailService(provider="disabled", from_email="noreply@helpdesk.ai")
    subject, html, text = svc.build_email_change_email(
        EmailChangeEmailContext(
            recipient_email="new.ritesh@gmail.com",
            old_email="old.ritesh@gmail.com",
            otp_code="482910",
            verification_url="https://app.helpdesk.ai/verify-email-change?token=abc123xyz",
            recipient_name="Ritesh",
            company_name="RITESH PVT LTD",
            account_role="Company Admin",
            expires_minutes=30,
        )
    )

    assert "482910" in subject
    assert "RITESH PVT LTD" in html
    assert "old.ritesh@gmail.com" in html
    assert "new.ritesh@gmail.com" in html
    assert "482910" in html
    assert "https://app.helpdesk.ai/verify-email-change?token=abc123xyz" in html
    assert "482910" in text
    assert "new.ritesh@gmail.com" in text


def test_normalize_email_validates_syntax():
    assert _normalize_email("  Admin.User@Gmail.COM ") == "admin.user@gmail.com"
    with pytest.raises(Exception):
        _normalize_email("not-an-email")


@pytest.mark.asyncio
async def test_request_and_verify_email_change_token_flow():
    captured_inserts = []
    updated_profiles = []
    auth_updates = []

    class FakeQuery:
        def __init__(self, table_name):
            self.table_name = table_name
            self._op = "select"
            self._payload = None
            self._filters = {}

        def select(self, *_):
            self._op = "select"
            return self

        def insert(self, payload):
            self._op = "insert"
            self._payload = payload
            return self

        def update(self, payload):
            self._op = "update"
            self._payload = payload
            return self

        def eq(self, col, val):
            self._filters[col] = val
            return self

        def ilike(self, col, val):
            self._filters[col] = val
            return self

        def gt(self, col, val):
            self._filters[col] = val
            return self

        def order(self, *_args, **_kwargs):
            return self

        def limit(self, *_):
            return self

        def execute(self):
            res = MagicMock()
            if self.table_name == "profiles" and self._op == "select":
                if "id" in self._filters:
                    res.data = [
                        {
                            "id": "user-1",
                            "email": "old@gmail.com",
                            "full_name": "Ritesh",
                            "role": "admin",
                            "company": "RITESH PVT LTD",
                            "company_id": "76d16bf6-2ee9-44ad-b64e-ad5ecf0a079b",
                        }
                    ]
                else:
                    res.data = []
                return res
            if self.table_name == "profiles" and self._op == "update":
                updated_profiles.append((self._filters.get("id"), self._payload))
                res.data = [self._payload]
                return res
            if self.table_name == "email_change_requests" and self._op == "insert":
                row = {"id": "req-1", **self._payload}
                captured_inserts.append(row)
                res.data = [row]
                return res
            if self.table_name == "email_change_requests" and self._op == "select":
                res.data = [
                    r
                    for r in captured_inserts
                    if r.get("status") == "pending"
                    and (
                        self._filters.get("token_hash") is None
                        or r.get("token_hash") == self._filters.get("token_hash")
                    )
                ]
                return res
            res.data = []
            return res

    fake_sb = MagicMock()
    fake_sb.table.side_effect = lambda name: FakeQuery(name)
    fake_sb.auth.admin.update_user_by_id.side_effect = lambda uid, attrs: auth_updates.append((uid, attrs))

    fake_request = MagicMock()
    fake_request.headers = {"origin": "https://helpdesk.ritesh.app"}

    sent_contexts = []

    def fake_send(_self, ctx):
        sent_contexts.append(ctx)
        return EmailDeliveryResult(sent=True, provider="smtp")

    with patch("backend.routers.email_change.supabase", fake_sb), patch.object(
        EmailService, "send_email_change_verification", fake_send
    ):
        resp = await request_email_change(
            EmailChangeRequestBody(new_email="new.admin@gmail.com"),
            fake_request,
            current_user={"id": "user-1", "email": "old@gmail.com"},
        )
        assert resp["status"] == "verification_sent"
        assert resp["new_email"] == "new.admin@gmail.com"
        assert len(sent_contexts) == 1
        ctx = sent_contexts[0]
        raw_token = ctx.verification_url.split("token=")[1]
        assert captured_inserts[0]["token_hash"] == _sha256_hex(raw_token)

        verify_resp = await verify_email_change(
            EmailChangeVerifyBody(token=raw_token),
            fake_request,
        )
        assert verify_resp["verified"] is True
        assert verify_resp["new_email"] == "new.admin@gmail.com"
        assert auth_updates == [("user-1", {"email": "new.admin@gmail.com", "email_confirm": True})]
        assert updated_profiles[0][0] == "user-1"
        assert updated_profiles[0][1]["email"] == "new.admin@gmail.com"
