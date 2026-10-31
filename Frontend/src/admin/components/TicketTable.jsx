import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Clock, ExternalLink } from 'lucide-react';
import { formatTimelineDate } from '../../utils/dateUtils';
import SLATargetClock from './SLATargetClock';

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
        <div className="py-24 text-center">
            <div style={{ width: 40, height: 40, border: '3px solid #16a34a', borderTopColor: 'transparent', borderRadius: '50%' }} className="animate-spin mx-auto mb-4"></div>
            <p style={{ color: '#9ca3af', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Synchronizing System Data...</p>
        </div>
    );

    if (displayTickets.length === 0) return (
        <div className="py-24 text-center" style={{ border: '2px dashed #e5e7eb', borderRadius: '16px', margin: '16px' }}>
            <div style={{ width: 64, height: 64, background: '#f0fdf4', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#bbf7d0' }}>
                <ShieldCheck size={32} />
            </div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>No Active Tickets</h3>
            <p style={{ fontSize: '13px', color: '#6b7280' }}>All systems green. No tickets require review.</p>
        </div>
    );

    return (
        <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full border-collapse">
                <thead>
                    <tr style={{ background: '#f8faf9', borderBottom: '1px solid #f0fdf4' }}>
                        {['Ticket ID', 'Ticket Info', 'Category', 'Priority', 'Assigned Team', 'SLA Target', 'Status'].map((h, i) => (
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

                        // Truncated subject
                        const subject = ticket.subject || ticket.summary || 'Untitled ticket';
                        const truncSubject = subject.length > 28 ? subject.slice(0, 28) + '...' : subject;

                        // Ticket ID truncated
                        const tid = ticket.ticket_id || ticket.id || '';
                        const truncId = tid.length > 8 ? tid.slice(0, 8) + '...' : tid;

                        // User initial
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
                                {/* Request Identity */}
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

                                {/* Incident Context - FIXED */}
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

                                {/* Category with colored dot */}
                                <td style={{ padding: '14px 24px' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '4px 10px', fontSize: '11px', fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', width: 'fit-content' }}>
                                            <span style={{ width: 4, height: 4, borderRadius: '50%', background: categoryDotColors[effectiveCategory] || '#6b7280', display: 'inline-block' }}></span>
                                            {effectiveCategory}
                                        </span>
                                        {effectiveSubcategory && <span style={{ fontSize: '10px', color: '#9ca3af', marginLeft: '4px' }}>{effectiveSubcategory}</span>}
                                    </div>
                                </td>

                                {/* Risk Factor */}
                                <td style={{ padding: '14px 24px' }}>
                                    <span style={{
                                        ...getPriorityStyle(effectivePriority),
                                        padding: '3px 12px', borderRadius: '100px', fontSize: '11px',
                                        fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'inline-block'
                                    }}>
                                        {effectivePriority || 'NORMAL'}
                                    </span>
                                </td>

                                {/* Assigned Ops */}
                                <td style={{ padding: '14px 24px' }}>
                                    <div className="flex items-center gap-2">
                                        <div style={{ width: 28, height: 28, background: '#f0fdf4', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #d1fae5' }}>
                                            <span style={{ fontSize: '10px', fontWeight: 700, color: '#16a34a' }}>{effectiveTeam?.charAt(0)}</span>
                                        </div>
                                        <span style={{ fontSize: '12px', fontWeight: 500, color: '#374151', whiteSpace: 'nowrap' }}>{effectiveTeam}</span>
                                    </div>
                                </td>

                                {/* SLA Target Countdown */}
                                <td style={{ padding: '14px 24px' }}>
                                    <SLATargetClock
                                        createdAt={ticket.created_at || ticket.createdAt || ticket.timestamp}
                                        priority={effectivePriority}
                                        status={ticket.status}
                                        variant="compact"
                                    />
                                </td>

                                {/* Status */}
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
    );
};

export default TicketTable;
