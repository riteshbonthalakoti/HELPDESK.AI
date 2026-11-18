const crypto = require("crypto");
const {
  EMAIL_REGEX,
  OTP_TTL_MINUTES,
  setCorsHeaders,
  getSupabaseConfig,
  sha256Hex,
  signChallengeToken,
  parseJsonBody,
  authenticateBearer,
  supabaseRest,
  renderOtpEmailHtml,
  sendOtpEmail,
} = require("./_utils");

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
  const newEmail = String(body.new_email || "").trim().toLowerCase();
  if (!EMAIL_REGEX.test(newEmail)) {
    return res.status(400).json({ detail: "Please provide a valid email address." });
  }

  const userId = auth.user.id;

  const profileRes = await supabaseRest(
    `profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,full_name,role,company,company_id&limit=1`,
    { method: "GET" }
  );
  const profile =
    profileRes.ok && Array.isArray(profileRes.data) && profileRes.data[0]
      ? profileRes.data[0]
      : {};
  const oldEmail = String(profile.email || auth.user.email || "").trim().toLowerCase();

  if (newEmail === oldEmail) {
    return res.status(400).json({
      detail: "New email address must be different from your current email address.",
    });
  }

  const existingRes = await supabaseRest(
    `profiles?email=ilike.${encodeURIComponent(newEmail)}&select=id&limit=1`,
    { method: "GET" }
  );
  if (
    existingRes.ok &&
    Array.isArray(existingRes.data) &&
    existingRes.data[0] &&
    existingRes.data[0].id !== userId
  ) {
    return res.status(409).json({
      detail: "That email address is already registered to another account.",
    });
  }

  const otpCode = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const otpHash = sha256Hex(`${userId}:${newEmail}:${otpCode}`);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  let dbPersisted = false;
  try {
    await supabaseRest(
      `email_change_requests?user_id=eq.${encodeURIComponent(userId)}&status=eq.pending`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        }),
      }
    );

    const insertRes = await supabaseRest("email_change_requests", {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        company_id: profile.company_id || null,
        old_email: oldEmail,
        new_email: newEmail,
        token_hash: sha256Hex(crypto.randomBytes(32).toString("base64url")),
        otp_code_hash: otpHash,
        status: "pending",
        attempts: 0,
        expires_at: expiresAt.toISOString(),
      }),
    });
    dbPersisted = insertRes.ok;
  } catch {
    dbPersisted = false;
  }

  const challengeToken = signChallengeToken({
    uid: userId,
    old: oldEmail,
    new: newEmail,
    h: otpHash,
    exp: Math.floor(expiresAt.getTime() / 1000),
  });

  const roleMap = {
    master_admin: "Master Admin",
    super_admin: "Super Admin",
    admin: "Company Admin",
    agent: "Support Agent",
  };
  const accountRole = roleMap[String(profile.role || "user").toLowerCase()] || "User";
  const companyName = profile.company || "RITESH PVT LTD";

  const html = renderOtpEmailHtml({
    otpCode,
    newEmail,
    recipientName: profile.full_name || "",
    companyName,
    accountRole,
    expiresMinutes: OTP_TTL_MINUTES,
  });

  const text = [
    `HELPDESK.AI — ${companyName}`,
    "",
    `Your 6-digit verification code is: ${otpCode}`,
    "",
    `Enter this code in HELPDESK.AI to switch your ${accountRole} email directly to ${newEmail}.`,
    `This code expires in ${OTP_TTL_MINUTES} minutes.`,
  ].join("\n");

  const delivery = await sendOtpEmail({
    to: newEmail,
    subject: `${otpCode} is your HELPDESK.AI verification code`,
    html,
    text,
  });

  if (!delivery.sent) {
    return res.status(503).json({
      detail: `Email delivery is not configured (${delivery.provider}): ${delivery.reason}`,
    });
  }

  return res.status(200).json({
    status: "otp_sent",
    new_email: newEmail,
    expires_at: expiresAt.toISOString(),
    expires_minutes: OTP_TTL_MINUTES,
    challenge_token: challengeToken,
    db_persisted: dbPersisted,
    email_sent: true,
    provider: delivery.provider,
  });
};
