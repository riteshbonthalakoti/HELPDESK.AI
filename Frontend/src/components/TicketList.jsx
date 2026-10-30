import React, { useState, useMemo } from 'react';
import { Search, Filter, X, Clock, AlertCircle, CheckCircle2, ChevronRight, Inbox } from 'lucide-react';
import { useDebounce } from '../hooks/useDebounce';

/**
 * TicketList Component with Debounced Search Filtering
 * Addresses Issue #4089 / #4105
 *
 * Implements client-side debounced search filtering (300ms) to ensure smooth
 * typing performance and eliminate UI lag on large ticket datasets.
 */
export function TicketList({
    tickets = [],
    onSelectTicket,
    isLoading = false,
    emptyMessage = "No tickets found matching your search criteria."
}) {
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [priorityFilter, setPriorityFilter] = useState('All');

    // Debounce the search query by 300ms
    const debouncedSearch = useDebounce(searchQuery, 300);
    const isDebouncing = searchQuery !== debouncedSearch;

    // Filter tickets using the debounced query
    const filteredTickets = useMemo(() => {
        if (!Array.isArray(tickets)) return [];

        const searchLower = debouncedSearch.toLowerCase().trim();

        return tickets.filter((ticket) => {
            // Search match across ID, subject, summary, and description
            const matchesSearch =
                !searchLower ||
                String(ticket.id || '').toLowerCase().includes(searchLower) ||
                (ticket.subject || '').toLowerCase().includes(searchLower) ||
                (ticket.summary || '').toLowerCase().includes(searchLower) ||
                (ticket.description || '').toLowerCase().includes(searchLower);

            // Status filter match
            const ticketStatus = String(ticket.status || 'open').toLowerCase();
            const matchesStatus =
                statusFilter === 'All' || ticketStatus === statusFilter.toLowerCase();

            // Priority filter match
            const ticketPriority = String(ticket.priority || 'medium').toLowerCase();
            const matchesPriority =
                priorityFilter === 'All' || ticketPriority === priorityFilter.toLowerCase();

            return matchesSearch && matchesStatus && matchesPriority;
        });
    }, [tickets, debouncedSearch, statusFilter, priorityFilter]);

    const handleClearSearch = () => {
        setSearchQuery('');
    };

    const getPriorityBadgeClass = (priority) => {
        const p = String(priority || '').toLowerCase();
        if (p === 'critical' || p === 'high') {
            return 'bg-red-50 text-red-700 border-red-200';
        }
        if (p === 'medium') {
            return 'bg-amber-50 text-amber-700 border-amber-200';
        }
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    };

    const getStatusBadgeClass = (status) => {
        const s = String(status || '').toLowerCase();
        if (s === 'closed' || s === 'resolved') {
            return 'bg-gray-100 text-gray-700 border-gray-200';
        }
        if (s === 'in progress' || s === 'in_progress') {
            return 'bg-blue-50 text-blue-700 border-blue-200';
        }
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    };

    return (
        <div className="w-full flex flex-col gap-4">
            {/* Search & Filters Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                {/* Search Input Container */}
                <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search tickets by ID, subject, or description..."
                        className="w-full pl-10 pr-10 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-gray-400"
                        aria-label="Search tickets"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={handleClearSearch}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition p-1"
                            aria-label="Clear search query"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>

                {/* Status & Priority Quick Selectors */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                    <div className="flex items-center gap-1.5 text-xs">
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-gray-700 font-medium focus:outline-none focus:border-emerald-500 text-xs"
                            aria-label="Filter by status"
                        >
                            <option value="All">All Statuses</option>
                            <option value="open">Open</option>
                            <option value="in_progress">In Progress</option>
                            <option value="resolved">Resolved</option>
                            <option value="closed">Closed</option>
                        </select>

                        <select
                            value={priorityFilter}
                            onChange={(e) => setPriorityFilter(e.target.value)}
                            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-gray-700 font-medium focus:outline-none focus:border-emerald-500 text-xs"
                            aria-label="Filter by priority"
                        >
                            <option value="All">All Priorities</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                        </select>
                    </div>

                    {isDebouncing && (
                        <span className="text-[11px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg animate-pulse shrink-0">
                            Filtering...
                        </span>
                    )}
                </div>
            </div>

            {/* Ticket Counter Strip */}
            <div className="flex items-center justify-between text-xs text-gray-500 px-1">
                <span>
                    Showing <strong>{filteredTickets.length}</strong> of <strong>{tickets.length}</strong> tickets
                </span>
                {(searchQuery || statusFilter !== 'All' || priorityFilter !== 'All') && (
                    <button
                        type="button"
                        onClick={() => {
                            setSearchQuery('');
                            setStatusFilter('All');
                            setPriorityFilter('All');
                        }}
                        className="text-emerald-600 hover:text-emerald-700 font-medium transition"
                    >
                        Reset filters
                    </button>
                )}
            </div>

            {/* Ticket List View */}
            {isLoading ? (
                <div className="flex flex-col gap-3 py-8">
                    {[1, 2, 3].map((n) => (
                        <div key={n} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />
                    ))}
                </div>
            ) : filteredTickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 bg-white rounded-3xl border border-gray-100 text-center shadow-sm">
                    <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 mb-3">
                        <Inbox className="w-7 h-7" />
                    </div>
                    <h4 className="text-base font-bold text-gray-900 mb-1">No Tickets Found</h4>
                    <p className="text-sm text-gray-500 max-w-sm mb-4">{emptyMessage}</p>
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={handleClearSearch}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-sm transition"
                        >
                            Clear Search
                        </button>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-2.5">
                    {filteredTickets.map((ticket) => (
                        <div
                            key={ticket.id}
                            onClick={() => onSelectTicket && onSelectTicket(ticket)}
                            className="group flex items-center justify-between p-4 bg-white hover:bg-gray-50/80 rounded-2xl border border-gray-100 hover:border-emerald-200 transition-all shadow-sm cursor-pointer"
                        >
                            <div className="flex items-center gap-3.5 min-w-0 flex-1">
                                <span className="font-mono text-xs font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded-lg shrink-0">
                                    #{ticket.id}
                                </span>

                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${getStatusBadgeClass(ticket.status)}`}>
                                            {ticket.status || 'open'}
                                        </span>
                                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${getPriorityBadgeClass(ticket.priority)}`}>
                                            {ticket.priority || 'medium'}
                                        </span>
                                    </div>
                                    <h4 className="text-sm font-semibold text-gray-900 group-hover:text-emerald-700 transition truncate">
                                        {ticket.subject || ticket.summary || 'Untitled Ticket'}
                                    </h4>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0 ml-3">
                                {ticket.created_at && (
                                    <span className="text-xs text-gray-400 hidden sm:inline-block">
                                        {new Date(ticket.created_at).toLocaleDateString()}
                                    </span>
                                )}
                                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all" />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default TicketList;
