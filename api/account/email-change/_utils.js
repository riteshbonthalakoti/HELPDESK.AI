const crypto = require("crypto");

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const OTP_TTL_MINUTES = Number(process.env.EMAIL_CHANGE_TTL_MINUTES || 10);
const MAX_OTP_ATTEMPTS = 5;

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function getSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceKey =
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  return { url, serviceKey, anonKey };
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function getHmacKey() {
  return (
    process.env.EMAIL_CHANGE_SECRET ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.JWT_SECRET ||
    "helpdesk-ai-otp-signing-fallback"
  );
}

function signChallengeToken(payload) {
  const ordered = {};
  Object.keys(payload)
    .sort()
    .forEach((k) => {
      ordered[k] = payload[k];
    });
  const b64 = Buffer.from(JSON.stringify(ordered), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getHmacKey()).update(b64, "ascii").digest("hex");
  return `${b64}.${sig}`;
}

function verifyChallengeToken(token) {
  try {
    if (!token || typeof token !== "string" || !token.includes(".")) return null;
    const dot = token.indexOf(".");
    const b64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = crypto.createHmac("sha256", getHmacKey()).update(b64, "ascii").digest("hex");
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) {
      return null;
    }
    const raw = Buffer.from(b64, "base64url").toString("utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function parseJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function authenticateBearer(req) {
  const { url, serviceKey, anonKey } = getSupabaseConfig();
  if (!url) {
    return { errorStatus: 503, errorDetail: "SUPABASE_URL is not configured on the server." };
  }
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(authHeader).trim());
  if (!match) {
    return { errorStatus: 401, errorDetail: "Missing Authorization Bearer token." };
  }
  const accessToken = match[1].trim();
  const apiKey = serviceKey || anonKey;
  if (!apiKey) {
    return { errorStatus: 503, errorDetail: "Supabase API key is not configured on the server." };
  }

  const resp = await fetch(`${url}/auth/v1/user`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: apiKey,
    },
  });
  if (!resp.ok) {
    return { errorStatus: 401, errorDetail: "Session expired or invalid. Please sign in again." };
  }
  const user = await resp.json();
  if (!user || !user.id) {
    return { errorStatus: 401, errorDetail: "Unable to resolve authenticated user." };
  }
  return { user };
}

async function supabaseRest(path, options = {}) {
  const { url, serviceKey } = getSupabaseConfig();
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const resp = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers,
  });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: resp.ok, status: resp.status, data };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderOtpEmailHtml({
  otpCode,
  newEmail,
  recipientName,
  companyName,
  accountRole,
  expiresMinutes = OTP_TTL_MINUTES,
}) {
  const safeName = escapeHtml(recipientName || "there");
  const safeCompany = escapeHtml(companyName || "RITESH PVT LTD");
  const safeRole = escapeHtml(accountRole || "Account");
  const safeNewEmail = escapeHtml(newEmail);
  const digits = String(otpCode).padStart(6, "0").slice(0, 6).split("");

  const digitTiles = digits
    .map(
      (digit) => `
      <td align="center" style="padding:0 4px;">
        <div style="width:46px;height:56px;line-height:56px;text-align:center;background-color:#111827;border:1.5px solid #10b981;border-radius:12px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:28px;font-weight:800;color:#ffffff;box-shadow:0 4px 14px rgba(16,185,129,0.16);">
          ${escapeHtml(digit)}
        </div>
      </td>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>${escapeHtml(otpCode)} is your HELPDESK.AI verification code</title>
  </head>
  <body style="margin:0;padding:0;background-color:#0b1120;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      Your 6-digit verification code is ${escapeHtml(otpCode)}. It expires in ${expiresMinutes} minutes.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0b1120;padding:44px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;background-color:#111827;border:1px solid #1f2937;border-radius:20px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.45);">
            <tr>
              <td style="height:4px;background:linear-gradient(90deg,#10b981 0%,#34d399 50%,#059669 100%);font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:32px 36px 24px;border-bottom:1px solid #1f2937;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <span style="font-size:20px;font-weight:800;letter-spacing:0.04em;color:#ffffff;">HELPDESK</span><span style="font-size:20px;font-weight:800;letter-spacing:0.04em;color:#34d399;">.AI</span>
                    </td>
                    <td align="right" style="vertical-align:middle;">
                      <span style="display:inline-block;padding:5px 12px;border-radius:999px;background-color:rgba(16,185,129,0.12);border:1px solid rgba(52,211,153,0.3);color:#6ee7b7;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">
                        ${safeCompany}
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 36px 32px;">
                <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#34d399;letter-spacing:0.08em;text-transform:uppercase;">
                  Email Verification Code
                </p>
                <h1 style="margin:0 0 14px;font-size:24px;font-weight:700;line-height:1.3;color:#f8fafc;letter-spacing:-0.02em;">
                  Confirm your new email address
                </h1>
                <p style="margin:0 0 28px;font-size:15px;line-height:1.65;color:#94a3b8;">
                  Hi ${safeName}, enter the 6-digit code below in HELPDESK.AI to switch your <strong style="color:#e2e8f0;">${safeRole}</strong> email to <strong style="color:#f8fafc;">${safeNewEmail}</strong>.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background-color:#0f172a;border:1px solid #1e293b;border-radius:16px;">
                  <tr>
                    <td align="center" style="padding:26px 16px 22px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>${digitTiles}</tr>
                      </table>
                      <p style="margin:16px 0 0;font-size:12px;color:#64748b;letter-spacing:0.02em;">
                        Valid for <strong style="color:#cbd5e1;">${expiresMinutes} minutes</strong> &middot; Single-use code
                      </p>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background-color:rgba(255,255,255,0.03);border:1px solid #1f2937;border-radius:12px;">
                  <tr>
                    <td style="padding:14px 18px;">
                      <span style="display:block;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">New Sign-In Email</span>
                      <span style="display:block;margin-top:4px;font-size:14px;font-weight:600;color:#e2e8f0;font-family:'SFMono-Regular',Consolas,monospace;">${safeNewEmail}</span>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
                  Didn&rsquo;t request this change? You can safely ignore this email &mdash; your account will not be updated without this code.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 36px;background-color:#0f172a;border-top:1px solid #1f2937;">
                <p style="margin:0;font-size:12px;color:#475569;text-align:center;">
                  &copy; HELPDESK.AI &middot; ${safeCompany} Security
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendOtpEmail({ to, subject, html, text }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const fromEmail =
      process.env.EMAIL_FROM ||
      process.env.DIGEST_FROM_EMAIL ||
      "HELPDESK.AI <onboarding@resend.dev>";
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject,
        html,
        text,
      }),
    });
    if (resp.ok) {
      return { sent: true, provider: "resend" };
    }
    const errText = await resp.text();
    return { sent: false, provider: "resend", reason: `Resend HTTP ${resp.status}: ${errText}` };
  }

  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (sendgridKey) {
    const fromEmail = process.env.EMAIL_FROM || "no-reply@helpdesk.ai";
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromEmail, name: "HELPDESK.AI" },
        subject,
        content: [
          { type: "text/plain", value: text },
          { type: "text/html", value: html },
        ],
      }),
    });
    if (resp.status >= 200 && resp.status < 300) {
      return { sent: true, provider: "sendgrid" };
    }
    const errText = await resp.text();
    return { sent: false, provider: "sendgrid", reason: `SendGrid HTTP ${resp.status}: ${errText}` };
  }

  return {
    sent: false,
    provider: "none",
    reason: "Set RESEND_API_KEY (or SENDGRID_API_KEY) in Vercel Project Environment Variables.",
  };
}

module.exports = {
  EMAIL_REGEX,
  OTP_TTL_MINUTES,
  MAX_OTP_ATTEMPTS,
  setCorsHeaders,
  getSupabaseConfig,
  sha256Hex,
  signChallengeToken,
  verifyChallengeToken,
  parseJsonBody,
  authenticateBearer,
  supabaseRest,
  renderOtpEmailHtml,
  sendOtpEmail,
};
