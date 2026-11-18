/**
 * @file slaUtils.js
 * @description SLA calculation, breach detection, formatting, and urgency indicators
 * across multiple priority tiers (P1-P4).
 */

export const SLA_THRESHOLDS = {
    p1: 15 * 60 * 1000,          // 15 minutes (P1 Critical)
    p2: 60 * 60 * 1000,          // 1 hour (P2 High)
    p3: 4 * 60 * 60 * 1000,      // 4 hours (P3 Medium)
    p4: 24 * 60 * 60 * 1000,     // 24 hours (P4 Low)
};

/**
 * Normalizes any priority label to standard 'p1' | 'p2' | 'p3' | 'p4' tier.
 * @param {string} priority 
 * @returns {'p1' | 'p2' | 'p3' | 'p4'}
 */
export const normalizePriority = (priority) => {
    if (!priority) return 'p3';
    const p = String(priority).trim().toLowerCase();

    if (p === 'p1' || p.includes('critical') || p === 'urgent' || p.startsWith('p1')) {
        return 'p1';
    }
    if (p === 'p2' || p.includes('high') || p.startsWith('p2')) {
        return 'p2';
    }
    if (p === 'p4' || p.includes('low') || p.startsWith('p4')) {
        return 'p4';
    }
    if (p === 'p3' || p.includes('medium') || p.includes('normal') || p.startsWith('p3')) {
        return 'p3';
    }
    return 'p3';
};

/**
 * Returns SLA threshold in milliseconds for a priority.
 * @param {string} priority
 * @returns {number}
 */
export const getSLADuration = (priority) => {
    const tier = normalizePriority(priority);
    return SLA_THRESHOLDS[tier] || SLA_THRESHOLDS.p3;
};

/**
 * Calculates current SLA status, remaining time, breach status, and urgency level.
 * 
 * @param {Object} params
 * @param {string|Date|number} params.createdAt - Ticket creation timestamp
 * @param {string} [params.priority='medium'] - Priority string ('p1', 'critical', 'p2', etc.)
 * @param {string} [params.status] - Current ticket status
 * @param {string|Date|number} [params.resolvedAt] - Resolution timestamp if resolved
 * @param {number} [params.now=Date.now()] - Current epoch timestamp
 * @returns {Object} SLA calculation result
 */
export const calculateSLABreach = ({
    createdAt,
    priority = 'medium',
    status,
    resolvedAt,
    now = Date.now(),
}) => {
    const normPriority = normalizePriority(priority);
    const thresholdMs = getSLADuration(normPriority);

    const isResolved = Boolean(
        status &&
        ['resolved', 'closed', 'auto-resolved', 'auto resolved'].includes(
            String(status).toLowerCase().trim()
        )
    );

    const createdTime = createdAt ? new Date(createdAt).getTime() : now;
    const validCreatedTime = isNaN(createdTime) ? now : createdTime;

    if (isResolved) {
        const resolvedTime = resolvedAt ? new Date(resolvedAt).getTime() : null;
        const duration = resolvedTime && !isNaN(resolvedTime) ? resolvedTime - validCreatedTime : null;
        const wasMet = duration !== null ? duration <= thresholdMs : true;

        return {
            priority: normPriority,
            thresholdMs,
            elapsedMs: duration !== null ? duration : 0,
            remainingMs: 0,
            percentageRemaining: 100,
            isResolved: true,
            isBreached: !wasMet,
            isUrgent: false,
            urgencyLevel: 'resolved',
            status: wasMet ? 'met' : 'breached_resolved',
            breachedByMs: !wasMet && duration !== null ? Math.max(0, duration - thresholdMs) : 0,
            formattedTime: 'SLA Met',
        };
    }

    const elapsedMs = Math.max(0, now - validCreatedTime);
    const remainingMs = thresholdMs - elapsedMs;
    const isBreached = remainingMs <= 0;
    const percentageRemaining = Math.max(0, (remainingMs / thresholdMs) * 100);

    // Urgent if breached OR remaining time < 15% of SLA threshold
    const isUrgent = isBreached || percentageRemaining < 15;

    let urgencyLevel = 'healthy';
    if (isBreached) {
        urgencyLevel = 'breached';
    } else if (percentageRemaining < 15) {
        urgencyLevel = 'critical'; // < 15% threshold
    } else if (percentageRemaining < 30) {
        urgencyLevel = 'warning';
    } else {
        urgencyLevel = 'healthy';
    }

    return {
        priority: normPriority,
        thresholdMs,
        elapsedMs,
        remainingMs,
        percentageRemaining,
        isResolved: false,
        isBreached,
        isUrgent,
        urgencyLevel,
        breachedByMs: isBreached ? Math.abs(remainingMs) : 0,
        formattedTime: formatTimeRemaining(remainingMs),
    };
};

/**
 * Formats time remaining or breach duration into human-readable strings.
 * 
 * @param {number} remainingMs 
 * @param {Object} [options]
 * @param {boolean} [options.compact=false]
 * @param {boolean} [options.digital=false]
 * @returns {string}
 */
export const formatTimeRemaining = (remainingMs, options = {}) => {
    if (remainingMs === null || remainingMs === undefined) return '--:--';

    if (remainingMs <= 0) {
        const overdueMs = Math.abs(remainingMs);
        const totalSec = Math.floor(overdueMs / 1000);
        const hours = Math.floor(totalSec / 3600);
        const minutes = Math.floor((totalSec % 3600) / 60);
        const seconds = totalSec % 60;

        if (options.compact) {
            return 'Breached';
        }
        if (hours > 0) {
            return `Breached (${hours}h ${minutes}m ago)`;
        }
        if (minutes > 0) {
            return `Breached (${minutes}m ago)`;
        }
        return `Breached (${seconds}s ago)`;
    }

    const totalSec = Math.floor(remainingMs / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    if (options.digital) {
        const mm = String(minutes).padStart(2, '0');
        const ss = String(seconds).padStart(2, '0');
        if (hours > 0) {
            const hh = String(hours).padStart(2, '0');
            return `${hh}:${mm}:${ss}`;
        }
        return `${mm}:${ss}`;
    }

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
};

/**
 * Returns Tailwind visual alert styling classes based on urgency level.
 * 
 * @param {'resolved'|'breached'|'critical'|'warning'|'healthy'} urgencyLevel 
 * @param {Object} [options]
 * @param {boolean} [options.isCard=false]
 * @param {boolean} [options.isRow=false]
 * @param {boolean} [options.isBadge=false]
 * @returns {string} Tailwind classes
 */
export const getVisualAlertClasses = (urgencyLevel, options = {}) => {
    const { isCard = false, isRow = false, isBadge = false } = options;

    switch (urgencyLevel) {
        case 'breached':
            if (isRow || isCard) {
                return 'bg-red-500/10 border-red-500 ring-2 ring-red-500/80 shadow-lg shadow-red-500/20 animate-pulse';
            }
            if (isBadge) {
                return 'bg-red-100 text-red-700 border-red-300 animate-pulse';
            }
            return 'text-red-600 bg-red-50 border-red-200 animate-pulse';

        case 'critical': // < 15% SLA threshold
            if (isRow || isCard) {
                return 'bg-amber-500/10 border-amber-500 ring-2 ring-amber-500/80 shadow-lg shadow-amber-500/20 animate-pulse';
            }
            if (isBadge) {
                return 'bg-amber-100 text-amber-900 border-amber-400 animate-pulse';
            }
            return 'text-amber-800 bg-amber-50 border-amber-300 animate-pulse';

        case 'warning':
            if (isRow || isCard) {
                return 'border-amber-200/80 bg-amber-50/30';
            }
            if (isBadge) {
                return 'bg-amber-50 text-amber-700 border-amber-200';
            }
            return 'text-amber-700 bg-amber-50 border-amber-200';

        case 'resolved':
            if (isBadge) {
                return 'bg-emerald-50 text-emerald-700 border-emerald-200';
            }
            return 'text-emerald-700 bg-emerald-50 border-emerald-100';

        case 'healthy':
        default:
            if (isBadge) {
                return 'bg-emerald-50 text-emerald-700 border-emerald-200';
            }
            return 'text-slate-600 bg-slate-50 border-slate-200';
    }
};
