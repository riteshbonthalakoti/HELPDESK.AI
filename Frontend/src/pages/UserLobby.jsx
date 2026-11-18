import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import useAuthStore from "../store/authStore";
import { Clock, LogOut, ShieldAlert, CheckCircle2, MessageSquare } from "lucide-react";

/**
 * UserLobby — Waiting room for verified users pending company admin approval.
 * Route: /user-lobby
 */
function UserLobby() {
    const { profile, logout } = useAuthStore();
    const navigate = useNavigate();
    const [status, setStatus] = useState(profile?.status || "pending_approval");
    const [isTransitioning, setIsTransitioning] = useState(false);

    useEffect(() => {
        // Must be a regular user
        if (!profile || profile.role !== "user") {
            navigate("/login");
            return;
        }

        // Active users go to dashboard
        if (profile.status === "active") {
            navigate("/dashboard");
            return;
        }

        // --- Real-time Subscription to profile changes ---
        const channel = supabase
            .channel(`profile-user-lobby-${profile.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'profiles',
                    filter: `id=eq.${profile.id}`
                },
                (payload) => {
                    const newStatus = payload.new.status;
                    setStatus(newStatus);

                    if (newStatus === 'active') {
                        setIsTransitioning(true);
                        setTimeout(() => navigate('/dashboard'), 2000);
                    }
                }
            )
            .subscribe();

        // --- Polling backup (every 30 seconds) ---
        const pollInterval = setInterval(async () => {
            const { data } = await supabase
                .from('profiles')
                .select('status')
                .eq('id', profile.id)
                .single();

            if (data && data.status !== status) {
                setStatus(data.status);
                if (data.status === 'active') {
                    setIsTransitioning(true);
                    setTimeout(() => navigate('/dashboard'), 2000);
                }
            }
        }, 30000);

        return () => {
            supabase.removeChannel(channel);
            clearInterval(pollInterval);
        };
    }, [profile, navigate, status]);

    const handleLogout = async () => {
        await logout();
        navigate("/login");
    };

    const normalizedCompany = (profile?.company || "").trim().toUpperCase();
    const isRiteshPrivateLtd =
        normalizedCompany === "RITESH PVT LTD" ||
        normalizedCompany === "RITESH PRIVATE LIMITED";
    const adminPhone = "918464931322";
    const waMessage = `Hey Ritesh, I just verified my email and I want you to approve this email address. I registered to ${profile?.company || "my company"}. My email is: ${profile?.email}`;
    const whatsappUrl = `https://wa.me/${adminPhone}?text=${encodeURIComponent(waMessage)}`;

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 font-sans relative overflow-hidden">
            {/* Ambient glow - Emerald theme */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-600/5 rounded-full blur-[120px] pointer-events-none" />

            <div className="w-full max-w-lg bg-white border border-gray-100 rounded-3xl p-6 sm:p-10 md:p-12 shadow-2xl relative z-10 text-center">
                {isTransitioning ? (
                    <div className="py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="w-20 h-20 rounded-full bg-emerald-50 border-2 border-emerald-500 flex items-center justify-center mx-auto mb-6 shadow-sm">
                            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900 mb-2">Account Approved!</h2>
                        <p className="text-gray-500 text-sm">Redirecting to your dashboard...</p>
                    </div>
                ) : status === 'rejected' ? (
                    <div className="py-4">
                        <div className="w-16 h-16 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mx-auto mb-6">
                            <ShieldAlert className="w-8 h-8 text-red-500" />
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 mb-4">Registration Declined</h2>
                        <p className="text-gray-500 text-sm mb-8">
                            Unfortunately, your request to join your company has been declined by an administrator.
                        </p>
                        <button onClick={handleLogout} className="px-6 py-2 bg-white border border-gray-200 shadow-sm rounded-xl text-gray-700 text-sm hover:bg-gray-50 font-medium transition">
                            Return to Login
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center mx-auto mb-6 relative">
                            {/* Pulsing ring */}
                            <div className="absolute inset-0 border-2 border-amber-400 rounded-2xl animate-ping opacity-30"></div>
                            <Clock className="w-8 h-8 text-amber-500" />
                        </div>

                        <h1 className="text-2xl font-bold text-gray-900 mb-2">
                            {isRiteshPrivateLtd ? "Email Verified" : "Email Verified!"}
                        </h1>

                        <p className="text-gray-500 text-sm mb-8 leading-relaxed">
                            {isRiteshPrivateLtd ? (
                                <>
                                    You are now waiting for approval from the <span className="font-bold text-slate-800">Ritesh Private Limited</span> admin.
                                </>
                            ) : (
                                <>
                                    Your account is verified. We've notified your company administrators at <span className="font-semibold text-gray-800">{profile?.company || "your company"}</span>.
                                    You will receive an email once your account is approved.
                                </>
                            )}
                        </p>

                        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 mb-8">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">Account</span>
                                <span className="text-sm font-semibold text-gray-800">{profile?.full_name}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">Status</span>
                                <div className="flex items-center gap-2 bg-white border border-gray-100 shadow-sm px-2 py-1 rounded-md">
                                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                                    <span className="text-xs font-bold text-amber-600">Pending Review</span>
                                </div>
                            </div>
                        </div>

                        <div className="mb-6">
                            <a
                                href={whatsappUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-3 w-full px-4 py-4 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-2xl shadow-lg shadow-green-500/20 transition-all font-bold text-base group"
                            >
                                <MessageSquare className="w-5 h-5 fill-current" />
                                <span>Request Approval via WhatsApp</span>
                            </a>
                            <p className="mt-3 text-[11px] text-gray-400 font-medium">
                                Clicking above will open a direct chat with the admin.
                            </p>
                        </div>

                        <button
                            onClick={handleLogout}
                            className={`flex items-center justify-center gap-2 w-full px-4 py-3 bg-white border border-gray-200 shadow-sm rounded-xl text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-all text-sm font-semibold ${isRiteshPrivateLtd ? 'mt-4' : ''}`}
                        >
                            <LogOut className="w-4 h-4" />
                            Sign Out
                        </button>
                        <button
                            onClick={handleLogout}
                            className="mt-4 text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors underline underline-offset-4"
                        >
                            Not you? Go back
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

export default UserLobby;
