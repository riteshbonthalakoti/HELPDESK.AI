import React, { useState, useEffect, useRef } from "react";
import { Mail, ShieldCheck, CheckCircle2, AlertCircle, Loader2, X, Send, ArrowLeft, RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { API_CONFIG } from "../../config";
import useAuthStore from "../../store/authStore";
import useToastStore from "../../store/toastStore";

const EmailChangeModal = ({ isOpen, onClose, currentEmail }) => {
  const { showToast } = useToastStore();
  const [step, setStep] = useState("request"); // 'request' | 'otp' | 'done'
  const [newEmail, setNewEmail] = useState("");
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [challengeToken, setChallengeToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [error, setError] = useState("");

  const inputRefs = useRef([]);

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
    setStep("request");
    setNewEmail("");
    setOtpDigits(["", "", "", "", "", ""]);
    setChallengeToken("");
    setError("");
    setResendCooldown(0);
  }, [isOpen]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  if (!isOpen) return null;

  const sendOtp = async (emailTarget) => {
    setError("");
    const trimmed = (emailTarget || "").trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address (e.g. yourname@gmail.com).");
      return;
    }
    if (trimmed === (currentEmail || "").trim().toLowerCase()) {
      setError("New email must be different from your current email.");
      return;
    }

    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_CONFIG.BACKEND_URL}/api/account/email-change/request`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ new_email: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || "Unable to send OTP to the new email address.");
      }

      setNewEmail(data.new_email || trimmed);
      setChallengeToken(data.challenge_token || "");
      setOtpDigits(["", "", "", "", "", ""]);
      setResendCooldown(30);
      setStep("otp");
      showToast(`6-digit OTP sent to ${data.new_email || trimmed}`, "success");
      setTimeout(() => inputRefs.current[0]?.focus(), 80);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestSubmit = async (e) => {
    e.preventDefault();
    await sendOtp(newEmail);
  };

  const handleDigitChange = (index, rawValue) => {
    const cleaned = rawValue.replace(/\D/g, "");
    if (!cleaned) {
      const next = [...otpDigits];
      next[index] = "";
      setOtpDigits(next);
      return;
    }

    if (cleaned.length > 1) {
      // Handle full 6-digit paste
      const chars = cleaned.slice(0, 6).split("");
      const next = ["", "", "", "", "", ""];
      chars.forEach((ch, idx) => {
        next[idx] = ch;
      });
      setOtpDigits(next);
      const focusIdx = Math.min(chars.length, 5);
      inputRefs.current[focusIdx]?.focus();
      return;
    }

    const next = [...otpDigits];
    next[index] = cleaned;
    setOtpDigits(next);
    if (index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index, e) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError("");
    const otpCode = otpDigits.join("");
    if (otpCode.length !== 6) {
      setError("Please enter all 6 digits of the OTP sent to your new email.");
      return;
    }

    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_CONFIG.BACKEND_URL}/api/account/email-change/verify`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          otp_code: otpCode,
          new_email: newEmail,
          challenge_token: challengeToken,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || "OTP verification failed.");
      }

      await supabase.auth.refreshSession().catch(() => {});
      const user = useAuthStore.getState().user;
      if (user) {
        await useAuthStore.getState().getProfile({ ...user, email: data.new_email || newEmail });
      }
      setStep("done");
      showToast(`Account email updated to ${data.new_email || newEmail}`, "success");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const otpJoined = otpDigits.join("");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 bg-slate-950 text-white border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center">
              <Mail size={19} className="text-emerald-400" />
            </div>
            <div>
              <h3 className="font-bold text-base tracking-tight">Change Account Email</h3>
              <p className="text-xs text-slate-400">Direct 6-Digit OTP Verification</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium leading-relaxed">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {step === "request" && (
            <form onSubmit={handleRequestSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
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
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  New Email Address
                </label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="new.email@gmail.com"
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-500"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  A 6-digit OTP will be sent directly to this new email. Your old email is not required.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition disabled:opacity-60 cursor-pointer"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
                  Send 6-Digit OTP
                </button>
              </div>
            </form>
          )}

          {step === "otp" && (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 leading-relaxed">
                Enter the <strong>6-digit OTP</strong> sent to{" "}
                <span className="font-mono font-bold">{newEmail}</span>.
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-2.5 text-center">
                  Enter 6-Digit Verification Code
                </label>
                <div className="flex items-center justify-center gap-2">
                  {otpDigits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => {
                        inputRefs.current[idx] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={digit}
                      onChange={(e) => handleDigitChange(idx, e.target.value)}
                      onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                      className="w-11 h-13 text-center text-xl font-mono font-bold text-slate-900 bg-slate-50 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition"
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setStep("request");
                    setError("");
                  }}
                  className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  <ArrowLeft size={13} /> Change email
                </button>
                <button
                  type="button"
                  disabled={loading || resendCooldown > 0}
                  onClick={() => sendOtp(newEmail)}
                  className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 hover:text-emerald-900 disabled:text-slate-400 cursor-pointer"
                >
                  <RefreshCw size={13} />
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}
                </button>
              </div>

              <button
                type="submit"
                disabled={loading || otpJoined.length !== 6}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm transition disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ShieldCheck size={16} />
                )}
                Verify OTP &amp; Change Email
              </button>
            </form>
          )}

          {step === "done" && (
            <div className="py-4 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-50 border-2 border-emerald-500 flex items-center justify-center mx-auto">
                <CheckCircle2 size={32} className="text-emerald-600" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-slate-900">Email Updated Successfully</h4>
                <p className="text-sm text-slate-600 mt-1">
                  Your account has been switched directly to{" "}
                  <span className="font-mono font-semibold text-slate-900">{newEmail}</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition cursor-pointer"
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
