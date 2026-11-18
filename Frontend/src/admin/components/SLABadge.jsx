import React from 'react';
import { Clock, AlertTriangle, ShieldCheck, Flame } from 'lucide-react';
import { useSLACountdown } from '../../hooks/useSLACountdown';
import { getVisualAlertClasses, formatTimeRemaining } from '../../utils/slaUtils';

/**
 * SLABadge — Dynamic real-time countdown badge indicating time remaining until SLA breach.
 * Supports P1 (15m), P2 (1h), P3 (4h), and P4 (24h) incidents.
 * Shows a high-contrast amber/red pulsating indicator when < 15% of SLA threshold remains.
 * 
 * Props:
 *  - priority: string ('p1' | 'critical' | 'p2' | 'high' | 'medium' | 'low')
 *  - createdAt: string (ISO date string)
 *  - status: string — if ticket is resolved/closed, shows "SLA Met"
 *  - compact: bool — if true, shows compact label
 *  - ticket: object — optional full ticket object
 */
export default function SLABadge({ priority, createdAt, status, compact = false, ticket }) {
    const ticketObj = ticket || {
        created_at: createdAt,
        priority: priority || 'medium',
        status: status || 'open',
    };

    const sla = useSLACountdown(ticketObj);

    if (!sla) return null;

    if (sla.isResolved) {
        return (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase tracking-wide whitespace-nowrap">
                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                {!compact && 'SLA Met'}
            </span>
        );
    }

    const { isBreached, isUrgent, urgencyLevel, remainingMs } = sla;
    const badgeColorClasses = getVisualAlertClasses(urgencyLevel, { isBadge: true });

    let Icon = Clock;
    if (isBreached) {
        Icon = Flame;
    } else if (isUrgent) {
        Icon = AlertTriangle;
    }

    return (
        <span
            className={`inline-flex items-center gap-1.5 text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border uppercase tracking-wide whitespace-nowrap ${badgeColorClasses}`}
            title={`Tier: ${sla.priority.toUpperCase()} | Remaining: ${formatTimeRemaining(remainingMs)}`}
        >
            <Icon className={`w-3 h-3 ${isUrgent ? 'animate-pulse' : ''}`} />
            {isBreached
                ? 'SLA Breached'
                : formatTimeRemaining(remainingMs, { digital: true })}
        </span>
    );
}
