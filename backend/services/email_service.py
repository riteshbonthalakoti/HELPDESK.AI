"""
Transactional email service for ticket lifecycle notifications.

The service is intentionally transport-light: SMTP and SendGrid are supported
with standard-library clients, and missing configuration returns a skipped
result instead of failing the ticket workflow.
"""

from __future__ import annotations

import json
import logging
import os
import smtplib
import urllib.error
import urllib.request
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Optional

from dotenv import load_dotenv
from jinja2 import Environment, select_autoescape

load_dotenv()

logger = logging.getLogger(__name__)


@dataclass
class TicketEmailContext:
    """Data needed to render a ticket lifecycle email."""

    event_type: str
    recipient_email: str
    recipient_name: str = ""
    ticket_id: str = ""
    ticket_title: str = ""
    ticket_status: str = ""
    ticket_priority: str = ""
    ticket_url: str = ""
    actor_name: str = ""
    comment_excerpt: str = ""


@dataclass
class EmailChangeEmailContext:
    """Data needed to render a verified email-change confirmation email."""

    recipient_email: str
    old_email: str
    otp_code: str
    verification_url: str = ""
    recipient_name: str = ""
    company_name: str = "RITESH PVT LTD"
    account_role: str = "User"
    expires_minutes: int = 30


@dataclass
class EmailDeliveryResult:
    """Normalized result returned by all delivery backends."""

    sent: bool
    provider: str
    message_id: Optional[str] = None
    skipped: bool = False
    reason: str = ""


class EmailService:
    """Render and deliver transactional ticket emails."""

    EVENT_COPY = {
        "ticket_created": {
            "subject": "Support ticket received",
            "heading": "Ticket received",
            "body": "Your support request has been captured and routed for review.",
            "cta": "View ticket",
        },
        "ticket_assigned": {
            "subject": "Support ticket assigned",
            "heading": "Ticket assigned",
            "body": "Your ticket has been assigned to a support specialist.",
            "cta": "Review assignment",
        },
        "ticket_updated": {
            "subject": "Support ticket updated",
            "heading": "Ticket updated",
            "body": "There is a new update on your support ticket.",
            "cta": "View update",
        },
        "ticket_resolved": {
            "subject": "Support ticket resolved",
            "heading": "Ticket resolved",
            "body": "Your support ticket has been marked as resolved.",
            "cta": "Review resolution",
        },
        "new_comment": {
            "subject": "New ticket comment",
            "heading": "New comment",
            "body": "A new comment was added to your support ticket.",
            "cta": "Open conversation",
        },
    }

    TEMPLATE = """
<!doctype html>
<html>
  <body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f8fafc;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px;background:#0f172a;">
                <h1 style="margin:0;color:#ffffff;font-size:24px;letter-spacing:.02em;">HELPDESK<span style="color:#10b981;">.AI</span></h1>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 8px;color:#64748b;font-size:14px;">Hi {{ recipient_name or "there" }},</p>
                <h2 style="margin:0 0 12px;color:#0f172a;font-size:22px;">{{ heading }}</h2>
                <p style="margin:0 0 24px;color:#334155;font-size:16px;line-height:1.6;">{{ body }}</p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #e2e8f0;border-radius:12px;">
                  <tr>
                    <td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
                      <strong>Ticket</strong><br>
                      <span style="color:#475569;">#{{ ticket_id }} - {{ ticket_title or "Untitled ticket" }}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 20px;">
                      <strong>Status</strong><br>
                      <span style="color:#475569;">{{ ticket_status or "Open" }}{% if ticket_priority %} - {{ ticket_priority }} priority{% endif %}</span>
                    </td>
                  </tr>
                  {% if comment_excerpt %}
                  <tr>
                    <td style="padding:16px 20px;border-top:1px solid #e2e8f0;">
                      <strong>Latest note</strong><br>
                      <span style="color:#475569;">{{ comment_excerpt }}</span>
                    </td>
                  </tr>
                  {% endif %}
                </table>

                {% if ticket_url %}
                <p style="margin:0 0 24px;">
                  <a href="{{ ticket_url }}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">
                    {{ cta }}
                  </a>
                </p>
                {% endif %}

                <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
                  You are receiving this because ticket email notifications are enabled for your account.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""

    def __init__(
        self,
        provider: Optional[str] = None,
        from_email: Optional[str] = None,
        from_name: Optional[str] = None,
        app_base_url: Optional[str] = None,
    ):
        explicit_provider = (provider or os.getenv("EMAIL_PROVIDER", "")).strip().lower()
        if explicit_provider and explicit_provider not in {"auto"}:
            self.provider = explicit_provider
        elif os.getenv("RESEND_API_KEY", "").strip():
            self.provider = "resend"
        elif os.getenv("SMTP_HOST", "").strip() and os.getenv("SMTP_USER", "").strip():
            self.provider = "smtp"
        elif os.getenv("SENDGRID_API_KEY", "").strip():
            self.provider = "sendgrid"
        else:
            self.provider = "disabled"

        default_from = (
            os.getenv("FROM_EMAIL", "").strip()
            or os.getenv("SMTP_USER", "").strip()
            or ("onboarding@resend.dev" if self.provider == "resend" else "")
        )
        self.from_email = from_email or default_from
        self.from_name = from_name or os.getenv("FROM_NAME", "HELPDESK.AI")
        self.app_base_url = (app_base_url or os.getenv("APP_BASE_URL", "")).rstrip("/")
        self.jinja_env = Environment(autoescape=select_autoescape(["html", "xml"]))

    def build_ticket_url(self, ticket_id: str) -> str:
        if not self.app_base_url or not ticket_id:
            return ""
        return f"{self.app_base_url}/ticket/{ticket_id}"

    def build_ticket_email(self, context: TicketEmailContext) -> tuple[str, str, str]:
        event_copy = self.EVENT_COPY.get(context.event_type, self.EVENT_COPY["ticket_updated"])
        ticket_url = context.ticket_url or self.build_ticket_url(context.ticket_id)
        subject_ref = f" #{context.ticket_id}" if context.ticket_id else ""
        subject = f"[HELPDESK.AI]{subject_ref} {event_copy['subject']}"

        template = self.jinja_env.from_string(self.TEMPLATE)
        html = template.render(
            heading=event_copy["heading"],
            body=event_copy["body"],
            cta=event_copy["cta"],
            recipient_name=context.recipient_name,
            ticket_id=context.ticket_id,
            ticket_title=context.ticket_title,
            ticket_status=context.ticket_status,
            ticket_priority=context.ticket_priority,
            ticket_url=ticket_url,
            comment_excerpt=context.comment_excerpt,
        )
        text = (
            f"{event_copy['heading']}\n\n"
            f"{event_copy['body']}\n\n"
            f"Ticket: #{context.ticket_id} - {context.ticket_title or 'Untitled ticket'}\n"
            f"Status: {context.ticket_status or 'Open'}\n"
            f"{ticket_url}\n"
        )
        return subject, html, text

    def build_email_change_email(self, context: EmailChangeEmailContext) -> tuple[str, str, str]:
        """Render the branded OTP email-change verification HTML and plain-text email."""
        from pathlib import Path

        subject = f"{context.otp_code} is your HELPDESK.AI verification code"
        template_path = Path(__file__).resolve().parent.parent / "templates" / "email_change_verification.html"
        if template_path.exists():
            template = self.jinja_env.from_string(template_path.read_text(encoding="utf-8"))
        else:
            template = self.jinja_env.from_string(
                "<p>Hi {{ recipient_name }}, your 6-digit verification code is <strong>{{ otp_code }}</strong>.</p>"
            )

        html = template.render(
            recipient_name=context.recipient_name,
            company_name=context.company_name,
            account_role=context.account_role,
            old_email=context.old_email,
            new_email=context.recipient_email,
            otp_code=context.otp_code,
            expires_minutes=context.expires_minutes,
        )
        text = (
            f"HELPDESK.AI — {context.company_name}\n\n"
            f"Hi {context.recipient_name or 'there'},\n\n"
            f"Your 6-digit verification code to switch your email to {context.recipient_email} is:\n\n"
            f"    {context.otp_code}\n\n"
            f"This code expires in {context.expires_minutes} minutes.\n"
            "If you did not request this email change, you can safely ignore this message.\n"
        )
        return subject, html, text

    def send_email_change_verification(
        self, context: EmailChangeEmailContext
    ) -> EmailDeliveryResult:
        """Send a verification email to the user's requested new email address."""
        if not context.recipient_email:
            return EmailDeliveryResult(False, self.provider, skipped=True, reason="missing_recipient_email")

        subject, html, text = self.build_email_change_email(context)

        if self.provider == "smtp":
            return self._send_smtp(context.recipient_email, subject, html, text)
        if self.provider == "sendgrid":
            return self._send_sendgrid(context.recipient_email, subject, html, text)
        if self.provider == "resend":
            return self._send_resend(context.recipient_email, subject, html, text)

        return EmailDeliveryResult(
            False,
            self.provider or "disabled",
            skipped=True,
            reason="email_provider_disabled",
        )

    def _send_resend(self, recipient_email: str, subject: str, html: str, text: str) -> EmailDeliveryResult:
        api_key = os.getenv("RESEND_API_KEY", "")
        if not api_key or not self.from_email:
            return EmailDeliveryResult(False, "resend", skipped=True, reason="resend_not_configured")

        payload = {
            "from": f"{self.from_name} <{self.from_email}>",
            "to": [recipient_email],
            "subject": subject,
            "html": html,
            "text": text,
        }
        request = urllib.request.Request(
            "https://api.resend.com/emails",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                body = json.loads(response.read().decode("utf-8") or "{}")
                return EmailDeliveryResult(True, "resend", message_id=body.get("id"))
        except urllib.error.HTTPError as exc:
            logger.error("Resend delivery failed: status=%s reason=%s", exc.code, exc.reason)
            raise

    def send_ticket_email(self, context: TicketEmailContext) -> EmailDeliveryResult:
        if not context.recipient_email:
            return EmailDeliveryResult(False, self.provider, skipped=True, reason="missing_recipient_email")

        if self.provider in {"", "disabled", "none"}:
            return EmailDeliveryResult(False, self.provider or "disabled", skipped=True, reason="email_provider_disabled")

        subject, html, text = self.build_ticket_email(context)

        if self.provider == "smtp":
            return self._send_smtp(context.recipient_email, subject, html, text)
        if self.provider == "sendgrid":
            return self._send_sendgrid(context.recipient_email, subject, html, text)

        return EmailDeliveryResult(False, self.provider, skipped=True, reason=f"unsupported_provider:{self.provider}")

    def _send_smtp(self, recipient_email: str, subject: str, html: str, text: str) -> EmailDeliveryResult:
        host = os.getenv("SMTP_HOST", "")
        port = int(os.getenv("SMTP_PORT", "587"))
        username = os.getenv("SMTP_USER", "")
        password = os.getenv("SMTP_PASS", "")
        use_tls = os.getenv("SMTP_USE_TLS", "true").lower() == "true"

        if not host or not self.from_email:
            return EmailDeliveryResult(False, "smtp", skipped=True, reason="smtp_not_configured")

        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = f"{self.from_name} <{self.from_email}>"
        message["To"] = recipient_email
        message.set_content(text)
        message.add_alternative(html, subtype="html")

        with smtplib.SMTP(host, port, timeout=20) as smtp:
            if use_tls:
                smtp.starttls()
            if username and password:
                smtp.login(username, password)
            smtp.send_message(message)

        return EmailDeliveryResult(True, "smtp")

    def _send_sendgrid(self, recipient_email: str, subject: str, html: str, text: str) -> EmailDeliveryResult:
        api_key = os.getenv("SENDGRID_API_KEY", "")
        if not api_key or not self.from_email:
            return EmailDeliveryResult(False, "sendgrid", skipped=True, reason="sendgrid_not_configured")

        payload = {
            "personalizations": [{"to": [{"email": recipient_email}]}],
            "from": {"email": self.from_email, "name": self.from_name},
            "subject": subject,
            "content": [
                {"type": "text/plain", "value": text},
                {"type": "text/html", "value": html},
            ],
        }

        request = urllib.request.Request(
            "https://api.sendgrid.com/v3/mail/send",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                message_id = response.headers.get("X-Message-Id")
                return EmailDeliveryResult(True, "sendgrid", message_id=message_id)
        except urllib.error.HTTPError as exc:
            logger.error("SendGrid delivery failed: status=%s reason=%s", exc.code, exc.reason)
            raise
