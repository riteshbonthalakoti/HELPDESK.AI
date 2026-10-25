import React, { useEffect, useMemo, useState, useRef } from 'react';
import axios from 'axios';
import { AlertTriangle, ArrowRight, History, Loader2, ShieldCheck, Sparkles, User } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { API_CONFIG } from '../../config';
import { formatFullTimestamp, formatRelativeTime, safeParseDateForSort } from '../../utils/dateUtils';

const ACTION_META = {
    TICKET_CREATED: {
        label: 'Ticket Created',
        tone: 'emerald',
        icon: Sparkles,
        description: 'The ticket entered the secure audit trail.'
    },
    STATUS_CHANGED: {
        label: 'Status Changed',
        tone: 'blue',
        icon: ArrowRight,
        description: 'The ticket status was updated.'
    },
    STATUS_ESCALATED: {
        label: 'Status Escalated',
        tone: 'orange',
        icon: AlertTriangle,
        description: 'The ticket moved into an escalation state.'
    },
    PRIORITY_CHANGED: {
        label: 'Priority Changed',
        tone: 'amber',
        icon: ArrowRight,
        description: 'The ticket priority was revised.'
    },
    PRIORITY_ESCALATED: {
        label: 'Priority Escalated',
        tone: 'red',
        icon: AlertTriangle,
        description: 'The ticket priority increased.'
    },
    TICKET_ASSIGNED: {
        label: 'Ticket Assigned',
        tone: 'emerald',
        icon: User,
        description: 'Ownership was reassigned.'
    },
    TEAM_ROUTED: {
        label: 'Team Routed',
        tone: 'emerald',
        icon: ShieldCheck,
        description: 'The ticket was routed to a new support team.'
    },
    METADATA_UPDATED: {
        label: 'Metadata Updated',
        tone: 'slate',
        icon: History,
        description: 'Supporting details changed on the ticket.'
    },
    AUTO_ESCALATED: {
        label: 'Auto Escalated',
        tone: 'red',
        icon: AlertTriangle,
        description: 'A scheduled escalation rule fired automatically.'
    }
};

const TONE_CLASSES = {
    emerald: 'border-emerald-200 bg-emerald-50/80 text-emerald-700',
    blue: 'border-blue-200 bg-blue-50/80 text-blue-700',
    amber: 'border-amber-200 bg-amber-50/80 text-amber-700',
    orange: 'border-orange-200 bg-orange-50/80 text-orange-700',
    red: 'border-red-200 bg-red-50/80 text-red-700',
    slate: 'border-slate-200 bg-slate-50/80 text-slate-700'
};

const formatFieldValue = (value) => {
    if (value === null || value === undefined || value === '') return 'None';
    if (typeof value === 'object') {
        if ('value' in value) return formatFieldValue(value.value);
        if ('reason' in value) return String(value.reason);
        return JSON.stringify(value);
    }
    return String(value);
};

const extractValue = (value) => {
    if (value && typeof value === 'object' && 'value' in value) return value.value;
    return value;
};

const getActorLabel = (record) => {
    const profile = record.performed_by_profile;
    if (profile?.full_name) return profile.full_name;
    if (profile?.email) return profile.email;
    if (record.performed_by) return 'System / API';
    return 'System';
};

const buildChangeDescription = (record) => {
    const action = record.action || 'TICKET_UPDATED';
    if (action === 'TICKET_CREATED') return 'Ticket was created and entered the audit ledger.';
    if (action === 'AUTO_ESCALATED') {
        const reason = record.new_value?.reason || record.old_value?.reason || 'stale state';
        return `Automated escalation logged because the ticket remained ${reason}.`;
    }

    const field = record.old_value?.field || record.new_value?.field || 'value';
    const previous = formatFieldValue(extractValue(record.old_value));
    const next = formatFieldValue(extractValue(record.new_value));

    if (action === 'STATUS_CHANGED' || action === 'STATUS_ESCALATED') {
        return `Status changed from ${previous} to ${next}.`;
    }
    if (action === 'PRIORITY_CHANGED' || action === 'PRIORITY_ESCALATED') {
        return `Priority moved from ${previous} to ${next}.`;
    }
    if (action === 'TICKET_ASSIGNED') {
        return `Assignment updated from ${previous} to ${next}.`;
    }
    if (action === 'TEAM_ROUTED') {
        return `Support routing changed from ${previous} to ${next}.`;
    }
    if (action === 'METADATA_UPDATED') {
        return `Context metadata was updated for ${field}.`;
    }

    return `Audited field ${field} changed from ${previous} to ${next}.`;
};

const buildBadgeTitle = (record) => {
    const action = record.action || 'TICKET_UPDATED';
    const meta = ACTION_META[action];
    return meta?.description || 'Tracked ticket mutation';
};

const mergeLogs = (existing, incoming) => {
    const map = new Map();
    [...existing, ...incoming].forEach((item) => {
        if (item?.id) map.set(item.id, item);
    });
    return Array.from(map.values()).sort((a, b) => safeParseDateForSort(a.created_at) - safeParseDateForSort(b.created_at));
};

const TicketAuditTimeline = ({ ticketId, companyId }) => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;

        if (!ticketId || !companyId) {
            setLogs([]);
            setLoading(false);
            return undefined;
        }

        // cancelled ref removed

        const loadLogs = async () => {
            setLoading(true);
            setError(null);
            try {
                const { data } = await axios.get(`${API_CONFIG.BACKEND_URL}/tickets/${ticketId}/audit_logs`, {
                    params: { company_id: companyId }
                });

                if (mountedRef.current) {
                    setLogs(Array.isArray(data) ? data : []);
                }
            } catch (err) {
                if (mountedRef.current) {
                    setError(err?.response?.data?.detail || err.message || 'Failed to load audit history.');
                }
            } finally {
                if (mountedRef.current) setLoading(false);
            }
        };

        loadLogs();

        const channel = supabase
            .channel(`ticket_audit_${ticketId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'audit_logs',
                    filter: `ticket_id=eq.${ticketId}`
                },
                (payload) => {
                    if (mountedRef.current) setLogs((current) => mergeLogs(current, [payload.new]));
                }
            )
            .subscribe();

        return () => {
            mountedRef.current = false;
            supabase.removeChannel(channel);
        };
    }, [ticketId, companyId]);

    const hasLogs = useMemo(() => logs.length > 0, [logs.length]);

    return (
        <section className="rounded-[28px] border border-emerald-100/70 bg-white/70 backdrop-blur-xl shadow-[0_18px_60px_rgba(15,31,18,0.08)] overflow-hidden">
            <div className="px-6 sm:px-8 pt-6 pb-5 border-b border-emerald-50 bg-gradient-to-r from-white/90 via-emerald-50/60 to-white/80">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-500/20">
                        <History className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-[0.24em] font-black text-emerald-500">Audit Log Timeline</p>
                        <h3 className="text-lg font-black text-slate-900">Secure change history</h3>
                    </div>
                    <span className="ml-auto text-[10px] uppercase tracking-[0.18em] font-black text-slate-400 bg-white/80 border border-slate-100 rounded-full px-3 py-1">
                        Chronological
                    </span>
                </div>
            </div>

            <div className="px-6 sm:px-8 py-6">
                {loading ? (
                    <div className="flex items-center gap-3 text-sm font-semibold text-slate-500 dark:text-slate-400">
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                        Loading secure audit history...
                    </div>
                ) : error ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700">
                        {error}
                    </div>
                ) : !hasLogs ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-sm text-slate-500 dark:text-slate-400">
                        No audit events have been recorded yet.
                    </div>
                ) : (
                    <div className="relative space-y-4 before:absolute before:left-[14px] before:top-1 before:bottom-1 before:w-px before:bg-gradient-to-b before:from-emerald-200 before:via-slate-200 before:to-transparent">
                        {logs.map((record) => {
                            const meta = ACTION_META[record.action] || ACTION_META.METADATA_UPDATED;
                            const Icon = meta.icon;
                            const toneClass = TONE_CLASSES[meta.tone] || TONE_CLASSES.slate;
                            const actorLabel = getActorLabel(record);
                            const description = buildChangeDescription(record);
                            const fieldName = record.old_value?.field || record.new_value?.field || record.action || 'event';
                            const previousValue = formatFieldValue(extractValue(record.old_value));
                            const nextValue = formatFieldValue(extractValue(record.new_value));

                            return (
                                <article key={record.id} className="relative pl-10">
                                    <div className={`absolute left-[6px] top-4 w-4 h-4 rounded-full border-4 border-white shadow ${record.action?.includes('ESCALATED') ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
                                    <div className="rounded-[22px] border border-slate-100 bg-white/80 backdrop-blur-md shadow-[0_12px_30px_rgba(15,31,18,0.06)] p-4 sm:p-5">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="space-y-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span
                                                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${toneClass}`}
                                                        title={buildBadgeTitle(record)}
                                                    >
                                                        <Icon className="w-3.5 h-3.5" />
                                                        {meta.label}
                                                    </span>
                                                    <span className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-400">
                                                        {fieldName}
                                                    </span>
                                                </div>
                                                <p className="text-sm font-semibold text-slate-900 leading-6">
                                                    {description}
                                                </p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-[10px] uppercase tracking-[0.18em] font-black text-slate-400">Performed By</p>
                                                <p className="text-sm font-bold text-slate-800" title={record.performed_by || 'System generated'}>
                                                    {actorLabel}
                                                </p>
                                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1" title={formatFullTimestamp(record.created_at)}>
                                                    {formatRelativeTime(record.created_at)}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                                                <p className="text-[10px] uppercase tracking-[0.18em] font-black text-slate-400 mb-1">Previous Value</p>
                                                <p className="text-sm font-semibold text-slate-800 break-words">{previousValue}</p>
                                            </div>
                                            <div className="rounded-2xl border border-slate-100 bg-emerald-50/70 p-3">
                                                <p className="text-[10px] uppercase tracking-[0.18em] font-black text-emerald-500 mb-1">Current Value</p>
                                                <p className="text-sm font-semibold text-emerald-900 break-words">{nextValue}</p>
                                            </div>
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </div>
        </section>
    );
};

export default TicketAuditTimeline;
