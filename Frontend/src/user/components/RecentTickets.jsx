import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, ChevronRight, Inbox, AlertCircle } from 'lucide-react';
import useAuthStore from '../../store/authStore';
import { supabase } from '../../lib/supabaseClient';
import { formatTimelineDate } from '../../utils/dateUtils';
import { formatTicketId } from '../../utils/format';

const RecentTickets = () => {
    const navigate = useNavigate();
    const { user } = useAuthStore();
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchRecentTickets = async () => {
        if (!user?.id) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const { data, error: sbError } = await supabase
                .from('tickets')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(5);

            if (sbError) throw sbError;
            setTickets(data || []);
        } catch (err) {
            console.error("Error fetching recent tickets:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRecentTickets();
    }, [user?.id]);

    const getStatusBadge = (status) => {
        const s = String(status || '').toLowerCase();
        const base = 'rounded-full px-2.5 py-0.5 text-[11px] font-bold inline-flex items-center gap-1 border';
        if (s.includes('resolv') || s.includes('closed')) {
            return <span className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}>Resolved</span>;
        }
        if (s.includes('pending')) {
            return <span className={`${base} bg-amber-50 text-amber-800 border-amber-200`}>Pending</span>;
        }
        if (s.includes('progress')) {
            return <span className={`${base} bg-blue-50 text-blue-700 border-blue-200`}>In Progress</span>;
        }
        return <span className={`${base} bg-sky-50 text-sky-700 border-sky-200`}>{status || 'Open'}</span>;
    };

    return (
        <div className="bg-white rounded-3xl md:rounded-[20px] border border-emerald-950/[0.06] shadow-xs md:shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
            {/* Header */}
            <div className="px-4 sm:px-6 md:px-7 py-4 md:py-5 border-b border-emerald-50 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Clock size={18} className="text-emerald-500" />
                    <span
                        className="text-base md:text-[17px] font-bold text-[#0f1f12]"
                        style={{ fontFamily: 'Syne, sans-serif' }}
                    >
                        Recent Tickets
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => navigate('/my-tickets')}
                    className="text-emerald-600 hover:text-emerald-700 text-xs sm:text-[13px] font-bold cursor-pointer"
                >
                    View All →
                </button>
            </div>

            {/* Content */}
            <div className={loading || error || tickets.length === 0 ? 'p-5 md:p-7' : ''}>
                {loading ? (
                    <div className="flex flex-col gap-3">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="h-16 bg-slate-100/80 rounded-2xl animate-pulse" />
                        ))}
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center text-red-500 bg-red-50/50 rounded-2xl border border-dashed border-red-200">
                        <AlertCircle size={30} className="mb-2 opacity-60" />
                        <p className="text-sm font-bold">Sync Failed</p>
                        <p className="text-xs mt-1 text-red-400">{error}</p>
                    </div>
                ) : tickets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center text-slate-500 bg-slate-50/60 rounded-2xl border border-dashed border-slate-200 px-4">
                        <Inbox size={30} className="mb-2 opacity-30" />
                        <p className="text-sm font-semibold text-slate-700">No tickets yet</p>
                        <p className="text-xs mt-1 max-w-xs">Report an issue and our AI will start helping immediately.</p>
                    </div>
                ) : (
                    <>
                        {/* Mobile Native Card List (< md) */}
                        <div className="md:hidden divide-y divide-slate-100">
                            {tickets.map((ticket) => (
                                <button
                                    type="button"
                                    key={ticket.id}
                                    onClick={() => navigate(`/ticket/${ticket.id}`)}
                                    className="w-full text-left px-4 py-3.5 flex items-start gap-3 active:bg-emerald-50/50 transition-colors"
                                >
                                    <div className="flex-1 min-w-0 space-y-1.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                                                #{formatTicketId(ticket.id)}
                                            </span>
                                            {getStatusBadge(ticket.status)}
                                        </div>
                                        <p className="text-sm font-semibold text-slate-900 line-clamp-2 leading-snug">
                                            {ticket.summary || ticket.subject || ticket.description || "No description provided"}
                                        </p>
                                        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
                                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-semibold">
                                                {ticket.category || 'General'}
                                            </span>
                                            <span>•</span>
                                            <span className="truncate">{formatTimelineDate(ticket.created_at)}</span>
                                        </div>
                                    </div>
                                    <ChevronRight size={17} className="text-slate-300 shrink-0 mt-1" />
                                </button>
                            ))}
                        </div>

                        {/* Desktop Table (>= md) */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-[#fafafa] border-b border-[#f0fdf4]">
                                        <th className="text-[11px] tracking-[0.1em] text-gray-400 font-semibold uppercase py-2.5 px-7">ID</th>
                                        <th className="text-[11px] tracking-[0.1em] text-gray-400 font-semibold uppercase py-2.5 px-7">Subject</th>
                                        <th className="text-[11px] tracking-[0.1em] text-gray-400 font-semibold uppercase py-2.5 px-7">Status</th>
                                        <th className="text-[11px] tracking-[0.1em] text-gray-400 font-semibold uppercase py-2.5 px-7">Submitted</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tickets.map((ticket) => (
                                        <tr
                                            key={ticket.id}
                                            onClick={() => navigate(`/ticket/${ticket.id}`)}
                                            className="border-b border-gray-50 cursor-pointer hover:bg-emerald-50/60 transition-colors"
                                        >
                                            <td className="py-4 px-7">
                                                <span className="font-mono text-xs font-semibold text-emerald-600">
                                                    #{formatTicketId(ticket.id)}
                                                </span>
                                            </td>
                                            <td className="py-4 px-7">
                                                <p className="text-sm font-medium text-gray-900 m-0 truncate max-w-[320px]">
                                                    {ticket.summary || ticket.subject || ticket.description || "No description provided"}
                                                </p>
                                            </td>
                                            <td className="py-4 px-7">
                                                {getStatusBadge(ticket.status)}
                                            </td>
                                            <td className="py-4 px-7 whitespace-nowrap">
                                                <span className="text-gray-500 text-xs">
                                                    {formatTimelineDate(ticket.created_at)}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default RecentTickets;
