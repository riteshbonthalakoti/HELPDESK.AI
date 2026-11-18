import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Clock, ExternalLink, ChevronRight } from 'lucide-react';
import { formatTimelineDate } from '../../utils/dateUtils';

const categoryDotColors = {
    'Hardware': '#f97316',
    'Network': '#3b82f6',
    'Access': '#8b5cf6',
    'Software': '#16a34a',
    'Human Resources': '#ec4899',
    'Other': '#6b7280'
};

const TicketTable = ({ tickets = [], isLoading = false, limit = null }) => {
    const navigate = useNavigate();

    const teamMap = {
        'Network': 'Network Services', 'Hardware': 'IT Inventory', 'Software': 'Cloud Apps Team',
        'Access': 'Security Ops', 'Human Resources': 'HR Systems', 'Other': 'IT Service Desk'
    };

    const getPriorityStyle = (priority) => {
        const p = priority?.toLowerCase();
        if (p === 'critical') return { background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' };
        if (p === 'high') return { background: '#FFF7ED', color: '#EA580C', border: '1px solid #FED7AA' };
        if (p === 'medium') return { background: '#FEFCE8', color: '#CA8A04', border: '1px solid #FDE68A' };
        return { background: '#F0FDF4', color: '#16A34A', border: '1px solid #BBF7D0' };
    };

    const getStatusStyle = (status) => {
        const s = status?.toLowerCase() || '';
        if (s.includes('resolv')) return { bg: '#f1f5f9', text: '#64748b', border: '#e2e8f0' };
        if (s.includes('progress')) return { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' };
        return { bg: '#fffbeb', text: '#d97706', border: '#fde68a' };
    };

    const displayTickets = limit ? tickets.slice(0, limit) : tickets;

    if (isLoading) return (
        <div className="py-16 md:py-24 text-center">
            <div className="w-9 h-9 border-[3px] border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-[11px] font-semibold uppercase tracking-widest">Synchronizing System Data...</p>
        </div>
    );

    if (displayTickets.length === 0) return (
        <div className="py-16 md:py-24 text-center border-2 border-dashed border-gray-200 rounded-2xl m-4">
            <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3 text-emerald-300">
                <ShieldCheck size={28} />
            </div>
            <h3 className="text-base font-bold text-gray-900 mb-1">No Active Tickets</h3>
            <p className="text-xs sm:text-sm text-gray-500 px-4">All systems green. No tickets require review.</p>
        </div>
    );

    return (
        <>
            {/* Mobile Native Ticket Cards (< md) */}
            <div className="md:hidden divide-y divide-slate-100">
                {displayTickets.map((ticket) => {
                    const effectiveCategory = ticket.correction?.corrected_category || ticket.category || 'General';
                    const effectivePriority = ticket.correction?.corrected_priority || ticket.priority || 'NORMAL';
                    const effectiveTeam = ticket.reassigned_at
                        ? ticket.assigned_team
                        : (teamMap[effectiveCategory] || ticket.assigned_team || 'L1 Helpdesk');
                    const statusSt = getStatusStyle(ticket.status);
                    const subject = ticket.subject || ticket.summary || 'Untitled ticket';
                    const tid = String(ticket.ticket_id || ticket.id || '');
                    const truncId = tid.length > 8 ? tid.slice(0, 8) : tid;
                    const userProfile = ticket.creator || ticket.profiles;
                    const userName = userProfile?.full_name || ticket.user_name || 'User';
                    const initial = userName.charAt(0).toUpperCase();
                    const profilePic = userProfile?.profile_picture;

                    return (
                        <button
                            type="button"
                            key={ticket.ticket_id || ticket.id}
                            onClick={() => navigate(`/admin/ticket/${ticket.ticket_id || ticket.id}`)}
                            className="w-full text-left p-4 flex items-start gap-3 active:bg-emerald-50/50 transition-colors"
                        >
                            {profilePic ? (
                                <img
                                    src={profilePic}
                                    alt={userName}
                                    className="w-10 h-10 rounded-xl object-cover border border-emerald-100 shrink-0 mt-0.5"
                                />
                            ) : (
                                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
                                    <span className="text-emerald-700 text-sm font-bold">{initial}</span>
                                </div>
                            )}

                            <div className="flex-1 min-w-0 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="font-mono text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                                            #{truncId}
                                        </span>
                                        <span
                                            style={getPriorityStyle(effectivePriority)}
                                            className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                                        >
                                            {effectivePriority}
                                        </span>
                                    </div>
                                    <span
                                        style={{ background: statusSt.bg, color: statusSt.text, border: `1px solid ${statusSt.border}` }}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0"
                                    >
                                        {ticket.status?.replace('by Human Support', '').trim() || 'Open'}
                                    </span>
                                </div>

                                <p className="text-sm font-bold text-slate-900 line-clamp-2 leading-snug">
                                    {subject}
                                </p>

                                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span
                                            style={{ background: categoryDotColors[effectiveCategory] || '#6b7280' }}
                                            className="w-2 h-2 rounded-full shrink-0"
                                        />
                                        <span className="font-semibold text-slate-600 truncate">{effectiveCategory}</span>
                                        <span className="text-slate-300">·</span>
                                        <span className="truncate">{effectiveTeam}</span>
                                    </div>
                                    <span className="text-[10px] text-slate-400 shrink-0 flex items-center gap-0.5">
                                        <Clock size={10} />
                                        {formatTimelineDate(ticket.created_at || ticket.createdAt || ticket.timestamp)}
                                    </span>
                                </div>
                            </div>

                            <ChevronRight size={16} className="text-slate-300 shrink-0 mt-2" />
                        </button>
                    );
                })}
            </div>

            {/* Desktop Table (>= md) */}
            <div className="hidden md:block overflow-x-auto custom-scrollbar">
                <table className="w-full border-collapse">
                    <thead>
                        <tr style={{ background: '#f8faf9', borderBottom: '1px solid #f0fdf4' }}>
                            {['Ticket ID', 'Ticket Info', 'Category', 'Priority', 'Assigned Team', 'Status'].map((h, i) => (
                                <th key={i} style={{ padding: '14px 24px', textAlign: 'left', fontSize: '10px', color: '#9ca3af', letterSpacing: '0.1em', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {displayTickets.map((ticket) => {
                            const effectiveCategory = ticket.correction?.corrected_category || ticket.category;
                            const effectiveSubcategory = ticket.correction?.corrected_subcategory || ticket.subcategory;
                            const effectivePriority = ticket.correction?.corrected_priority || ticket.priority;
                            const effectiveTeam = ticket.reassigned_at
                                ? ticket.assigned_team
                                : (teamMap[effectiveCategory] || ticket.assigned_team || 'L1 Helpdesk');
                            const statusSt = getStatusStyle(ticket.status);

                            const subject = ticket.subject || ticket.summary || 'Untitled ticket';
                            const truncSubject = subject.length > 28 ? subject.slice(0, 28) + '...' : subject;

                            const tid = String(ticket.ticket_id || ticket.id || '');
                            const truncId = tid.length > 8 ? tid.slice(0, 8) + '...' : tid;

                            const userProfile = ticket.creator || ticket.profiles;
                            const userName = userProfile?.full_name || ticket.user_name || 'User';
                            const initial = userName.charAt(0).toUpperCase();
                            const profilePic = userProfile?.profile_picture;

                            return (
                                <tr
                                    key={ticket.ticket_id || ticket.id}
                                    onClick={() => navigate(`/admin/ticket/${ticket.ticket_id || ticket.id}`)}
                                    className="cursor-pointer group transition-colors hover:bg-[#f0fdf4]"
                                    style={{ borderBottom: '1px solid #f9fafb' }}
                                >
                                    <td style={{ padding: '14px 24px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <div className="flex items-center gap-2">
                                                <span style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 700, color: '#16a34a' }}>#{truncId}</span>
                                                <div className="opacity-0 group-hover:opacity-100 transition-opacity text-emerald-400">
                                                    <ExternalLink size={12} />
                                                </div>
                                            </div>
                                            <span style={{ fontSize: '11px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <Clock size={10} color="#d1d5db" />
                                                {formatTimelineDate(ticket.created_at || ticket.createdAt || ticket.timestamp)}
                                            </span>
                                        </div>
                                    </td>
                                    <td style={{ padding: '14px 24px' }}>
                                        <div className="flex items-center gap-3">
                                            {profilePic ? (
                                                <img
                                                    src={profilePic}
                                                    alt={userName}
                                                    style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '1px solid #d1fae5', flexShrink: 0 }}
                                                />
                                            ) : (
                                                <div style={{ width: 32, height: 32, background: '#f0fdf4', border: '1px solid #d1fae5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                    <span style={{ color: '#16a34a', fontSize: '12px', fontWeight: 600 }}>{initial}</span>
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '220px' }}>
                                                <span style={{ fontSize: '13px', fontWeight: 500, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {truncSubject}
                                                </span>
                                                <span style={{ fontSize: '11px', color: '#6b7280' }}>
                                                    {effectiveCategory || 'General'}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ padding: '14px 24px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '4px 10px', fontSize: '11px', fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', width: 'fit-content' }}>
                                                <span style={{ width: 4, height: 4, borderRadius: '50%', background: categoryDotColors[effectiveCategory] || '#6b7280', display: 'inline-block' }}></span>
                                                {effectiveCategory}
                                            </span>
                                            {effectiveSubcategory && <span style={{ fontSize: '10px', color: '#9ca3af', marginLeft: '4px' }}>{effectiveSubcategory}</span>}
                                        </div>
                                    </td>
                                    <td style={{ padding: '14px 24px' }}>
                                        <span style={{
                                            ...getPriorityStyle(effectivePriority),
                                            padding: '3px 12px', borderRadius: '100px', fontSize: '11px',
                                            fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'inline-block'
                                        }}>
                                            {effectivePriority || 'NORMAL'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '14px 24px' }}>
                                        <div className="flex items-center gap-2">
                                            <div style={{ width: 28, height: 28, background: '#f0fdf4', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #d1fae5' }}>
                                                <span style={{ fontSize: '10px', fontWeight: 700, color: '#16a34a' }}>{effectiveTeam?.charAt(0)}</span>
                                            </div>
                                            <span style={{ fontSize: '12px', fontWeight: 500, color: '#374151', whiteSpace: 'nowrap' }}>{effectiveTeam}</span>
                                        </div>
                                    </td>
                                    <td style={{ padding: '14px 24px' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', borderRadius: '100px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', background: statusSt.bg, color: statusSt.text, border: `1px solid ${statusSt.border}` }}>
                                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', opacity: ticket.status?.includes('Resolv') ? 0.4 : 1 }}></span>
                                            {ticket.status?.replace('by Human Support', '').trim()}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </>
    );
};

export default TicketTable;
