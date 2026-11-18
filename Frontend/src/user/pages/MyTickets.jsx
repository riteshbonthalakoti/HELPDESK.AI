import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Ticket, Inbox, Search, Filter,
    ChevronDown, ChevronRight, ShieldCheck, Clock, Loader2, AlertCircle
} from 'lucide-react';
import useAuthStore from "../../store/authStore";
import { supabase } from "../../lib/supabaseClient";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Select } from "../../components/ui/select";
import { formatTicketId } from "../../utils/format";
import TicketStatusBadge from "../components/TicketStatusBadge";
import { formatTimelineDate, getTimeZoneAbbr } from "../../utils/dateUtils";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "../../components/ui/tooltip";

function MyTickets() {
    const navigate = useNavigate();
    const { user } = useAuthStore();

    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [priorityFilter, setPriorityFilter] = useState('All');

    // Fetch tickets from Supabase
    const fetchTickets = useCallback(async () => {
        if (!user?.id) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        const { data, error: sbError } = await supabase
            .from('tickets')
            .select('*') // Select all columns
            .eq('user_id', user.id) // Filter by the current user's ID
            .order('created_at', { ascending: false });

        if (sbError) {
            console.error("Error fetching tickets:", sbError);
            setError(sbError.message);
            setTickets([]);
        } else {
            setTickets(data || []);
        }
        setLoading(false);
    }, [user]);

    useEffect(() => {
         
        fetchTickets();

        if (!user?.id) return;

        // Real-time subscription for THIS user's tickets
        const channel = supabase
            .channel(`user_tickets_${user.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'tickets',
                    filter: `user_id=eq.${user.id}`
                },
                (payload) => {
                    console.log("User tickets real-time event:", payload.eventType, payload.new);
                    if (payload.eventType === 'INSERT') {
                        setTickets(prev => [payload.new, ...prev]);
                    } else if (payload.eventType === 'UPDATE') {
                        setTickets(prev => prev.map(t => t.id === payload.new.id ? { ...t, ...payload.new } : t));
                    } else if (payload.eventType === 'DELETE') {
                        setTickets(prev => prev.filter(t => t.id !== payload.old.id));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, fetchTickets]); // Re-subscribe when user changes

    // Filtering logic
    const filteredTickets = useMemo(() => {
        return tickets
            .filter(ticket => {
                const searchLower = searchQuery.toLowerCase();
                const matchesSearch =
                    (ticket.subject || '').toLowerCase().includes(searchLower) ||
                    (ticket.summary || '').toLowerCase().includes(searchLower) ||
                    (ticket.description || '').toLowerCase().includes(searchLower) ||
                    String(ticket.id).includes(searchLower);

                const ticketStatus = ticket.status || 'open';
                const matchesStatus = statusFilter === 'All' ? true : ticketStatus.toLowerCase() === statusFilter.toLowerCase();

                const ticketPriority = ticket.priority || 'medium';
                const matchesPriority = priorityFilter === 'All' ? true : ticketPriority.toLowerCase() === priorityFilter.toLowerCase();

                return matchesSearch && matchesStatus && matchesPriority;
            });
    }, [tickets, searchQuery, statusFilter, priorityFilter]);


    const getPriorityColor = (priority) => {
        const p = (priority || '').toLowerCase();
        if (p === 'high' || p === 'critical') return 'text-red-600 font-bold';
        if (p === 'medium') return 'text-amber-600 font-bold';
        if (p === 'low') return 'text-blue-600 font-bold';
        return 'text-gray-600';
    };

    return (
        <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 sm:px-6 py-5 sm:py-8 md:py-10 flex flex-col gap-5 sm:gap-7">
            {/* Header section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight flex items-center gap-2.5 sm:gap-3">
                        <Ticket className="text-emerald-600 w-6 h-6 sm:w-8 sm:h-8 shrink-0" /> My Tickets
                    </h1>
                    <p className="text-xs sm:text-sm text-gray-500 font-medium mt-1">Manage and track your support requests</p>
                </div>
                <button
                    onClick={() => navigate('/create-ticket')}
                    className="w-full md:w-auto px-5 py-3 md:py-2.5 bg-emerald-600 text-white font-bold rounded-2xl md:rounded-xl hover:bg-emerald-700 transition-all shadow-sm active:scale-[0.98] flex items-center justify-center gap-2 whitespace-nowrap text-sm"
                >
                    Create New Ticket
                </button>
            </div>

            {/* Toolbar section */}
            <div className="flex flex-col md:flex-row gap-3 md:gap-4 bg-white p-3.5 sm:p-4 rounded-2xl shadow-xs border border-gray-100">
                <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 sm:w-5 sm:h-5" />
                    <input
                        type="text"
                        placeholder="Search tickets by ID or subject..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-gray-900 font-medium"
                    />
                </div>
                <div className="grid grid-cols-2 md:flex items-center gap-2.5 sm:gap-3">
                    <Select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        options={[
                            { value: 'All', label: 'All Statuses' },
                            { value: 'Resolved', label: 'Resolved' },
                            { value: 'Pending', label: 'Pending' },
                            { value: 'In Progress', label: 'In Progress' },
                            { value: 'Escalated', label: 'Escalated' }
                        ]}
                    />
                    <Select
                        value={priorityFilter}
                        onChange={(e) => setPriorityFilter(e.target.value)}
                        options={[
                            { value: 'All', label: 'All Priorities' },
                            { value: 'Critical', label: 'Critical' },
                            { value: 'High', label: 'High' },
                            { value: 'Medium', label: 'Medium' },
                            { value: 'Low', label: 'Low' }
                        ]}
                    />
                </div>
            </div>

            {/* Main Content */}

            {loading ? (
                <Card className="border border-gray-100 rounded-2xl bg-white shadow-sm overflow-hidden p-6 w-full">
                    <div className="space-y-6">
                        <style>{`@keyframes shimmer{100%{transform:translateX(100%)}}`}</style>
                        <div className="flex items-center gap-4 border-b border-gray-50 pb-4">
                            <div className="h-4 w-12 bg-slate-100 rounded relative overflow-hidden"><div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.5s_infinite]" /></div>
                            <div className="h-4 w-32 bg-slate-100 rounded relative overflow-hidden"><div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.5s_infinite]" /></div>
                            <div className="h-4 w-20 bg-slate-100 rounded relative overflow-hidden"><div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.5s_infinite]" /></div>
                        </div>
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="flex items-center gap-6 py-2">
                                <div className="h-5 w-16 bg-slate-100 rounded-md relative overflow-hidden shrink-0">
                                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.5s_infinite]" />
                                </div>
                                <div className="h-5 flex-1 bg-slate-100 rounded-md relative overflow-hidden max-w-[300px]">
                                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.5s_infinite]" />
                                </div>
                                <div className="h-6 w-24 bg-slate-100 rounded-md relative overflow-hidden shrink-0">
                                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.5s_infinite]" />
                                </div>
                                <div className="h-6 w-20 bg-slate-100 rounded-full relative overflow-hidden shrink-0">
                                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.5s_infinite]" />
                                </div>
                                <div className="h-5 w-16 bg-slate-100 rounded-md relative overflow-hidden shrink-0">
                                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.5s_infinite]" />
                                </div>
                                <div className="h-8 w-24 bg-slate-100 rounded-md relative overflow-hidden shrink-0 hidden sm:block">
                                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.5s_infinite]" />
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            ) : error ? (
                <Card className="p-8 border-red-100 bg-red-50/50 rounded-2xl flex flex-col items-center text-center">
                    <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                    <h3 className="text-lg font-bold text-red-900 mb-1">Database Sync Error</h3>
                    <p className="text-red-700/70 text-sm max-w-sm mb-6">{error}</p>
                    <button
                        onClick={fetchTickets}
                        className="px-6 py-2 bg-white border border-red-200 text-red-700 font-bold rounded-xl hover:bg-red-50 transition-colors shadow-sm"
                    >
                        Retry Connection
                    </button>
                </Card>
            ) : tickets.length === 0 ? (
                // True Empty State
                <Card className="flex flex-col items-center justify-center py-20 text-center border-dashed border-2 border-gray-200 bg-transparent shadow-none rounded-2xl">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                        <Inbox className="text-gray-400 w-8 h-8" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-800 mb-1">No tickets yet</h3>
                    <p className="text-gray-500 max-w-sm mb-8">
                        You haven't submitted any support requests. Create a ticket to get help from our AI and support team.
                    </p>
                    <button
                        onClick={() => navigate('/create-ticket')}
                        className="px-6 py-2.5 bg-white border border-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
                    >
                        Create your first ticket
                    </button>
                </Card>
            ) : filteredTickets.length === 0 ? (
                // Filter Empty State
                <Card className="flex flex-col items-center justify-center py-16 text-center border border-gray-100 shadow-sm rounded-2xl bg-white">
                    <Filter className="text-gray-300 w-12 h-12 mb-4" />
                    <h3 className="text-lg font-bold text-gray-900 mb-1">No matching tickets found</h3>
                    <p className="text-gray-500 text-sm mb-4">Try adjusting your search or filters.</p>
                    <button
                        onClick={() => {
                            setSearchQuery('');
                            setStatusFilter('All');
                            setPriorityFilter('All');
                        }}
                        className="text-emerald-600 font-semibold hover:text-emerald-700 text-sm"
                    >
                        Clear all filters
                    </button>
                </Card>
            ) : (
                <>
                    {/* Mobile Native Ticket Cards (< md) */}
                    <div className="md:hidden space-y-3">
                        {filteredTickets.map(ticket => {
                            const prio = (ticket.priority || 'medium').toLowerCase();
                            const barColor =
                                prio === 'critical' || prio === 'high'
                                    ? 'bg-red-500'
                                    : prio === 'medium'
                                    ? 'bg-amber-400'
                                    : 'bg-emerald-500';
                            return (
                                <button
                                    type="button"
                                    key={ticket.id}
                                    onClick={() => navigate(`/ticket/${ticket.id}`)}
                                    className="w-full text-left bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden active:scale-[0.985] transition-all flex"
                                >
                                    <div className={`w-1.5 shrink-0 ${barColor}`} />
                                    <div className="flex-1 p-4 min-w-0 space-y-2.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-mono text-xs font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                                                #{formatTicketId(ticket.id)}
                                            </span>
                                            <TicketStatusBadge status={ticket.status} />
                                        </div>
                                        <p className="text-[15px] font-bold text-slate-900 line-clamp-2 leading-snug">
                                            {ticket.summary || ticket.subject || ticket.description || "No subject"}
                                        </p>
                                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-50">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md truncate">
                                                    {ticket.category || 'General'}
                                                </span>
                                                <span className={`text-[11px] capitalize ${getPriorityColor(ticket.priority)}`}>
                                                    {ticket.priority || 'medium'}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 text-[11px] text-slate-400 font-medium shrink-0">
                                                <span>{formatTimelineDate(ticket.created_at)}</span>
                                                <ChevronRight size={14} className="text-slate-300" />
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {/* Desktop Table View (>= md) */}
                    <Card className="hidden md:block border border-gray-100 rounded-2xl bg-white shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left whitespace-nowrap">
                            <thead>
                                <tr className="bg-gray-50/50 border-b border-gray-100">
                                    <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">ID</th>
                                    <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">Subject</th>
                                    <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">Category</th>
                                    <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">Status</th>
                                    <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">Priority</th>
                                    <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">Submitted</th>
                                </tr>
                            </thead>
                            <TooltipProvider delayDuration={300}>
                                <tbody className="divide-y divide-gray-100">
                                    {filteredTickets.map(ticket => (
                                        <tr
                                            key={ticket.id}
                                            onClick={() => navigate(`/ticket/${ticket.id}`)}
                                            className="group hover:bg-emerald-50/30 transition-colors cursor-pointer"
                                        >
                                            <td className="px-6 py-4">
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span className="font-mono font-bold text-gray-900 text-sm">#{formatTicketId(ticket.id)}</span>
                                                    </TooltipTrigger>
                                                    <TooltipContent
                                                        side="top"
                                                        className="bg-gray-900 text-white border-none p-4 w-[300px] shadow-xl rounded-xl"
                                                        sideOffset={10}
                                                    >
                                                        <div className="space-y-3">
                                                            <div>
                                                                 <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-1">Issue Overview</p>
                                                                 <p className="text-sm font-medium leading-relaxed overflow-hidden text-ellipsis whitespace-nowrap">{ticket.summary || ticket.description || "No description provided"}</p>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-3">
                                                                <div>
                                                                    <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-1">Category</p>
                                                                    <p className="text-sm font-medium">{ticket.category || 'General'}</p>
                                                                </div>
                                                                <div>
                                                                    <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-1">Priority</p>
                                                                    <p className="text-sm font-medium capitalize">{ticket.priority || 'medium'}</p>
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-1">Assigned Unit</p>
                                                                <p className="text-sm font-medium flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-400" />{ticket.assigned_team || 'General Support'}</p>
                                                            </div>
                                                        </div>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </td>
                                            <td className="px-6 py-4 w-1/3 max-w-[300px]">
                                                 <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-emerald-700 transition-colors">
                                                     {ticket.summary || ticket.subject || ticket.description || "No subject"}
                                                 </p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-sm font-medium text-gray-600 bg-gray-100 px-2.5 py-1 rounded-md">
                                                    {ticket.category || 'General'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <TicketStatusBadge status={ticket.status} />
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`text-sm capitalize ${getPriorityColor(ticket.priority)}`}>
                                                    {ticket.priority || 'medium'}
                                                </span>
                                            </td>
                                             <td className="px-6 py-4">
                                                 <div className="flex flex-col">
                                                     <span className="text-sm font-semibold text-gray-700">
                                                         {formatTimelineDate(ticket.created_at)}
                                                     </span>
                                                     <span className="text-[10px] text-emerald-600 font-black uppercase tracking-widest mt-0.5">
                                                         {getTimeZoneAbbr()} Node
                                                     </span>
                                                 </div>
                                             </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </TooltipProvider>
                        </table>
                    </div>
                </Card>
                </>
            )}
        </main>
    );
}

export default MyTickets;
