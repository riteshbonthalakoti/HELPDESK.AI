import React from 'react';
import { Clock, AlertTriangle, ShieldCheck, Flame } from 'lucide-react';
import { useSLACountdown } from '../../hooks/useSLACountdown';
import { getVisualAlertClasses, formatTimeRemaining } from '../../utils/slaUtils';

/**
 * SLACountdownTimer — Real-time countdown timer component for tickets.
 * Updates every second without re-rendering parent components or sibling tickets.
 * Displays high-contrast amber/red pulsating indicator when < 15% of SLA threshold remains.
 */
const SLACountdownTimer = ({
    ticket,
    createdAt,
    priority,
    status,
    compact = false,
    showProgress = false,
    className = '',
}) => {
    // Standardize ticket object representation
    const ticketObj = ticket || {
        created_at: createdAt,
        priority: priority || 'medium',
        status: status || 'open',
    };

    const sla = useSLACountdown(ticketObj);

    if (!sla) return null;

    if (sla.isResolved) {
        return (
            <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase whitespace-nowrap bg-emerald-50 text-emerald-700 border border-emerald-200 ${className}`}
            >
                <ShieldCheck size={12} className="text-emerald-600" />
                <span>{compact ? 'Met' : 'SLA Met'}</span>
            </span>
        );
    }

    const { isBreached, isUrgent, urgencyLevel, remainingMs, percentageRemaining } = sla;

    const badgeClasses = getVisualAlertClasses(urgencyLevel, { isBadge: true });

    let Icon = Clock;
    if (isBreached) {
        Icon = Flame;
    } else if (isUrgent) {
        Icon = AlertTriangle;
    }

    return (
        <div className={`inline-flex flex-col gap-1 ${className}`}>
            <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wide uppercase whitespace-nowrap border ${badgeClasses}`}
                title={`Priority: ${sla.priority.toUpperCase()} | Remaining: ${formatTimeRemaining(remainingMs)}`}
            >
                <Icon size={12} className={isUrgent ? 'animate-pulse' : ''} />
                <span>
                    {isBreached
                        ? compact
                            ? 'Breached'
                            : formatTimeRemaining(remainingMs, { compact: false })
                        : formatTimeRemaining(remainingMs, { digital: true })}
                </span>
            </span>

            {showProgress && (
                <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-500 ${
                            isBreached
                                ? 'bg-red-600 animate-pulse'
                                : isUrgent
                                ? 'bg-amber-500 animate-pulse'
                                : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, percentageRemaining))}%` }}
                    />
                </div>
            )}
        </div>
    );
};

export default SLACountdownTimer;
