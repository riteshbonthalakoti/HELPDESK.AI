import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle2, AlertCircle, Loader2, ArrowRight } from "lucide-react";
import { API_CONFIG } from "../config";
import { supabase } from "../lib/supabaseClient";
import useAuthStore from "../store/authStore";

const VerifyEmailChange = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [status, setStatus] = useState("verifying"); // 'verifying' | 'success' | 'error'
  const [message, setMessage] = useState("Verifying your new email address...");
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    const verify = async () => {
      if (!token) {
        setStatus("error");
        setMessage("Missing verification token. Please use the link sent to your email.");
        return;
      }

      try {
        const res = await fetch(`${API_CONFIG.BACKEND_URL}/api/account/email-change/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.detail || "Verification link is invalid or expired.");
        }

        setNewEmail(data.new_email || "");
        setStatus("success");
        setMessage(data.message || "Your email address has been verified and updated.");

        await supabase.auth.refreshSession().catch(() => {});
        const user = useAuthStore.getState().user;
        if (user && data.new_email) {
          await useAuthStore.getState().getProfile({ ...user, email: data.new_email });
        }
      } catch (err) {
        setStatus("error");
        setMessage(err.message);
      }
    };
    verify();
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-8 shadow-xl text-center space-y-5">
        {status === "verifying" && (
          <>
            <Loader2 size={44} className="text-emerald-600 animate-spin mx-auto" />
            <h1 className="text-xl font-bold text-slate-900">Verifying Email Change</h1>
            <p className="text-sm text-slate-500">{message}</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-16 h-16 rounded-full bg-emerald-50 border-2 border-emerald-500 flex items-center justify-center mx-auto">
              <CheckCircle2 size={32} className="text-emerald-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">Email Verified &amp; Updated</h1>
            <p className="text-sm text-slate-600">
              {message}
              {newEmail ? (
                <>
                  <br />
                  <span className="font-mono font-semibold text-slate-900">{newEmail}</span>
                </>
              ) : null}
            </p>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition"
            >
              Continue to Account <ArrowRight size={16} />
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-16 h-16 rounded-full bg-red-50 border-2 border-red-400 flex items-center justify-center mx-auto">
              <AlertCircle size={32} className="text-red-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">Verification Failed</h1>
            <p className="text-sm text-slate-600">{message}</p>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition"
            >
              Return to Sign In
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default VerifyEmailChange;
