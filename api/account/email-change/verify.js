const crypto = require("crypto");
const {
  MAX_OTP_ATTEMPTS,
  setCorsHeaders,
  getSupabaseConfig,
  sha256Hex,
  verifyChallengeToken,
  parseJsonBody,
  authenticateBearer,
  supabaseRest,
} = require("./_utils");

async function syncVerifiedEmail(userId, newEmail) {
  const { url, serviceKey } = getSupabaseConfig();
  const authResp = await fetch(
    `${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: "PUT",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: newEmail,
        email_confirm: true,
      }),
    }
  );
  if (!authResp.ok) {
    const errText = await authResp.text();
    throw new Error(`Failed to update authentication email (${authResp.status}): ${errText}`);
  }

  await supabaseRest(`profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      email: newEmail,
      updated_at: new Date().toISOString(),
    }),
  });
}

function timingSafeHexEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const { url, serviceKey } = getSupabaseConfig();
  if (!url || !serviceKey) {
    return res.status(503).json({
      detail:
        "Server email-change configuration incomplete: set SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel Environment Variables.",
    });
  }

  const auth = await authenticateBearer(req);
  if (auth.errorStatus) {
    return res.status(auth.errorStatus).json({ detail: auth.errorDetail });
  }

  const body = await parseJsonBody(req);
  const otpCode = String(body.otp_code || "").trim();
  if (!/^\d{6}$/.test(otpCode)) {
    return res.status(400).json({ detail: "Please enter a valid 6-digit numeric OTP code." });
  }

  const userId = auth.user.id;
  const now = new Date();

  // 1. Try DB-backed verification first
  let dbRow = null;
  try {
    const dbRes = await supabaseRest(
      `email_change_requests?user_id=eq.${encodeURIComponent(userId)}&status=eq.pending&order=created_at.desc&limit=1`,
      { method: "GET" }
    );
    if (dbRes.ok && Array.isArray(dbRes.data) && dbRes.data[0]) {
      dbRow = dbRes.data[0];
    }
  } catch {
    dbRow = null;
  }

  if (dbRow) {
    const expiresAt = new Date(dbRow.expires_at);
    if (expiresAt < now) {
      await supabaseRest(`email_change_requests?id=eq.${encodeURIComponent(dbRow.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "expired", updated_at: now.toISOString() }),
      });
      return res.status(410).json({
        detail: "OTP has expired. Please request a new 6-digit code.",
      });
    }

    const attempts = Number(dbRow.attempts || 0);
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await supabaseRest(`email_change_requests?id=eq.${encodeURIComponent(dbRow.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "expired", updated_at: now.toISOString() }),
      });
      return res.status(429).json({
        detail: "Too many incorrect OTP attempts. Please request a new code.",
      });
    }

    const expectedHash = sha256Hex(`${userId}:${dbRow.new_email}:${otpCode}`);
    if (!timingSafeHexEqual(expectedHash, dbRow.otp_code_hash)) {
      await supabaseRest(`email_change_requests?id=eq.${encodeURIComponent(dbRow.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ attempts: attempts + 1, updated_at: now.toISOString() }),
      });
      const remaining = Math.max(0, MAX_OTP_ATTEMPTS - attempts - 1);
      return res.status(400).json({
        detail: `Incorrect OTP code. ${remaining} attempt(s) remaining.`,
      });
    }

    try {
      await syncVerifiedEmail(userId, dbRow.new_email);
    } catch (err) {
      return res.status(502).json({ detail: err.message });
    }

    await supabaseRest(`email_change_requests?id=eq.${encodeURIComponent(dbRow.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "verified",
        verified_at: now.toISOString(),
        updated_at: now.toISOString(),
      }),
    });

    return res.status(200).json({
      verified: true,
      old_email: dbRow.old_email,
      new_email: dbRow.new_email,
      message: "Email verified and updated directly to your new email address.",
    });
  }

  // 2. Stateless HMAC challenge_token fallback
  const challengeToken = body.challenge_token;
  if (!challengeToken) {
    return res.status(404).json({
      detail: "No active OTP session found. Please request a new 6-digit code.",
    });
  }

  const claims = verifyChallengeToken(challengeToken);
  if (!claims || claims.uid !== userId) {
    return res.status(400).json({
      detail: "Invalid OTP verification session. Please request a new code.",
    });
  }
  if (Number(claims.exp || 0) < Math.floor(now.getTime() / 1000)) {
    return res.status(410).json({
      detail: "OTP has expired. Please request a new 6-digit code.",
    });
  }

  const targetEmail = claims.new;
  const expectedHash = sha256Hex(`${userId}:${targetEmail}:${otpCode}`);
  if (!timingSafeHexEqual(expectedHash, claims.h)) {
    return res.status(400).json({
      detail: "Incorrect 6-digit OTP code. Please check your new email inbox and try again.",
    });
  }

  try {
    await syncVerifiedEmail(userId, targetEmail);
  } catch (err) {
    return res.status(502).json({ detail: err.message });
  }

  return res.status(200).json({
    verified: true,
    old_email: claims.old || "",
    new_email: targetEmail,
    message: "Email verified and updated directly to your new email address.",
  });
};
