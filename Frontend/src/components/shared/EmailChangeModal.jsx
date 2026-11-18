import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Mail,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  Send,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Lock,
} from "lucide-react";
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

  const getApiBase = () => {
    if (
      typeof window !== "undefined" &&
      !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
    ) {
      return "";
    }
    return API_CONFIG.BACKEND_URL;
  };

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
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

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
      const res = await fetch(`${getApiBase()}/api/account/email-change/request`, {
        method: "POST",
        headers,
        body: JSON.stringify({ new_email: trimmed }),
      });
      const rawText = await res.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }
      if (!res.ok) {
        throw new Error(
          data.detail || `Request failed (HTTP ${res.status}). Please try again.`
        );
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
      const res = await fetch(`${getApiBase()}/api/account/email-change/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          otp_code: otpCode,
          new_email: newEmail,
          challenge_token: challengeToken,
        }),
      });
      const rawText = await res.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }
      if (!res.ok) {
        throw new Error(data.detail || `OTP verification failed (HTTP ${res.status}).`);
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

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-slate-950/55 backdrop-blur-md p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-[440px] bg-white rounded-t-[28px] sm:rounded-[28px] ring-1 ring-slate-900/10 shadow-[0_24px_80px_rgba(15,23,42,0.28)] overflow-hidden max-h-[92dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)] sm:pb-0 animate-in zoom-in-95 slide-in-from-bottom-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle Emerald Accent Hairline */}
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600" />

        {/* Mobile drag pill */}
        <div className="sm:hidden flex justify-center pt-2.5">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>

        {/* Clean Light Header */}
        <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-4 border-b border-slate-100">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-200/80 flex items-center justify-center shrink-0">
              <Mail size={20} className="text-emerald-600" />
            </div>
            <div>
              <h3 className="text-[17px] font-bold text-slate-900 tracking-tight leading-snug">
                Change Account Email
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Direct 6-digit OTP verification
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200/80 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step Indicator */}
        {step !== "done" && (
          <div className="px-6 pt-4 pb-1 flex items-center gap-2 text-[11px] font-semibold">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${
                step === "request"
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center">
                1
              </span>
              New Email
            </span>
            <ArrowRight size={12} className="text-slate-300" />
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${
                step === "otp"
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                  : "bg-slate-100 text-slate-400"
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${
                  step === "otp" ? "bg-emerald-600 text-white" : "bg-slate-300 text-white"
                }`}
              >
                2
              </span>
              Verify OTP
            </span>
          </div>
        )}

        <div className="p-6 space-y-5">
          {error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-red-50/90 border border-red-200/90 text-red-700 text-xs font-medium leading-relaxed">
              <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-500" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {step === "request" && (
            <form onSubmit={handleRequestSubmit} className="space-y-4">
              {/* Current Email Pill */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Current Email
                  </p>
                  <p className="text-sm font-mono font-semibold text-slate-700 truncate mt-0.5">
                    {currentEmail || "Not set"}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[10px] font-semibold text-slate-500 shrink-0">
                  <Lock size={10} /> Active
                </span>
              </div>

              {/* New Email Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  New Email Address
                </label>
                <div className="relative">
                  <Mail
                    size={16}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  />
                  <input
                    type="email"
                    required
                    autoFocus
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="name@gmail.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-white border border-slate-200 text-slate-900 text-sm font-medium placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/15 focus:border-emerald-500 transition"
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                  We&rsquo;ll send a 6-digit verification code directly to your new email. No action is needed on your old email.
                </p>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 text-sm font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-semibold shadow-md shadow-emerald-600/20 active:scale-[0.98] transition disabled:opacity-60 cursor-pointer"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
                  Send 6-Digit OTP
                </button>
              </div>
            </form>
          )}

          {step === "otp" && (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <div className="p-3.5 rounded-2xl bg-emerald-50/80 border border-emerald-200/80 text-xs text-emerald-950 leading-relaxed">
                Enter the <strong>6-digit code</strong> sent to{" "}
                <span className="font-mono font-bold text-emerald-800">{newEmail}</span>.
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2.5 text-center">
                  6-Digit Verification Code
                </label>
                <div className="grid grid-cols-6 gap-2 max-w-[320px] mx-auto">
                  {otpDigits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => {
                        inputRefs.current[idx] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      autoComplete={idx === 0 ? "one-time-code" : "off"}
                      maxLength={6}
                      value={digit}
                      onChange={(e) => handleDigitChange(idx, e.target.value)}
                      onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                      className="w-full h-12 sm:h-13 text-center text-lg sm:text-xl font-mono font-bold text-slate-900 bg-slate-50 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/15 transition"
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
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-bold shadow-md shadow-emerald-600/20 active:scale-[0.98] transition disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ShieldCheck size={16} />
                )}
                Verify OTP &amp; Switch Email
              </button>
            </form>
          )}

          {step === "done" && (
            <div className="py-4 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-50 border-2 border-emerald-500 flex items-center justify-center mx-auto">
                <CheckCircle2 size={32} className="text-emerald-600" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-slate-900">Email Updated</h4>
                <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                  Your account now signs in with{" "}
                  <span className="font-mono font-semibold text-slate-900">{newEmail}</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-semibold shadow-md shadow-emerald-600/20 transition cursor-pointer"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
};

export default EmailChangeModal;
