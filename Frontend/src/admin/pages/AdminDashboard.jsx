import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity } from 'lucide-react';

import useAuthStore from "../../store/authStore";
import { supabase } from "../../lib/supabaseClient";
import StatCard from "../components/StatCard";
import TicketTable from "../components/TicketTable";
import { formatTimelineDate } from "../../utils/dateUtils";

// Inline SVG icon components
const TicketIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
        <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
    </svg>
);
const ActivityIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
);
const CpuIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>
        <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
        <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
        <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>
        <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
    </svg>
);
const UsersIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
);

// AI subsystem icons
const ClassifierIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
    </svg>
);
const PriorityIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
        <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
);
const SemanticIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
    </svg>
);
const DuplicateIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="8" y="8" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
);

const aiIconMap = [
    { icon: <ClassifierIcon />, bg: '#F0FDF4', color: '#16a34a' },
    { icon: <PriorityIcon />, bg: '#EFF6FF', color: '#3b82f6' },
    { icon: <SemanticIcon />, bg: '#F5F0FF', color: '#8b5cf6' },
    { icon: <DuplicateIcon />, bg: '#FFF7ED', color: '#f97316' },
];

const AdminDashboard = () => {
    const navigate = useNavigate();
    const { profile } = useAuthStore();
    const [tickets, setTickets] = React.useState([]);
    const [isLoading, setIsLoading] = React.useState(true);

    React.useEffect(() => {
        if (profile) {
            const fetchStats = async () => {
                setIsLoading(true);
                try {
                    let query = supabase
                        .from('tickets')
                        .select(`
                    *,
                    creator:profiles!tickets_user_id_fkey(full_name, email, profile_picture)
                `)
                        .order('created_at', { ascending: false });
                    if (profile?.role === 'admin' && profile?.company) query = query.eq('company', profile.company);
                    const { data, error } = await query;
                    if (error) {
                        // Secondary check: If the relation fails, try a simpler select
                        console.warn("Retrying dashboard fetch without relation...", error);
                        const { data: basicData, error: basicError } = await supabase.from('tickets').select('*').eq('company', profile?.company).order('created_at', { ascending: false });
                        if (basicError) throw basicError;
                        setTickets(basicData || []);
                    } else {
                        setTickets(data || []);
                    }
                } catch (err) { console.error("Dashboard fetch error:", err); }
                finally { setIsLoading(false); }
            };

            fetchStats();
            const interval = setInterval(fetchStats, 30000);
            return () => clearInterval(interval);
        }
    }, [profile]);

    const metrics = useMemo(() => {
        const total = tickets.length;
        const active = tickets.filter(t => !t.status?.toLowerCase()?.includes('resolv') && !t.status?.toLowerCase()?.includes('closed')).length;
        const autoResolved = tickets.filter(t => t.status?.toLowerCase()?.includes('auto')).length;
        const humanEscalated = tickets.filter(t => t.status?.toLowerCase()?.includes('progress') || t.status?.toLowerCase()?.includes('escalat')).length;
        return { total, active, autoResolved, humanEscalated };
    }, [tickets]);

    const aiSubsystems = useMemo(() => {
        const totalCount = tickets.length || 1;
        const categorized = tickets.filter(t => t.category && t.category.toLowerCase() !== 'unassigned' && t.category !== 'Other').length;
        const prioritized = tickets.filter(t => t.priority).length;
        return [
            { name: 'Classifier Engine', status: categorized > 0 ? 'Active' : 'Standby', latency: `${((categorized / totalCount) * 100).toFixed(0)}% Coverage` },
            { name: 'Priority Routing', status: prioritized > 0 ? 'Active' : 'Standby', latency: `${((prioritized / totalCount) * 100).toFixed(0)}% Routed` },
            { name: 'Semantic Analysis', status: tickets.length > 0 ? 'Active' : 'Standby', latency: `${tickets.length} Scanned` },
            { name: 'Duplicate Detection', status: 'Active', latency: 'Optimal' },
        ];
    }, [tickets]);

    return (
        <div className="space-y-6 md:space-y-9 pb-6">
            {/* Header — Sleek Dark Command Banner on Mobile, Crisp Editorial Header on Desktop */}
            <div className="rounded-3xl md:rounded-none p-5 md:p-0 bg-gradient-to-br from-[#0b1f17] via-[#0f2c1f] to-[#064e3b] md:bg-none text-white md:text-[#0f1f12] shadow-lg shadow-emerald-950/15 md:shadow-none flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 relative overflow-hidden">
                <div className="md:hidden pointer-events-none absolute -right-10 -top-10 w-36 h-36 rounded-full bg-emerald-400/20 blur-2xl" />
                <div className="relative z-10">
                    <p className="md:hidden text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300/90 mb-1">
                        {profile?.company || 'RITESH PVT LTD'} · Admin Console
                    </p>
                    <h1
                        className="text-2xl sm:text-[26px] font-extrabold tracking-tight m-0 text-white md:text-[#0f1f12]"
                        style={{ fontFamily: 'Syne, sans-serif' }}
                    >
                        Dashboard
                    </h1>
                    <p className="text-emerald-100/80 md:text-slate-500 text-xs sm:text-[13px] mt-1 flex items-center gap-2 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 md:bg-green-500 inline-block animate-pulse" />
                        Real-time updates active
                    </p>
                </div>
                <div className="relative z-10 self-start sm:self-auto inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-400/15 border border-emerald-400/30 md:bg-[#F0FDF4] md:border-[#BBF7D0]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 md:bg-green-500 inline-block" style={{ animation: 'pulse-dot 2s infinite' }} />
                    <span className="text-[10px] sm:text-[11px] font-bold text-emerald-200 md:text-[#15803d] tracking-[0.08em] uppercase">
                        System Active
                    </span>
                </div>
            </div>

            {/* KPIs — Dense 2x2 Bento Grid on Mobile, 4-Column Row on Desktop */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5 md:gap-6">
                <button type="button" onClick={() => navigate('/admin/tickets')} className="text-left group focus:outline-none">
                    <StatCard label="Total Tickets" value={metrics.total} color="indigo" subtitle="Lifetime generated" customIcon={<TicketIcon />} />
                </button>
                <button type="button" onClick={() => navigate('/admin/tickets')} className="text-left group focus:outline-none">
                    <StatCard label="Active Tickets" value={metrics.active} color="amber" subtitle="Need attention" customIcon={<ActivityIcon />} />
                </button>
                <button type="button" onClick={() => navigate('/admin/tickets?filter=auto')} className="text-left group focus:outline-none">
                    <StatCard label="Auto-Resolved" value={metrics.autoResolved} color="emerald" subtitle="Resolved by AI" customIcon={<CpuIcon />} />
                </button>
                <button type="button" onClick={() => navigate('/admin/tickets?filter=human')} className="text-left group focus:outline-none">
                    <StatCard label="Escalated" value={metrics.humanEscalated} color="red" subtitle="Needs agent" customIcon={<UsersIcon />} />
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10">
                {/* Recent Activity */}
                <div className="lg:col-span-8 space-y-4 sm:space-y-5">
                    <div className="flex items-center justify-between px-1">
                        <h2 style={{ fontFamily: 'Syne, sans-serif' }} className="text-[15px] font-bold text-[#0f1f12] flex items-center gap-2">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                            Recent Tickets
                        </h2>
                        <button
                            type="button"
                            onClick={() => navigate('/admin/tickets')}
                            className="text-xs font-bold text-emerald-600 hover:text-emerald-700"
                        >
                            View All →
                        </button>
                    </div>
                    <div className="bg-white rounded-3xl md:rounded-[20px] border border-emerald-950/[0.06] shadow-xs md:shadow-[0_2px_16px_rgba(0,0,0,0.05)] overflow-hidden">
                        <TicketTable tickets={tickets} limit={10} isLoading={isLoading} />
                    </div>
                </div>

                {/* AI System Health */}
                <div className="lg:col-span-4 space-y-4 sm:space-y-5">
                    <div className="px-1 flex items-center justify-between">
                        <h2 style={{ fontFamily: 'Syne, sans-serif' }} className="text-[15px] font-bold text-[#0f1f12] flex items-center gap-2">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
                            AI Status
                        </h2>
                        <div className="inline-flex items-center gap-1.5 bg-[#F0FDF4] border border-[#BBF7D0] rounded-full px-2.5 py-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" style={{ animation: 'pulse-dot 2s infinite' }} />
                            <span className="text-[10px] font-bold text-[#15803d]">LIVE SYNC</span>
                        </div>
                    </div>
                    <div className="bg-white rounded-3xl md:rounded-[20px] border border-emerald-950/[0.06] p-4 sm:p-6 shadow-xs">
                        <div className="space-y-3">
                            {aiSubsystems.map((sub, idx) => (
                                <div key={idx} className="flex items-center justify-between gap-2 p-3.5 sm:p-4 rounded-2xl border border-gray-100 bg-[#f8faf9] transition-all hover:bg-white hover:border-green-100">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div style={{ background: aiIconMap[idx].bg, color: aiIconMap[idx].color }} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0">
                                            {aiIconMap[idx].icon}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[13px] font-semibold text-gray-900 m-0 truncate">{sub.name}</p>
                                            <p className="text-[11px] text-gray-500 mt-0.5 truncate">{sub.latency}</p>
                                        </div>
                                    </div>
                                    <div
                                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full shrink-0 border ${
                                            sub.status === 'Active'
                                                ? 'bg-emerald-100/80 text-emerald-700 border-emerald-200'
                                                : 'bg-gray-100 text-gray-500 border-gray-200'
                                        }`}
                                    >
                                        <div className={`w-1.5 h-1.5 rounded-full ${sub.status === 'Active' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                        <span className="text-[10px] font-bold uppercase">{sub.status}</span>
                                    </div>
                                </div>
                            ))}
                            <div className="pt-4 mt-2 border-t border-gray-100 flex flex-col items-center gap-2">
                                <p className="text-[10px] text-gray-400 tracking-[0.14em] font-semibold uppercase">All systems operating normally</p>
                                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#f8faf9] rounded-full border border-gray-200">
                                    <Activity size={10} color="#9ca3af" />
                                    <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">
                                        Last Synced: {formatTimelineDate(new Date())}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Pulse dot animation */}
            <style>{`
                @keyframes pulse-dot {
                    0%, 100% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.4); opacity: 0.7; }
                }
            `}</style>
        </div>
    );
};

export default AdminDashboard;
