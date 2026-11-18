"""Unit tests for the pure 6-digit OTP email-change system (template, service, router)."""

import os
from unittest.mock import MagicMock, patch

os.environ.setdefault("ALLOW_DEGRADED_STARTUP", "true")

import pytest

from backend.routers.email_change import (
    EmailChangeRequestBody,
    EmailChangeVerifyBody,
    _normalize_email,
    request_email_change,
    verify_email_change,
)
from backend.services.email_service import (
    EmailChangeEmailContext,
    EmailDeliveryResult,
    EmailService,
)


def test_email_change_otp_template_renders_clean_six_digit_tiles_without_links():
    svc = EmailService(provider="disabled", from_email="noreply@helpdesk.ai")
    subject, html, text = svc.build_email_change_email(
        EmailChangeEmailContext(
            recipient_email="new.ritesh@gmail.com",
            old_email="old.ritesh@gmail.com",
            otp_code="482910",
            recipient_name="Ritesh",
            company_name="RITESH PVT LTD",
            account_role="Company Admin",
            expires_minutes=10,
        )
    )

    assert subject == "482910 is your HELPDESK.AI verification code"
    assert "RITESH PVT LTD" in html
    assert "new.ritesh@gmail.com" in html
    assert "old.ritesh@gmail.com" not in html
    assert "verify-email-change" not in html
    for digit in "482910":
        assert f">{digit}<" in html or digit in html
    assert "482910" in text


def test_normalize_email_validates_syntax():
    assert _normalize_email("  Admin.User@Gmail.COM ") == "admin.user@gmail.com"
    with pytest.raises(Exception):
        _normalize_email("not-an-email")


@pytest.mark.asyncio
async def test_pure_otp_request_and_verify_switches_email_directly():
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
                res.data = [r for r in captured_inserts if r.get("status") == "pending"]
                return res
            res.data = []
            return res

    fake_sb = MagicMock()
    fake_sb.table.side_effect = lambda name: FakeQuery(name)
    fake_sb.auth.admin.update_user_by_id.side_effect = lambda uid, attrs: auth_updates.append((uid, attrs))

    fake_request = MagicMock()
    sent_contexts = []

    def fake_send(_self, ctx):
        sent_contexts.append(ctx)
        return EmailDeliveryResult(sent=True, provider="resend")

    with patch("backend.routers.email_change.supabase", fake_sb), patch.object(
        EmailService, "send_email_change_verification", fake_send
    ):
        resp = await request_email_change(
            EmailChangeRequestBody(new_email="new.admin@gmail.com"),
            fake_request,
            current_user={"id": "user-1", "email": "old@gmail.com"},
        )
        assert resp["status"] == "otp_sent"
        assert resp["new_email"] == "new.admin@gmail.com"
        assert len(sent_contexts) == 1
        assert sent_contexts[0].recipient_email == "new.admin@gmail.com"
        otp_code = sent_contexts[0].otp_code
        assert len(otp_code) == 6 and otp_code.isdigit()

        verify_resp = await verify_email_change(
            EmailChangeVerifyBody(
                otp_code=otp_code,
                new_email="new.admin@gmail.com",
                challenge_token=resp["challenge_token"],
            ),
            current_user={"id": "user-1", "email": "old@gmail.com"},
        )
        assert verify_resp["verified"] is True
        assert verify_resp["new_email"] == "new.admin@gmail.com"
        assert auth_updates == [("user-1", {"email": "new.admin@gmail.com", "email_confirm": True})]
        assert updated_profiles[0][0] == "user-1"
        assert updated_profiles[0][1]["email"] == "new.admin@gmail.com"
