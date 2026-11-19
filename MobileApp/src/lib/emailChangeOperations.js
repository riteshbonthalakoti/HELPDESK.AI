/**
 * emailChangeOperations.js
 *
 * Production operations for the direct 6-digit OTP email change flow.
 * Extracted for parity, modularity, and comprehensive testability.
 */

let defaultBackendUrl = 'http://localhost:7860';
let defaultGetAuthHeaders = async () => ({});
let defaultSupabase = null;

try {
  const authBackend = require('./authBackend');
  if (authBackend.BACKEND_URL) defaultBackendUrl = authBackend.BACKEND_URL;
  if (authBackend.getAuthHeaders) defaultGetAuthHeaders = authBackend.getAuthHeaders;
} catch (_) {}

try {
  const sb = require('./supabase');
  if (sb.supabase) defaultSupabase = sb.supabase;
} catch (_) {}

export const validateEmailInput = (email, currentEmail) => {
  const trimmed = (email || '').trim().toLowerCase();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { valid: false, error: 'Please enter a valid email address (e.g. name@gmail.com).' };
  }
  if (trimmed === (currentEmail || '').trim().toLowerCase()) {
    return { valid: false, error: 'New email must be different from your current email.' };
  }
  return { valid: true, email: trimmed };
};

export const validateOtpCode = (otpDigitsOrCode) => {
  const code = Array.isArray(otpDigitsOrCode)
    ? otpDigitsOrCode.join('')
    : String(otpDigitsOrCode || '');
  if (!/^\d{6}$/.test(code.trim())) {
    return { valid: false, error: 'Please enter the complete 6-digit OTP code.' };
  }
  return { valid: true, code: code.trim() };
};

export const requestEmailChangeOtp = async ({
  newEmail,
  backendUrl = defaultBackendUrl,
  getHeaders = defaultGetAuthHeaders,
  fetchFn = fetch,
}) => {
  const authHeaders = await getHeaders();
  const res = await fetchFn(`${backendUrl}/api/account/email-change/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({ new_email: newEmail }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail || data?.message || 'Failed to send OTP verification email.');
  }

  return data;
};

export const verifyEmailChangeOtp = async ({
  otpCode,
  newEmail,
  challengeToken,
  backendUrl = defaultBackendUrl,
  getHeaders = defaultGetAuthHeaders,
  fetchFn = fetch,
  supabaseClient = defaultSupabase,
  onSuccess,
}) => {
  const authHeaders = await getHeaders();
  const res = await fetchFn(`${backendUrl}/api/account/email-change/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      otp_code: otpCode,
      new_email: newEmail,
      challenge_token: challengeToken,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail || data?.message || 'Invalid or expired OTP code.');
  }

  // Best-effort local session / profile update inside separate try/catch
  if (supabaseClient?.auth) {
    try {
      await supabaseClient.auth.refreshSession();
    } catch (_) {}

    try {
      const { data: userData } = await supabaseClient.auth.getUser();
      if (userData?.user?.id) {
        await supabaseClient
          .from('profiles')
          .update({ email: newEmail, updated_at: new Date().toISOString() })
          .eq('id', userData.user.id);
      }
    } catch (_) {}
  }

  if (onSuccess) {
    onSuccess(newEmail);
  }

  return data;
};
