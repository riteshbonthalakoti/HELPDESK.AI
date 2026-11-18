import React, { useState, useEffect } from "react";
import { Mail, ShieldCheck, CheckCircle2, AlertCircle, Loader2, X, Send, KeyRound } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { API_CONFIG } from "../../config";
import useAuthStore from "../../store/authStore";
import useToastStore from "../../store/toastStore";

const EmailChangeModal = ({ isOpen, onClose, currentEmail }) => {
  const { showToast } = useToastStore();
  const [step, setStep] = useState("request"); // 'request' | 'verify' | 'done'
  const [newEmail, setNewEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [pendingRequest, setPendingRequest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [infoNote, setInfoNote] = useState("");

  const getAuthHeaders = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setInfoNote("");
    setOtpCode("");

    const checkPending = async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_CONFIG.BACKEND_URL}/api/account/email-change/status`, {
          headers,
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.pending) {
            setPendingRequest(data.pending);
            setNewEmail(data.pending.new_email);
            setStep("verify");
            return;
          }
        }
      } catch {
        // Non-fatal: default to request step
      }
      setPendingRequest(null);
      setNewEmail("");
      setStep("request");
    };
    checkPending();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRequestChange = async (e) => {
    e.preventDefault();
    setError("");
    setInfoNote("");
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Enter a valid new email address (e.g. yourname@gmail.com).");
      return;
    }
    if (trimmed === (currentEmail || "").trim().toLowerCase()) {
      setError("New email must be different from your current email.");
      return;
    }

    setLoading(true);
    try {
      let usedBackendOtp = false;
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_CONFIG.BACKEND_URL}/api/account/email-change/request`, {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({
            new_email: trimmed,
            frontend_origin: window.location.origin,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.email_sent) {
          usedBackendOtp = true;
          setPendingRequest({ new_email: data.new_email, expires_at: data.expires_at });
          setInfoNote(
            `Verification email sent to ${data.new_email}. Enter the 6-digit code below or click the link in your inbox.`
          );
          setStep("verify");
          showToast(`Verification email sent to ${data.new_email}`, "success");
        } else if (res.status === 400 || res.status === 409) {
          throw new Error(data.detail || "Unable to use that email address.");
        }
      } catch (backendErr) {
        if (backendErr.message && backendErr.message.includes("already registered")) {
          throw backendErr;
        }
        // Fall through to Supabase native verified email-change flow
      }

      if (!usedBackendOtp) {
        const { error: sbError } = await supabase.auth.updateUser(
          { email: trimmed },
          { emailRedirectTo: `${window.location.origin}/verify-email-change` }
        );
        if (sbError) {
          throw new Error(sbError.message || "Failed to send verification email.");
        }
        setPendingRequest({ new_email: trimmed });
        setInfoNote(
          `Confirmation link sent to ${trimmed} (and your current email if double-confirmation is enabled in Supabase). Open your inbox and click the confirmation link to finish switching your Gmail.`
        );
        setStep("supabase_sent");
        showToast(`Confirmation email sent to ${trimmed}`, "success");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError("");
    const cleanedOtp = otpCode.trim();
    if (!/^\d{6}$/.test(cleanedOtp)) {
      setError("Enter the 6-digit numeric verification code from your email.");
      return;
    }

    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_CONFIG.BACKEND_URL}/api/account/email-change/verify`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ otp_code: cleanedOtp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || "Verification failed.");
      }

      await supabase.auth.refreshSession().catch(() => {});
      const user = useAuthStore.getState().user;
      if (user) {
        await useAuthStore.getState().getProfile({ ...user, email: data.new_email });
      }
      setStep("done");
      showToast(`Email verified and updated to ${data.new_email}`, "success");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelPending = async () => {
    setLoading(true);
    setError("");
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API_CONFIG.BACKEND_URL}/api/account/email-change/cancel`, {
        method: "DELETE",
        headers,
        credentials: "include",
      });
      setPendingRequest(null);
      setNewEmail("");
      setOtpCode("");
      setStep("request");
      showToast("Pending email change cancelled.", "info");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-emerald-100 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 bg-gradient-to-r from-slate-900 to-emerald-900 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center">
              <Mail size={20} className="text-emerald-300" />
            </div>
            <div>
              <h3 className="font-bold text-base">Change &amp; Verify Email</h3>
              <p className="text-xs text-emerald-200">Verified Gmail / Email Switch</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {infoNote && step === "verify" && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs leading-relaxed">
              <ShieldCheck size={16} className="shrink-0 mt-0.5 text-emerald-600" />
              <span>{infoNote}</span>
            </div>
          )}

          {step === "request" && (
            <form onSubmit={handleRequestChange} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Current Email
                </label>
                <input
                  type="email"
                  value={currentEmail || ""}
                  disabled
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-500 text-sm font-mono cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  New Email / Gmail Address
                </label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="new.admin@gmail.com"
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-500"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  We will send a 6-digit verification code and confirmation link to this address.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition disabled:opacity-60"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
                  Send Verification
                </button>
              </div>
            </form>
          )}

          {step === "verify" && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                Pending switch to:{" "}
                <strong className="text-slate-900 font-mono">
                  {pendingRequest?.new_email || newEmail}
                </strong>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  6-Digit Verification Code
                </label>
                <div className="relative">
                  <KeyRound
                    size={16}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-lg font-mono tracking-[0.35em] text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleCancelPending}
                  disabled={loading}
                  className="text-xs font-semibold text-slate-500 hover:text-red-600 transition"
                >
                  Cancel Request
                </button>
                <button
                  type="submit"
                  disabled={loading || otpCode.length !== 6}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                  Verify &amp; Update Email
                </button>
              </div>
            </form>
          )}

          {step === "supabase_sent" && (
            <div className="py-4 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-50 border-2 border-emerald-500 flex items-center justify-center mx-auto">
                <Mail size={28} className="text-emerald-600" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-slate-900">Check Your New Gmail Inbox</h4>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                  {infoNote}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition"
              >
                Got It
              </button>
            </div>
          )}

          {step === "done" && (
            <div className="py-4 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-50 border-2 border-emerald-500 flex items-center justify-center mx-auto">
                <CheckCircle2 size={32} className="text-emerald-600" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-slate-900">Email Updated!</h4>
                <p className="text-sm text-slate-600 mt-1">
                  Your account is now verified and active on{" "}
                  <span className="font-mono font-semibold text-slate-900">
                    {pendingRequest?.new_email || newEmail}
                  </span>
                  .
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmailChangeModal;
