import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PlusCircle, ListTodo, Sparkles, ArrowUpRight } from 'lucide-react';

const WelcomeCard = ({ userName = "Ritesh", companyName = "RITESH PVT LTD" }) => {
    const navigate = useNavigate();
    const firstName = String(userName || "Guest").split(" ")[0];

    return (
        <div
            id="tour-welcome"
            className="relative overflow-hidden rounded-3xl p-5 sm:p-8 md:p-10 bg-gradient-to-br from-[#0b1f17] via-[#0f2e22] to-[#064e3b] md:bg-none md:bg-white md:border-l-4 md:border-l-emerald-500 border border-emerald-900/20 md:border-emerald-100 shadow-xl shadow-emerald-950/15 md:shadow-[0_2px_24px_rgba(0,0,0,0.06)]"
        >
            {/* Mobile ambient glow */}
            <div className="md:hidden pointer-events-none absolute -top-16 -right-16 w-48 h-48 rounded-full bg-emerald-400/20 blur-3xl" />
            <div className="md:hidden pointer-events-none absolute -bottom-16 -left-10 w-40 h-40 rounded-full bg-teal-400/15 blur-2xl" />

            <div className="relative z-10">
                {/* Badge row */}
                <div className="flex items-center justify-between gap-2 mb-3.5 sm:mb-4">
                    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold tracking-wider uppercase bg-emerald-400/15 text-emerald-300 border border-emerald-400/25 md:bg-[#EDFAF3] md:text-[#16a34a] md:border-[#bbf7d0]">
                        <Sparkles size={12} className="fill-current" />
                        AI-Enhanced Support
                    </span>
                    <span className="md:hidden inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-200/80 uppercase tracking-widest">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Live
                    </span>
                </div>

                {/* Heading */}
                <h2
                    className="text-2xl sm:text-3xl md:text-[34px] font-extrabold tracking-tight leading-tight text-white md:text-[#0f1f12] mb-2"
                    style={{ fontFamily: 'Syne, sans-serif' }}
                >
                    <span className="md:hidden">Hi {firstName}, need help?</span>
                    <span className="hidden md:inline">Welcome back, {userName}</span>
                </h2>

                {/* Description */}
                <p className="text-emerald-100/80 md:text-[#6b7280] text-sm sm:text-[15px] max-w-[520px] mb-5 sm:mb-7 leading-relaxed">
                    Our AI assistant for <span className="font-semibold text-white md:text-slate-800">{companyName}</span> analyzes and resolves most issues in under 5 minutes.
                </p>

                {/* CTA Buttons */}
                <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2.5 sm:gap-3">
                    <button
                        id="tour-create-ticket"
                        type="button"
                        onClick={() => navigate('/create-ticket')}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl sm:rounded-xl px-5 py-3.5 sm:py-3 font-bold text-sm text-emerald-950 md:text-white bg-emerald-400 hover:bg-emerald-300 md:bg-gradient-to-br md:from-emerald-600 md:to-emerald-500 shadow-lg shadow-emerald-950/20 md:shadow-emerald-600/25 active:scale-[0.98] transition-all cursor-pointer"
                    >
                        <PlusCircle size={18} />
                        <span>Report New Issue</span>
                        <ArrowUpRight size={16} className="sm:hidden ml-auto opacity-75" />
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/my-tickets')}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl sm:rounded-xl px-5 py-3 font-semibold text-sm text-emerald-100 md:text-emerald-700 bg-white/10 hover:bg-white/15 md:bg-white md:hover:bg-emerald-50 border border-white/15 md:border-emerald-200 active:scale-[0.98] transition-all cursor-pointer"
                    >
                        <ListTodo size={18} />
                        <span>View My Tickets</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WelcomeCard;
