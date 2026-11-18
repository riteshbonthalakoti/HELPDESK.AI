import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ticket, Clock, CheckCircle2 } from 'lucide-react';
import WelcomeCard from "../components/WelcomeCard";
import QuickActions from "../components/QuickActions";
import RecentTickets from "../components/RecentTickets";
import OnboardingTour from "../components/OnboardingTour";
import { supabase } from "../../lib/supabaseClient";
import useAuthStore from "../../store/authStore";

const Dashboard = () => {
    const navigate = useNavigate();
    const { profile, user } = useAuthStore();
    const userName = profile?.full_name || "Guest";
    const [stats, setStats] = useState({ total: 0, active: 0, resolved: 0 });

    useEffect(() => {
        const loadStats = async () => {
            if (!user?.id) return;
            const { data } = await supabase
                .from('tickets')
                .select('status')
                .eq('user_id', user.id);
            if (!data) return;
            const total = data.length;
            const resolved = data.filter(
                (t) =>
                    String(t.status || '').toLowerCase().includes('resolv') ||
                    String(t.status || '').toLowerCase().includes('closed')
            ).length;
            setStats({ total, resolved, active: Math.max(0, total - resolved) });
        };
        loadStats();
    }, [user?.id]);

    return (
        <div
            className="min-h-[100dvh] pb-8 md:pb-20 relative"
            style={{
                background: `
                    radial-gradient(circle at top right, rgba(16,185,129,0.08), transparent 55%),
                    #F6F8F7
                `,
            }}
        >
            <main className="pt-4 sm:pt-8 md:pt-10 px-4 sm:px-6 md:px-10">
                <div className="w-full max-w-[1100px] mx-auto flex flex-col gap-5 sm:gap-7 md:gap-8">
                    {/* Hero Section */}
                    <section>
                        <WelcomeCard userName={userName} companyName={profile?.company || 'RITESH PVT LTD'} />
                    </section>

                    {/* Mobile-First Live Snapshot Strip */}
                    <section className="grid grid-cols-3 gap-2.5 sm:gap-4">
                        <button
                            type="button"
                            onClick={() => navigate('/my-tickets')}
                            className="bg-white rounded-2xl p-3.5 sm:p-5 border border-emerald-950/[0.06] shadow-xs text-left active:scale-[0.97] transition-all hover:border-emerald-200"
                        >
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                                    Total
                                </span>
                                <span className="w-7 h-7 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                                    <Ticket size={14} />
                                </span>
                            </div>
                            <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums leading-none">
                                {stats.total}
                            </p>
                            <p className="text-[11px] text-slate-400 font-medium mt-1 truncate">All requests</p>
                        </button>

                        <button
                            type="button"
                            onClick={() => navigate('/my-tickets')}
                            className="bg-white rounded-2xl p-3.5 sm:p-5 border border-amber-200/60 shadow-xs text-left active:scale-[0.97] transition-all hover:border-amber-300"
                        >
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-amber-600/80">
                                    Active
                                </span>
                                <span className="w-7 h-7 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                                    <Clock size={14} />
                                </span>
                            </div>
                            <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums leading-none">
                                {stats.active}
                            </p>
                            <p className="text-[11px] text-slate-400 font-medium mt-1 truncate">In progress</p>
                        </button>

                        <button
                            type="button"
                            onClick={() => navigate('/my-tickets')}
                            className="bg-white rounded-2xl p-3.5 sm:p-5 border border-emerald-200/70 shadow-xs text-left active:scale-[0.97] transition-all hover:border-emerald-300"
                        >
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-emerald-600">
                                    Solved
                                </span>
                                <span className="w-7 h-7 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                                    <CheckCircle2 size={14} />
                                </span>
                            </div>
                            <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums leading-none">
                                {stats.resolved}
                            </p>
                            <p className="text-[11px] text-slate-400 font-medium mt-1 truncate">Completed</p>
                        </button>
                    </section>

                    {/* Quick Actions Grid */}
                    <section id="tour-quick-actions">
                        <div className="flex items-center justify-between mb-3 px-1">
                            <h2 className="text-[11px] tracking-[0.14em] text-slate-400 font-bold uppercase">
                                Quick Support Actions
                            </h2>
                        </div>
                        <QuickActions />
                    </section>

                    {/* Recent Activity */}
                    <section id="tour-recent-tickets">
                        <RecentTickets />
                    </section>

                    <footer className="mt-2 sm:mt-6 text-center pb-2">
                        <p className="text-xs text-slate-400 font-medium tracking-tight">
                            &copy; {new Date().getFullYear()} {profile?.company || 'RITESH PVT LTD'}. All systems operational.
                        </p>
                    </footer>
                </div>
            </main>
            <OnboardingTour />
        </div>
    );
};

export default Dashboard;
