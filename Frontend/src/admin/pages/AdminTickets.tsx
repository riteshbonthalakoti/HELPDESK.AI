import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useAuthStore from "../../store/authStore";
import useToastStore from "../../store/toastStore";
import { supabase } from "../../lib/supabaseClient";
import useTicketsRealtime from "../../hooks/useTicketsRealtime";
import TagFilter from "../../components/TagFilter";
import TagChip from "../../components/TagChip";
import LanguageBadge from "../../components/shared/LanguageBadge";
import {
    Inbox,
    Activity,
    ShieldAlert,
    ArrowUpRight,
    AlertCircle,
    Loader2,
    Save,
    RotateCcw,
    Square,
    CheckSquare,
    X,
    Users,
    XCircle,
    ArrowUpDown,
    Download,
    Printer,
} from 'lucide-react';
import { Select } from "../../components/ui/select";
import { formatTicketId } from "../../utils/format";
import SLABadge from "../components/SLABadge";
import { formatTimelineDate } from "../../utils/dateUtils";
import { sanitizeSearchQuery } from "../../utils/sanitizeText";
import { downloadCSV, printTicket } from "../../utils/exportUtils";

/* ────────────────────────────────────────────────────────────
   Confirmation Modal  – reusable for any destructive bulk op
   ──────────────────────────────────────────────────────────── */
const BulkConfirmModal = ({ action, count, onConfirm, onCancel, isExecuting }) => {
    const dialogRef = useRef(null);
    const confirmButtonRef = useRef(null);
    const titleId = 'bulk-confirm-title';
    const descriptionId = 'bulk-confirm-description';
    const labelMap = {
        close: 'Close',
        priority: 'Change Priority of',
        assign: 'Assign Agent to',
    };
    const actionLabel = labelMap[action] || action;

    useEffect(() => {
        const previouslyFocused = document.activeElement;

        const getFocusableElements = () =>
            Array.from(
                dialogRef.current?.querySelectorAll(
                    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                ) || []
            );

        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && !isExecuting) {
                event.preventDefault();
                onCancel();
                return;
            }

            if (event.key !== 'Tab') return;

            const focusableElements = getFocusableElements();
            if (focusableElements.length === 0) {
                event.preventDefault();
                dialogRef.current?.focus();
                return;
            }

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            if (event.shiftKey && document.activeElement === firstElement) {
                event.preventDefault();
                lastElement.focus();
            } else if (!event.shiftKey && document.activeElement === lastElement) {
                event.preventDefault();
                firstElement.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        requestAnimationFrame(() => {
            confirmButtonRef.current?.focus();
        });

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            previouslyFocused?.focus?.();
        };
    }, [isExecuting, onCancel]);

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                tabIndex={-1}
                className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl shadow-slate-900/20 border border-slate-100 animate-in zoom-in-95 duration-300"
            >
                {/* Icon */}
                <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center mx-auto mb-5">
                    <AlertCircle className="w-7 h-7 text-amber-500" aria-hidden="true" />
                </div>
                <h3 id={titleId} className="text-lg font-black text-slate-900 uppercase italic tracking-tight text-center">
                    Confirm Bulk Action
                </h3>
                <p id={descriptionId} className="text-sm text-slate-500 dark:text-slate-400 mt-3 text-center leading-relaxed">
                    You are about to <strong className="text-slate-800">{actionLabel}</strong>{' '}
                    <strong className="text-indigo-600">{count}</strong> ticket{count > 1 ? 's' : ''}.
                    This action cannot be undone.
                </p>
                <div className="flex gap-3 mt-8">
                    <button
                        ref={confirmButtonRef}
                        type="button"
                        onClick={onConfirm}
                        disabled={isExecuting}
                        aria-label={`Confirm ${actionLabel.toLowerCase()} ${count} selected ticket${count > 1 ? 's' : ''}`}
                        className="flex-1 bg-indigo-600 text-white rounded-2xl py-3.5 text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isExecuting ? (
                            <>
                                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                                Processing…
                            </>
                        ) : (
                            'Confirm'
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={isExecuting}
                        aria-label="Cancel bulk action"
                        className="flex-1 bg-slate-100 text-slate-600 dark:text-slate-400 rounded-2xl py-3.5 text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

/* ────────────────────────────────────────────────────────────
   Bulk Action Toolbar  – slides in when 1+ tickets selected
   ──────────────────────────────────────────────────────────── */
const BulkActionToolbar = ({
    selectedCount,
    bulkAction,
    setBulkAction,
    bulkValue,
    setBulkValue,
    agents,
    priorities,
    onApply,
    onClear,
}) => {
    const canApply = bulkAction === 'close' || (bulkAction && bulkValue);
    return (
        <div
            role="region"
            aria-label={`${selectedCount} selected ticket${selectedCount > 1 ? 's' : ''} bulk actions`}
            className="bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 text-white px-6 py-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl shadow-indigo-500/25 animate-in slide-in-from-top-2 fade-in duration-300"
        >
            {/* Left: selection count */}
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
                    <CheckSquare size={18} aria-hidden="true" />
                </div>
                <span className="text-sm font-black uppercase tracking-widest">
                    {selectedCount} ticket{selectedCount > 1 ? 's' : ''} selected
                </span>
            </div>

            {/* Right: controls */}
            <div className="flex flex-wrap items-center gap-3">
                {/* Action picker */}
                <label htmlFor="bulk-action-select" className="sr-only">Bulk action</label>
                <select
                    id="bulk-action-select"
                    value={bulkAction}
                    onChange={(e) => { setBulkAction(e.target.value); setBulkValue(''); }}
                    aria-label="Bulk action for selected tickets"
                    className="bg-white/15 text-white text-xs font-black uppercase tracking-widest rounded-xl px-4 py-2.5 border border-white/20 outline-none cursor-pointer backdrop-blur-sm hover:bg-white/25 transition-colors"
                >
                    <option value="" className="text-slate-900">Select Action…</option>
                    <option value="close" className="text-slate-900">🔒 Close Tickets</option>
                    <option value="priority" className="text-slate-900">⚡ Change Priority</option>
                    <option value="assign" className="text-slate-900">👤 Assign Agent</option>
                </select>

                {/* Priority sub-select */}
                {bulkAction === 'priority' && (
                    <>
                    <label htmlFor="bulk-priority-select" className="sr-only">Priority for selected tickets</label>
                    <select
                        id="bulk-priority-select"
                        value={bulkValue}
                        onChange={(e) => setBulkValue(e.target.value)}
                        aria-label="Priority for selected tickets"
                        className="bg-white/15 text-white text-xs font-black uppercase tracking-widest rounded-xl px-4 py-2.5 border border-white/20 outline-none cursor-pointer backdrop-blur-sm animate-in fade-in slide-in-from-left-2 duration-200"
                    >
                        <option value="" className="text-slate-900">Pick Priority</option>
                        {priorities.filter(p => p !== 'All').map(p => (
                            <option key={p} value={p.toLowerCase()} className="text-slate-900">{p}</option>
                        ))}
                    </select>
                    </>
                )}

                {/* Agent sub-select */}
                {bulkAction === 'assign' && (
                    <>
                    <label htmlFor="bulk-assign-select" className="sr-only">Agent for selected tickets</label>
                    <select
                        id="bulk-assign-select"
                        value={bulkValue}
                        onChange={(e) => setBulkValue(e.target.value)}
                        aria-label="Agent for selected tickets"
                        className="bg-white/15 text-white text-xs font-black uppercase tracking-widest rounded-xl px-4 py-2.5 border border-white/20 outline-none cursor-pointer backdrop-blur-sm animate-in fade-in slide-in-from-left-2 duration-200"
                    >
                        <option value="" className="text-slate-900">Pick Agent</option>
                        {agents.map(a => (
                            <option key={a.id} value={a.id} className="text-slate-900">{a.full_name}</option>
                        ))}
                    </select>
                    </>
                )}

                {/* Apply */}
                {canApply && (
                    <button
                        id="bulk-apply-btn"
                        type="button"
                        onClick={onApply}
                        aria-label={`Review bulk action for ${selectedCount} selected ticket${selectedCount > 1 ? 's' : ''}`}
                        className="bg-white text-indigo-600 text-xs font-black uppercase tracking-widest rounded-xl px-5 py-2.5 hover:bg-indigo-50 transition-all shadow-lg shadow-black/10 animate-in fade-in zoom-in-95 duration-200"
                    >
                        Apply
                    </button>
                )}

                {/* Clear */}
                <button
                    id="bulk-clear-btn"
                    type="button"
                    onClick={onClear}
                    aria-label="Clear selected tickets"
                    className="p-2.5 hover:bg-white/15 rounded-xl transition-colors"
                    title="Clear selection"
                >
                    <X size={16} aria-hidden="true" />
                </button>
            </div>
        </div>
    );
};

/* ────────────────────────────────────────────────────────────
   Main Component
   ──────────────────────────────────────────────────────────── */
const AdminTickets = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, profile } = useAuthStore();
    const { showToast } = useToastStore();

    // ── Data State ──────────────────────────────────
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isUpdating, setIsUpdating] = useState(null);
    const [newlyBreachedTicketIds, setNewlyBreachedTicketIds] = useState([]);
    const [agents, setAgents] = useState([]);

    // ── Filter State ────────────────────────────────
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [priorityFilter, setPriorityFilter] = useState('All');
    const [teamFilter, setTeamFilter] = useState('All');
    const [languageFilter, setLanguageFilter] = useState('All');
    const [slaAtRisk, setSlaAtRisk] = useState(false);
    const [tagFilters, setTagFilters] = useState([]);

    // ── Bulk Action State ───────────────────────────
    const [selectedTickets, setSelectedTickets] = useState([]);
    const [bulkAction, setBulkAction] = useState('');
    const [bulkValue, setBulkValue] = useState('');
    const [showBulkConfirm, setShowBulkConfirm] = useState(false);
    const [isBulkExecuting, setIsBulkExecuting] = useState(false);
    const [ticketAnnouncement, setTicketAnnouncement] = useState('');

    // ── Constants ───────────────────────────────────
    const categories = ['All', 'Network', 'Hardware', 'Software', 'Access', 'Account'];
    const priorities = ['All', 'Low', 'Medium', 'High'];
    const statuses = ['All', 'Open', 'In Progress', 'Resolved', 'Closed', 'Spam'];
    const teams = ['All', 'Software Team', 'Hardware Support', 'Network Ops', 'Security Unit', 'General Support'];

    // ── Realtime filter predicate ───────────────────
    const ticketMatchesFilters = useCallback((ticket) => {
        if (statusFilter !== 'All' && String(ticket.status || '').toLowerCase() !== statusFilter.toLowerCase()) return false;
        if (categoryFilter !== 'All' && ticket.category !== categoryFilter) return false;
        if (priorityFilter !== 'All' && String(ticket.priority || '').toLowerCase() !== priorityFilter.toLowerCase()) return false;
        if (teamFilter !== 'All' && ticket.assigned_team !== teamFilter) return false;
        if (tagFilters.length > 0 && !(ticket.tags || []).length) return false;
        if (tagFilters.length > 0 && !tagFilters.every(tag => (ticket.tags || []).includes(tag))) return false;
        if (languageFilter !== 'All') {
            const translated = ticket?.metadata?.translation?.translated;
            if (languageFilter === 'Translated' && !translated) return false;
            if (languageFilter === 'English' && translated) return false;
        }
        return true;
    }, [categoryFilter, priorityFilter, statusFilter, teamFilter, languageFilter, tagFilters]);

    const handleRealtimeInsert = useCallback((ticket) => {
        showToast(`New Incident Reported: #${formatTicketId(ticket.id)}`, "success");
        setTicketAnnouncement(`New ticket ${formatTicketId(ticket.id)} added to ticket management.`);
    }, [showToast]);

    const { lastChangedTicketId } = useTicketsRealtime({
        company: profile?.company,
        enabled: Boolean(profile),
        onTicketsChange: setTickets,
        onInsert: handleRealtimeInsert,
        shouldInclude: ticketMatchesFilters,
        channelName: 'admin_tickets_realtime',
    });

    // ── Data Fetching ───────────────────────────────
    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const { profile } = useAuthStore.getState();

            if (profile?.company) {
                const { data: agentData } = await supabase
                    .from('profiles')
                    .select('id, full_name, role')
                    .eq('company', profile.company)
                    .in('role', ['admin', 'super_admin', 'agent']);
                setAgents(agentData || []);
            }

            fetchTickets();
        } catch (err) {
            console.error("Initialization error:", err);
        } finally {
            setLoading(false);
        }
    };

    const fetchTickets = useCallback(async () => {
        setError(null);
        try {
            const { profile } = useAuthStore.getState();

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
            if (debouncedSearch) {
                const escaped = debouncedSearch.replace(/%/g, '\\%').replace(/_/g, '\\_');
                query = query.or(`subject.ilike.%${escaped}%,description.ilike.%${escaped}%,summary.ilike.%${escaped}%`);
            }

            // Sort
            const [sortCol, sortDir] = ('created_at:desc').split(':');
            query = query.order(sortCol || 'created_at', { ascending: sortDir === 'asc' });

            let { data, error: sbError } = await query;

            if (sbError) {
                console.warn("Retrying fetch without relationship aliases...");
                const basicQuery = supabase.from('tickets').select('*, profiles(full_name, email)');
                const { data: basicData, error: basicError } = await basicQuery
                    .eq('company', profile?.company)
                    .order('created_at', { ascending: false });
                if (basicError) throw basicError;
                setTickets(basicData || []);
            } else {
                setTickets(data || []);
            }
        } catch (err) {
            console.error('Admin fetch error:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [debouncedSearch, statusFilter, categoryFilter, priorityFilter, teamFilter]);

    const fetchInitialData = useCallback(async () => {
        const { profile } = useAuthStore.getState();
        if (profile?.company) {
            const { data: agentData } = await supabase
                .from('profiles')
                .select('id, full_name, role')
                .eq('company', profile.company)
                .in('role', ['admin', 'super_admin', 'agent']);
            setAgents(agentData || []);
        }
        fetchTickets();
    }, [fetchTickets]);

    useEffect(() => {
        if (!user) return;
        fetchInitialData();
    }, [user, fetchInitialData]);

    // SLA breach realtime listener
    useEffect(() => {
        const channelSla = supabase
            .channel('sla-alerts')
            .on(
                'broadcast',
                { event: 'breach' },
                (payload) => {
                    const { ticketId, subject, originalTeam, escalatedTeam, companyId } = payload.payload;
                    const { profile } = useAuthStore.getState();
                    if (profile?.company_id && companyId && profile.company_id !== companyId) return;

                    const formattedId = String(ticketId).slice(0, 8).toUpperCase();
                    showToast(`⚠️ SLA BREACH: Ticket #${formattedId} ("${subject}") escalated from '${originalTeam}' to '${escalatedTeam}'!`, "error");
                    setTicketAnnouncement(`SLA breach for ticket ${formattedId}. Escalated from ${originalTeam} to ${escalatedTeam}.`);

                    setNewlyBreachedTicketIds(prev => [...prev, ticketId]);
                    setTimeout(() => {
                        setNewlyBreachedTicketIds(prev => prev.filter(id => id !== ticketId));
                    }, 12000);

                    setTickets(prev => prev.map(t =>
                        t.id === ticketId
                            ? { ...t, sla_status: 'BREACHED', assigned_team: escalatedTeam, escalation_level: (t.escalation_level || 0) + 1, updated_at: new Date().toISOString() }
                            : t
                    ));
                }
            )
            .subscribe();

        return () => { supabase.removeChannel(channelSla); };
    }, []);

    // Debounce search query
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Seed search from URL
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const q = params.get('q');
        if (q) setSearchQuery(decodeURIComponent(q));
    }, [location.search]);

    // ── Single-ticket update ────────────────────────
    const handleUpdateTicket = async (id, updates) => {
        setIsUpdating(id);
        try {
            await api.apiUpdateTicket(id, updates); const upError = null;

            if (upError) throw upError;

            setTickets(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
            showToast("System synchronization successful.", "success");
            setTicketAnnouncement(`Ticket ${formatTicketId(id)} updated successfully.`);
        } catch (err) {
            console.error("Update failed:", err);
            showToast("Update failed: " + err.message, "error");
            setTicketAnnouncement(`Ticket ${formatTicketId(id)} update failed: ${err.message}`);
        } finally {
            setIsUpdating(null);
        }
    };

    // ── Bulk Operations ─────────────────────────────
    const handleSelectAll = () => {
        if (selectedTickets.length === filteredTickets.length && filteredTickets.length > 0) {
            setSelectedTickets([]);
            setTicketAnnouncement('All visible tickets deselected.');
        } else {
            setSelectedTickets(filteredTickets.map(t => t.id));
            setTicketAnnouncement(`${filteredTickets.length} visible ticket${filteredTickets.length > 1 ? 's' : ''} selected.`);
        }
    };

    const handleSelectTicket = (id) => {
        setSelectedTickets(prev => {
            const isSelected = prev.includes(id);
            const next = isSelected ? prev.filter(t => t !== id) : [...prev, id];
            setTicketAnnouncement(`Ticket ${formatTicketId(id)} ${isSelected ? 'deselected' : 'selected'}. ${next.length} ticket${next.length === 1 ? '' : 's'} selected.`);
            return next;
        });
    };

    const handleBulkClear = () => {
        setSelectedTickets([]);
        setBulkAction('');
        setBulkValue('');
        setTicketAnnouncement('Bulk selection cleared.');
    };

    const handleBulkExecute = async () => {
        if (!bulkAction || selectedTickets.length === 0) return;
        setIsBulkExecuting(true);
        try {
            let updates = {};
            if (bulkAction === 'close') updates = { status: 'closed' };
            if (bulkAction === 'priority') updates = { priority: bulkValue };
            if (bulkAction === 'assign') updates = { assigned_agent_id: bulkValue, status: 'in progress' };

            // Batch update via Supabase .in() for efficiency
            const { error: bulkError } = await supabase
                .from('tickets')
                .update(updates)
                .in('id', selectedTickets);

            if (bulkError) throw bulkError;

            // Optimistic state update
            setTickets(prev => prev.map(t =>
                selectedTickets.includes(t.id) ? { ...t, ...updates } : t
            ));

            const actionLabel = bulkAction === 'close' ? 'closed' : bulkAction === 'priority' ? 'priority updated' : 'assigned';
            showToast(`✅ ${selectedTickets.length} ticket${selectedTickets.length > 1 ? 's' : ''} ${actionLabel} successfully.`, "success");
            setTicketAnnouncement(`${selectedTickets.length} ticket${selectedTickets.length > 1 ? 's' : ''} ${actionLabel} successfully.`);

            setSelectedTickets([]);
            setBulkAction('');
            setBulkValue('');
            setShowBulkConfirm(false);
        } catch (err) {
            console.error("Bulk update failed:", err);
            showToast("Bulk update failed: " + err.message, "error");
            setTicketAnnouncement(`Bulk update failed: ${err.message}`);
        } finally {
            setIsBulkExecuting(false);
        }
    };

    // ── Derived / Filtered ──────────────────────────
    const filteredTickets = useMemo(() => {
        let result = tickets;
        if (debouncedSearch) {
            const q = sanitizeSearchQuery(debouncedSearch).toLowerCase();
            result = result.filter(t =>
                String(t.id).includes(q) ||
                (t.subject || '').toLowerCase().includes(q) ||
                (t.summary || '').toLowerCase().includes(q) ||
                (t.description || '').toLowerCase().includes(q) ||
                (t.profiles?.full_name || '').toLowerCase().includes(q)
            );
        }
        if (languageFilter !== 'All') {
            result = result.filter(t => {
                const translated = t.detected_language && t.detected_language.toLowerCase() !== 'en';
                return languageFilter === 'Translated' ? translated : !translated;
            });
        }
        if (slaAtRisk) {
            result = result.filter(t => {
                const s = (t.sla_status || '').toUpperCase();
                return s === 'BREACHED' || s === 'WARNING';
            });
        }
        if (tagFilters.length > 0) {
            result = result.filter(t => (t.tags || []).length > 0 && tagFilters.every(tag => (t.tags || []).includes(tag)));
        }
        return result;
    }, [tickets, languageFilter, slaAtRisk, tagFilters]);

    // Clear selection when filters change (selected IDs may no longer be visible)
    useEffect(() => {
        setSelectedTickets([]);
    }, [statusFilter, categoryFilter, priorityFilter, teamFilter, debouncedSearch, languageFilter, slaAtRisk, tagFilters]);

    // ── Helpers ─────────────────────────────────────
    const getPriorityStyle = (priority) => {
        const p = String(priority || '').toLowerCase();
        if (p === 'high' || p === 'critical') return 'text-red-600 bg-red-50 border-red-100';
        if (p === 'medium') return 'text-amber-600 bg-amber-50 border-amber-100';
        if (p === 'low') return 'text-emerald-600 bg-emerald-50 border-emerald-100';
        return 'text-slate-500 dark:text-slate-400 bg-slate-50 border-slate-100';
    };

    const getConfidenceColor = (conf) => {
        if (conf >= 0.8) return 'bg-emerald-500';
        if (conf >= 0.5) return 'bg-amber-500';
        return 'bg-red-500';
    };

    const handleExportTickets = () => {
        try {
            const exportDate = new Date().toISOString().slice(0, 10);
            downloadCSV(filteredTickets, `ticket-history-${exportDate}`);
            showToast(`${filteredTickets.length} ticket${filteredTickets.length === 1 ? '' : 's'} exported as CSV.`, 'success');
            setTicketAnnouncement(`${filteredTickets.length} ticket${filteredTickets.length === 1 ? '' : 's'} exported as CSV.`);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'CSV export failed';
            showToast(message, 'error');
            setTicketAnnouncement(message);
        }
    };

    const isAllSelected = filteredTickets.length > 0 && selectedTickets.length === filteredTickets.length;
    const isSomeSelected = selectedTickets.length > 0 && selectedTickets.length < filteredTickets.length;

    // ── Render ──────────────────────────────────────
    return (
        <div className="space-y-6 animate-in fade-in duration-700">
            <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {ticketAnnouncement}
            </div>
            {/* 1. Header & Utility Bar */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight italic uppercase">Ticket Management</h1>
                    <p className="text-sm font-bold text-slate-400 mt-1 flex items-center gap-2">
                        <Activity size={14} className="text-indigo-500" /> {filteredTickets.length} tickets matching current filters.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Export CSV */}
                    <button
                        type="button"
                        onClick={handleExportTickets}
                        disabled={filteredTickets.length === 0}
                        aria-label={`Export ${filteredTickets.length} filtered tickets as CSV`}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                    >
                        <Download size={14} aria-hidden="true" />
                        CSV
                    </button>
                    {/* Print Selected */}
                    {selectedTickets.length === 1 && (
                        <button
                            type="button"
                            onClick={() => {
                                const t = tickets.find(t => t.id === selectedTickets[0]);
                                if (t) printTicket(t);
                            }}
                            aria-label={`Print ticket ${formatTicketId(selectedTickets[0])}`}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-all shadow-sm"
                        >
                            <Printer size={14} aria-hidden="true" />
                            Print
                        </button>
                    )}
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
                            aria-label="Search tickets"
                            className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-3 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-emerald-500/5 focus:border-emerald-500 focus:bg-white transition-all text-slate-700 placeholder:text-slate-400"
                        />
                    </div>

                    {/* Status Filter */}
                    <Select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        aria-label="Filter tickets by status"
                        buttonClassName="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/5 transition-all text-left flex justify-between items-center"
                        options={statuses.map(s => ({ value: s, label: s === 'All' ? 'All Statuses' : s }))}
                    />

                    {/* Category Filter */}
                    <Select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        aria-label="Filter tickets by category"
                        buttonClassName="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/5 transition-all text-left flex justify-between items-center"
                        options={categories.map(c => ({ value: c, label: c === 'All' ? 'All Categories' : c }))}
                    />

                    {/* Priority Filter */}
                    <Select
                        value={priorityFilter}
                        onChange={(e) => setPriorityFilter(e.target.value)}
                        aria-label="Filter tickets by priority"
                        buttonClassName="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/5 transition-all text-left flex justify-between items-center"
                        options={priorities.map(p => ({ value: p, label: p === 'All' ? 'All Priorities' : p }))}
                    />

                    {/* Team Filter */}
                    <Select
                        value={teamFilter}
                        onChange={(e) => setTeamFilter(e.target.value)}
                        aria-label="Filter tickets by assigned team"
                        buttonClassName="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/5 transition-all text-left flex justify-between items-center"
                        options={teams.map(t => ({ value: t, label: t === 'All' ? 'All Teams' : t }))}
                    />
                </div>

                {/* Combined Filter Row */}
                <div className="flex items-center gap-3">
                    <Select
                        value={languageFilter}
                        onChange={(e) => setLanguageFilter(e.target.value)}
                        aria-label="Filter tickets by language"
                        buttonClassName="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 focus:outline-none focus:ring-4 focus:ring-sky-500/5 transition-all text-left flex justify-between items-center"
                        options={[
                            { value: 'All', label: '🌐 All Languages' },
                            { value: 'English', label: 'English Only' },
                            { value: 'Translated', label: 'Translated Only' },
                        ]}
                    />

                    <button
                        type="button"
                        onClick={() => setSlaAtRisk(prev => !prev)}
                        aria-label={slaAtRisk ? 'Disable SLA at risk filter' : 'Enable SLA at risk filter'}
                        aria-pressed={slaAtRisk}
                        className={`flex items-center gap-2 px-4 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest border transition-all ${
                            slaAtRisk
                                ? 'bg-red-50 border-red-200 text-red-700 shadow-sm'
                                : 'bg-slate-50 border-slate-200 text-slate-500 dark:text-slate-400 hover:border-red-200 hover:text-red-600'
                        }`}
                    >
                        <ShieldAlert size={14} aria-hidden="true" />
                        SLA At Risk
                        {slaAtRisk && (
                            <span className="ml-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[9px]">
                                {filteredTickets.length}
                            </span>
                        )}
                    </button>
                </div>

                {/* Tag Filter */}
                <div>
                    <TagFilter companyId={profile?.company_id} onFilterChange={setTagFilters} />
                </div>
            </div>

            {/* 3. Bulk Action Toolbar — appears when 1+ tickets selected */}
            {selectedTickets.length > 0 && (
                <BulkActionToolbar
                    selectedCount={selectedTickets.length}
                    bulkAction={bulkAction}
                    setBulkAction={setBulkAction}
                    bulkValue={bulkValue}
                    setBulkValue={setBulkValue}
                    agents={agents}
                    priorities={priorities}
                    onApply={() => setShowBulkConfirm(true)}
                    onClear={handleBulkClear}
                />
            )}

            {/* 4. Bulk Confirm Modal */}
            {showBulkConfirm && (
                <BulkConfirmModal
                    action={bulkAction}
                    count={selectedTickets.length}
                    onConfirm={handleBulkExecute}
                    onCancel={() => setShowBulkConfirm(false)}
                    isExecuting={isBulkExecuting}
                />
            )}

            {/* 5. High-Density Data Terminal */}
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
                        <button onClick={retry} className="px-6 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Retry</button>
                    </div>
                )}

                <div className="overflow-x-auto" role="region" aria-label="Ticket management results" tabIndex={0}>
                    <table id="ticket-management-table" className="w-full border-collapse" aria-label="Ticket management table" aria-rowcount={filteredTickets.length}>
                        <thead>
                            <tr className="bg-slate-50/80 border-b border-slate-100">
                                {/* Select All Checkbox */}
                                <th scope="col" className="px-4 py-5 text-center w-12">
                                    <button
                                        id="select-all-checkbox"
                                        type="button"
                                        onClick={handleSelectAll}
                                        aria-label={isAllSelected ? `Deselect all ${filteredTickets.length} visible tickets` : `Select all ${filteredTickets.length} visible tickets`}
                                        aria-pressed={isAllSelected}
                                        aria-controls="ticket-management-table"
                                        className="text-slate-400 hover:text-indigo-600 transition-colors relative"
                                        title={isAllSelected ? 'Deselect all' : 'Select all'}
                                    >
                                        {isAllSelected ? (
                                            <CheckSquare size={18} className="text-indigo-600" />
                                        ) : isSomeSelected ? (
                                            <div className="relative">
                                                <Square size={18} />
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <div className="w-2 h-0.5 bg-indigo-500 rounded" />
                                                </div>
                                            </div>
                                        ) : (
                                            <Square size={18} />
                                        )}
                                    </button>
                                </th>
                                <th scope="col" className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                    <div className="flex items-center gap-2">
                                        ID
                                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                                    </div>
                                </th>
                                <th scope="col" className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">User</th>
                                <th scope="col" className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Subject</th>
                                <th scope="col" className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Priority</th>
                                <th scope="col" className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">AI Score</th>
                                <th scope="col" className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Agent</th>
                                <th scope="col" className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                                <th scope="col" className="px-6 py-5 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">SLA</th>
                                <th scope="col" className="px-6 py-5 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {filteredTickets.map((ticket) => {
                                const wasLiveChanged = String(lastChangedTicketId) === String(ticket.id);
                                const isSelected = selectedTickets.includes(ticket.id);
                                const slaState = (ticket.sla_status || '').toUpperCase();
                                const slaRowClass =
                                    slaState === 'BREACHED' ? 'bg-red-50/60 ring-1 ring-red-100' :
                                    slaState === 'WARNING'  ? 'bg-amber-50/50 ring-1 ring-amber-100' : '';

                                return (
                                <tr
                                    key={ticket.id}
                                    aria-selected={isSelected}
                                    className={`hover:bg-slate-50/50 transition-colors group ${
                                        wasLiveChanged ? 'bg-emerald-50/70 ring-1 ring-emerald-100' : slaRowClass
                                    } ${isUpdating === ticket.id ? 'opacity-50 pointer-events-none' : ''} ${
                                        isSelected ? 'bg-indigo-50/40 ring-1 ring-indigo-100' : ''
                                    }`}
                                >
                                    {/* Row Checkbox */}
                                    <td className="px-4 py-6 text-center">
                                        <button
                                            type="button"
                                            onClick={() => handleSelectTicket(ticket.id)}
                                            aria-label={`${isSelected ? 'Deselect' : 'Select'} ticket ${formatTicketId(ticket.id)}`}
                                            aria-pressed={isSelected}
                                            className="text-slate-300 hover:text-indigo-600 transition-colors"
                                        >
                                            {isSelected
                                                ? <CheckSquare size={16} className="text-indigo-600" />
                                                : <Square size={16} />
                                            }
                                        </button>
                                    </td>

                                    {/* Ticket ID */}
                                    <td className="px-6 py-6">
                                        <span className="font-mono text-xs font-black text-emerald-600">#{formatTicketId(ticket.id)}</span>
                                    </td>

                                    {/* User */}
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
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-slate-700 truncate max-w-[200px]" title={ticket.summary || ticket.subject}>
                                                    {ticket.summary || ticket.subject}
                                                </span>
                                                {ticket.metadata?.spam_analysis?.is_spam && (
                                                    <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider flex items-center gap-1 ${
                                                        ticket.metadata.spam_analysis.risk_level === 'high'
                                                            ? 'bg-red-100 text-red-700 border border-red-200'
                                                            : 'bg-amber-100 text-amber-700 border border-amber-200'
                                                    }`}>
                                                        <ShieldAlert size={10} />
                                                        {ticket.metadata.spam_analysis.risk_level} Risk
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                {ticket.category}
                                                <span className="text-[9px] font-medium text-slate-300">• {formatTimelineDate(ticket.created_at)}</span>
                                            </span>
                                            <LanguageBadge detectedLanguage={ticket?.detected_language} compact />
                                        </div>
                                    </td>

                                    {/* Priority (Editable) */}
                                    <td className="px-6 py-6">
                                        <select
                                            value={String(ticket.priority || 'medium').toLowerCase()}
                                            onChange={(e) => handleUpdateTicket(ticket.id, { priority: e.target.value })}
                                            aria-label={`Change priority for ticket ${formatTicketId(ticket.id)}`}
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

                                    {/* Assigned Team */}
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
                                                    aria-label={`Change assigned agent for ticket ${formatTicketId(ticket.id)}`}
                                                    className="bg-transparent text-[10px] font-black text-indigo-600 uppercase tracking-tight italic border-none focus:ring-0 cursor-pointer hover:underline"
                                                >
                                                    {agents.map(a => (
                                                        <option key={a.id} value={a.id}>{a.full_name}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => handleUpdateTicket(ticket.id, {
                                                        assigned_agent_id: user.id,
                                                        status: 'in progress'
                                                    })}
                                                    aria-label={`Claim ticket ${formatTicketId(ticket.id)}`}
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
                                            <div className={`w-1.5 h-1.5 rounded-full ${
                                                ticket.status?.toLowerCase() === 'resolved' || ticket.status?.toLowerCase() === 'closed'
                                                    ? 'bg-emerald-400'
                                                    : ticket.status?.toLowerCase() === 'spam'
                                                        ? 'bg-slate-400 border border-slate-500'
                                                        : 'bg-amber-500 animate-pulse'
                                            }`}></div>
                                            <Select
                                                value={String(ticket.status || 'open').toLowerCase()}
                                                onChange={(e) => handleUpdateTicket(ticket.id, { status: e.target.value })}
                                                aria-label={`Change status for ticket ${formatTicketId(ticket.id)}`}
                                                buttonClassName="bg-transparent text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase tracking-widest outline-none cursor-pointer flex justify-between items-center w-full"
                                                options={statuses.filter(s => s !== 'All').map(s => ({ value: s.toLowerCase(), label: s }))}
                                            />
                                        </div>
                                    </td>

                                    {/* SLA Badge */}
                                    <td className="px-6 py-6">
                                        <SLABadge
                                            priority={ticket.priority}
                                            createdAt={ticket.created_at}
                                            slaBreachAt={ticket.sla_breach_at}
                                            slaStatus={ticket.sla_status}
                                            status={ticket.status}
                                            ticketId={ticket.id}
                                        />
                                    </td>

                                    {/* Action: Open Ticket */}
                                    <td className="px-6 py-6 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => navigate(`/admin/ticket/${ticket.id}`)}
                                                aria-label={`Open details for ticket ${formatTicketId(ticket.id)}`}
                                                className="p-2 bg-slate-900 text-white rounded-xl hover:bg-emerald-600 transition-all shadow-lg shadow-slate-900/10 hover:shadow-emerald-500/20"
                                                title="Open Detailed View"
                                            >
                                                <ArrowUpRight size={14} aria-hidden="true" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {!loading && filteredTickets.length === 0 && (
                    <div className="py-32 text-center bg-slate-50/30 w-full flex flex-col items-center">
                        <div className="w-20 h-20 bg-white border border-slate-100 rounded-[2rem] flex items-center justify-center text-slate-200 mb-6 shadow-sm">
                            <Inbox size={40} />
                        </div>
                        <h3 className="text-xl font-black text-slate-900 uppercase italic tracking-tight">No Incidents Found</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium max-w-xs mx-auto mt-2 italic">Refine your search parameters to view more data points.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminTickets;
