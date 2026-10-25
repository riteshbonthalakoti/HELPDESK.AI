import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useAuthStore from "../../store/authStore";
import useToastStore from "../../store/toastStore";
import { supabase } from "../../lib/supabaseClient";
import {
    Search,
    Filter,
    Inbox,
    Activity,
    ShieldAlert,
    Clock,
    ChevronRight,
    BarChart3,
    User,
    ArrowUpRight,
    ExternalLink,
    AlertCircle,
    CheckCircle2,
    Loader2,
    Save,
    RotateCcw,
} from 'lucide-react';
import { Select } from "../../components/ui/select";
import { formatTicketId } from "../../utils/format";
import SLABadge from "../components/SLABadge";
import { formatTimelineDate, formatRelativeTime } from "../../utils/dateUtils";

const AdminTickets = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuthStore();
    const { showToast } = useToastStore();

    // Data State
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isUpdating, setIsUpdating] = useState(null); // ID of ticket being updated

    // Filter States
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [priorityFilter, setPriorityFilter] = useState('All');
    const [teamFilter, setTeamFilter] = useState('All');
    const [agents, setAgents] = useState([]); // All staff/admins in the company

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const { profile } = useAuthStore.getState();
            
            // 1. Fetch Agents for this company
            if (profile?.company) {
                const { data: agentData } = await supabase
                    .from('profiles')
                    .select('id, full_name, role')
                    .eq('company', profile.company)
                    .in('role', ['admin', 'super_admin', 'agent']);
                setAgents(agentData || []);
            }

            // 2. Fetch Tickets (Join with both Creator and Assignee)
            fetchTickets();
        } catch (err) {
            console.error("Initialization error:", err);
        } finally {
            setLoading(false);
        }
    };

    const fetchTickets = async () => {
        setError(null);
        try {
            const { profile } = useAuthStore.getState();
            
            // Join with profiles for both user_id (creator) and assigned_agent_id (assignee)
            let query = supabase
                .from('tickets')
                .select(`
                    *,
                    creator:profiles!tickets_user_id_fkey(full_name, email, profile_picture),
                    assignee:profiles!tickets_assigned_agent_id_fkey(full_name, email, profile_picture)
                `);

            if (profile?.role === 'admin' && profile?.company) {
                query = query.eq('company', profile.company);
            }

            if (statusFilter !== 'All') query = query.eq('status', statusFilter.toLowerCase());
            if (categoryFilter !== 'All') query = query.eq('category', categoryFilter);
            if (priorityFilter !== 'All') query = query.eq('priority', priorityFilter.toLowerCase());
            if (teamFilter !== 'All') query = query.eq('assigned_team', teamFilter);

            let { data, error: sbError } = await query.order('created_at', { ascending: false });

            if (sbError) {
                // Secondary check: If the FK alias fails, try a simpler select
                console.warn("Retrying fetch without relationship aliases...");
                const basicQuery = supabase.from('tickets').select('*, profiles(full_name, email)');
                const { data: basicData, error: basicError } = await basicQuery.eq('company', profile?.company).order('created_at', { ascending: false });
                if (basicError) throw basicError;
                setTickets(basicData || []);
            } else {
                setTickets(data || []);
            }
        } catch (err) {
            console.error("Admin fetch error:", err);
            setError(err.message);
        }
    };

    useEffect(() => {
        fetchInitialData();

        // 4. Real-time subscription to ticket changes
        const { profile } = useAuthStore.getState();
        const channel = supabase
            .channel('admin_tickets_realtime')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'tickets',
                    filter: profile?.company ? `company=eq.${profile.company}` : undefined
                },
                (payload) => {
                    console.log("Admin tickets sync event:", payload.eventType, payload.new);
                    if (payload.eventType === 'INSERT') {
                        setTickets(prev => [payload.new, ...prev]);
                        showToast(`New Incident Reported: #${payload.new.id}`, "success");
                        // Play a subtle sound or visual cue if needed
                    } else if (payload.eventType === 'UPDATE') {
                        setTickets(prev => prev.map(t => t.id === payload.new.id ? { ...t, ...payload.new } : t));
                    } else if (payload.eventType === 'DELETE') {
                        setTickets(prev => prev.filter(t => t.id === payload.old.id));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
     
    }, [statusFilter, categoryFilter, priorityFilter, teamFilter]);

    // Seed search from URL
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const q = params.get('q');
        if (q) setSearchQuery(decodeURIComponent(q));
    }, [location.search]);

    const handleUpdateTicket = async (id, updates) => {
        setIsUpdating(id);
        try {
            const { error: upError } = await supabase
                .from('tickets')
                .update(updates)
                .eq('id', id);

            if (upError) throw upError;

            // Optimistic update already handled if real-time is fast, 
            // but manual update ensures immediate feedback
            setTickets(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
            showToast("System synchronization successful.", "success");
        } catch (err) {
            console.error("Update failed:", err);
            showToast("Update failed: " + err.message, "error");
        } finally {
            setIsUpdating(null);
        }
    };

    const categories = ['All', 'Network', 'Hardware', 'Software', 'Access', 'Account'];
    const priorities = ['All', 'Low', 'Medium', 'High'];
    const statuses = ['All', 'Open', 'In Progress', 'Resolved', 'Closed'];
    const teams = ['All', 'Software Team', 'Hardware Support', 'Network Ops', 'Security Unit', 'General Support'];

    const filteredTickets = useMemo(() => {
        if (!searchQuery) return tickets;
        const q = searchQuery.toLowerCase();
        return tickets.filter(t =>
            String(t.id).includes(q) ||
            (t.subject || '').toLowerCase().includes(q) ||
            (t.summary || '').toLowerCase().includes(q) ||
            (t.description || '').toLowerCase().includes(q) ||
            (t.profiles?.full_name || '').toLowerCase().includes(q)
        );
    }, [tickets, searchQuery]);

    const getPriorityStyle = (priority) => {
        const p = String(priority || '').toLowerCase();
        if (p === 'high' || p === 'critical') return 'text-red-600 bg-red-50 border-red-100';
        if (p === 'medium') return 'text-amber-600 bg-amber-50 border-amber-100';
        if (p === 'low') return 'text-emerald-600 bg-emerald-50 border-emerald-100';
        return 'text-slate-500 bg-slate-50 border-slate-100'; // Default
    };

    const getConfidenceColor = (conf) => {
        if (conf >= 0.8) return 'bg-emerald-500';
        if (conf >= 0.5) return 'bg-amber-500';
        return 'bg-red-500';
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            {/* 1. Header & Utility Bar */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight italic uppercase">Ticket Management</h1>
                    <p className="text-sm font-bold text-slate-400 mt-1 flex items-center gap-2">
                        <Activity size={14} className="text-indigo-500" /> {filteredTickets.length} tickets matching current filters.
                    </p>
                </div>
            </div>

            {/* 2. Advanced Filtering Station */}
            <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/50 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                    {/* Search Field */}
                    <div className="relative group lg:col-span-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-emerald-500 transition-colors w-5 h-5" />
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-3 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-emerald-500/5 focus:border-emerald-500 focus:bg-white transition-all text-slate-700 placeholder:text-slate-400"
                        />
                    </div>

                    {/* Status Filter */}
                    <Select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        buttonClassName="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-600 focus:outline-none focus:ring-4 focus:ring-emerald-500/5 transition-all text-left flex justify-between items-center"
                        options={statuses.map(s => ({ value: s, label: s === 'All' ? 'All Statuses' : s }))}
                    />

                    {/* Category Filter */}
                    <Select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        buttonClassName="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-600 focus:outline-none focus:ring-4 focus:ring-emerald-500/5 transition-all text-left flex justify-between items-center"
                        options={categories.map(c => ({ value: c, label: c === 'All' ? 'All Categories' : c }))}
                    />

                    {/* Priority Filter */}
                    <Select
                        value={priorityFilter}
                        onChange={(e) => setPriorityFilter(e.target.value)}
                        buttonClassName="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-600 focus:outline-none focus:ring-4 focus:ring-emerald-500/5 transition-all text-left flex justify-between items-center"
                        options={priorities.map(p => ({ value: p, label: p === 'All' ? 'All Priorities' : p }))}
                    />

                    {/* Team Filter */}
                    <Select
                        value={teamFilter}
                        onChange={(e) => setTeamFilter(e.target.value)}
                        buttonClassName="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-600 focus:outline-none focus:ring-4 focus:ring-emerald-500/5 transition-all text-left flex justify-between items-center"
                        options={teams.map(t => ({ value: t, label: t === 'All' ? 'All Teams' : t }))}
                    />
                </div>
            </div>

            {/* 3. High-Density Data Terminal */}
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-2xl shadow-slate-200/50 overflow-hidden relative min-h-[400px]">
                {loading && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
                        <Loader2 className="w-10 h-10 text-emerald-600 animate-spin" />
                    </div>
                )}

                {error && (
                    <div className="p-12 text-center text-red-500 space-y-4">
                        <AlertCircle className="mx-auto w-12 h-12" />
                        <p className="font-bold uppercase tracking-widest text-xs">{error}</p>
                        <button onClick={fetchTickets} className="px-6 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Retry</button>
                    </div>
                )}

                <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="bg-slate-50/80 border-b border-slate-100">
                                <th className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                    <div className="flex items-center gap-2">
                                        ID
                                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                                    </div>
                                </th>
                                <th className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">User</th>
                                <th className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Subject</th>
                                <th className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Priority</th>
                                <th className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">AI Score</th>
                                <th className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Agent</th>
                                <th className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                                <th className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">SLA</th>
                                <th className="px-6 py-5 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {filteredTickets.map((ticket) => (
                                <tr key={ticket.id} className={`hover:bg-slate-50/50 transition-colors group ${isUpdating === ticket.id ? 'opacity-50 pointer-events-none' : ''}`}>
                                    {/* Ticket ID */}
                                    <td className="px-6 py-6">
                                        <span className="font-mono text-xs font-black text-emerald-600">#{formatTicketId(ticket.id)}</span>
                                    </td>

                                    {/* User (Joined with Profiles) */}
                                    <td className="px-6 py-6">
                                        <div className="flex items-center gap-3">
                                            {ticket.creator?.profile_picture || ticket.profiles?.profile_picture ? (
                                                <img
                                                    src={ticket.creator?.profile_picture || ticket.profiles?.profile_picture}
                                                    alt={ticket.creator?.full_name || ticket.profiles?.full_name || 'User'}
                                                    className="w-8 h-8 rounded-lg object-cover border border-slate-100 shadow-sm"
                                                />
                                            ) : (
                                                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-xs border border-emerald-100/50">
                                                    {(ticket.creator?.full_name || ticket.profiles?.full_name || 'System').charAt(0).toUpperCase()}
                                                </div>
                                            )}
                                            <div className="flex flex-col">
                                                <span className="text-xs font-black text-slate-800 tracking-tight italic uppercase truncate max-w-[120px]">
                                                    {ticket.creator?.full_name || ticket.profiles?.full_name || 'System'}
                                                </span>
                                                <span className="text-[10px] font-bold text-slate-400 lowercase truncate max-w-[120px]">
                                                    {ticket.creator?.email || ticket.profiles?.email || '—'}
                                                </span>
                                            </div>
                                        </div>
                                    </td>

                                    {/* Subject */}
                                    <td className="px-6 py-6">
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-slate-700 truncate max-w-[200px]" title={ticket.summary || ticket.subject}>
                                                {ticket.summary || ticket.subject}
                                            </span>
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                {ticket.category} 
                                                <span className="text-[9px] font-medium text-slate-300" title={formatTimelineDate(ticket.created_at)}>• {formatRelativeTime(ticket.created_at)}</span>
                                            </span>
                                        </div>
                                    </td>

                                    {/* Priority (Editable) */}
                                    <td className="px-6 py-6">
                                        <select
                                            value={String(ticket.priority || 'medium').toLowerCase()}
                                            onChange={(e) => handleUpdateTicket(ticket.id, { priority: e.target.value })}
                                            className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider border outline-none cursor-pointer transition-all flex items-center justify-between ${getPriorityStyle(ticket.priority)}`}
                                        >
                                            {priorities.filter(p => p !== 'All').map(p => (
                                                <option key={p} value={p.toLowerCase()}>{p}</option>
                                            ))}
                                        </select>
                                    </td>

                                    {/* AI Score (Confidence) */}
                                    <td className="px-6 py-6">
                                        <div className="flex items-center gap-2">
                                            <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-[8px] font-black
                                                ${ticket.confidence >= 0.8 ? 'border-emerald-500 text-emerald-600 bg-emerald-50' : 
                                                  ticket.confidence >= 0.5 ? 'border-amber-500 text-amber-600 bg-amber-50' : 
                                                  'border-red-500 text-red-600 bg-red-50'}`}>
                                                {(ticket.confidence * 100).toFixed(0)}%
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[8px] font-black text-slate-400 uppercase">Confidence</span>
                                                <div className="w-12 h-1 bg-slate-100 rounded-full overflow-hidden mt-0.5">
                                                    <div 
                                                        className={`h-full ${getConfidenceColor(ticket.confidence || 0)}`} 
                                                        style={{ width: `${(ticket.confidence || 0) * 100}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </td>

                                    {/* Assigned Team (Editable) */}
                                    <td className="px-6 py-6 text-emerald-600 font-bold text-[10px]">
                                        {ticket.assigned_team || 'General'}
                                    </td>

                                    {/* Agent Assignee (Editable) */}
                                    <td className="px-6 py-6">
                                        <div className="flex flex-col gap-1 min-w-[120px]">
                                            {ticket.assigned_agent_id ? (
                                                <select
                                                    value={ticket.assigned_agent_id}
                                                    onChange={(e) => handleUpdateTicket(ticket.id, { 
                                                        assigned_agent_id: e.target.value,
                                                        status: 'in progress'
                                                    })}
                                                    className="bg-transparent text-[10px] font-black text-indigo-600 uppercase tracking-tight italic border-none focus:ring-0 cursor-pointer hover:underline"
                                                >
                                                    {agents.map(a => (
                                                        <option key={a.id} value={a.id}>{a.full_name}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <button
                                                    onClick={() => handleUpdateTicket(ticket.id, { 
                                                        assigned_agent_id: user.id,
                                                        status: 'in progress'
                                                    })}
                                                    className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[9px] font-black uppercase tracking-widest border border-indigo-100 hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
                                                >
                                                    Claim
                                                </button>
                                            )}
                                        </div>
                                    </td>

                                    {/* Status (Editable) */}
                                    <td className="px-6 py-6">
                                        <div className="flex items-center gap-2">
                                            <div className={`w-1.5 h-1.5 rounded-full ${ticket.status?.toLowerCase() === 'resolved' || ticket.status?.toLowerCase() === 'closed' ? 'bg-emerald-400' : 'bg-amber-500 animate-pulse'}`}></div>
                                            <Select
                                                value={String(ticket.status || 'open').toLowerCase()}
                                                onChange={(e) => handleUpdateTicket(ticket.id, { status: e.target.value })}
                                                buttonClassName="bg-transparent text-[10px] font-black text-slate-600 uppercase tracking-widest outline-none cursor-pointer flex justify-between items-center w-full"
                                                options={statuses.filter(s => s !== 'All').map(s => ({ value: s.toLowerCase(), label: s }))}
                                            />
                                        </div>
                                    </td>

                                    {/* SLA Badge */}
                                    <td className="px-6 py-6">
                                        <SLABadge
                                            priority={ticket.priority}
                                            createdAt={ticket.created_at}
                                            status={ticket.status}
                                        />
                                    </td>

                                    {/* Action: Open Ticket */}
                                    <td className="px-6 py-6 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <button
                                                onClick={() => navigate(`/admin/ticket/${ticket.id}`)}
                                                className="p-2 bg-slate-900 text-white rounded-xl hover:bg-emerald-600 transition-all shadow-lg shadow-slate-900/10 hover:shadow-emerald-500/20"
                                                title="Open Detailed View"
                                            >
                                                <ArrowUpRight size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {!loading && filteredTickets.length === 0 && (
                    <div className="py-32 text-center bg-slate-50/30 w-full flex flex-col items-center">
                        <div className="w-20 h-20 bg-white border border-slate-100 rounded-[2rem] flex items-center justify-center text-slate-200 mb-6 shadow-sm">
                            <Inbox size={40} />
                        </div>
                        <h3 className="text-xl font-black text-slate-900 uppercase italic tracking-tight">No Incidents Found</h3>
                        <p className="text-sm text-slate-500 font-medium max-w-xs mx-auto mt-2 italic">Refine your search parameters to view more data points.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminTickets;
