/**
 * Utility functions for computing average ticket resolution durations
 * grouped by weekday ranges for interactive analytical charts.
 */

export const WEEKDAYS = [
    { key: 'mon', label: 'Monday', short: 'Mon', index: 1 },
    { key: 'tue', label: 'Tuesday', short: 'Tue', index: 2 },
    { key: 'wed', label: 'Wednesday', short: 'Wed', index: 3 },
    { key: 'thu', label: 'Thursday', short: 'Thu', index: 4 },
    { key: 'fri', label: 'Friday', short: 'Fri', index: 5 },
    { key: 'sat', label: 'Saturday', short: 'Sat', index: 6 },
    { key: 'sun', label: 'Sunday', short: 'Sun', index: 0 },
];

/**
 * Parses timestamps and computes duration in fractional hours.
 * Returns null if either timestamp is invalid or resolved is earlier than created.
 */
export function calculateResolutionDurationHours(createdAt, resolvedAt) {
    if (!createdAt || !resolvedAt) return null;
    const createdTime = new Date(createdAt).getTime();
    const resolvedTime = new Date(resolvedAt).getTime();

    if (isNaN(createdTime) || isNaN(resolvedTime)) return null;
    const diffMs = resolvedTime - createdTime;
    if (diffMs < 0) return 0; // Guard against clocks out of sync

    return parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));
}

/**
 * Resolves the effective resolved timestamp from a ticket object.
 */
export function getTicketResolvedTimestamp(ticket) {
    if (!ticket) return null;
    const isResolved =
        ticket.status?.toLowerCase().includes('resolv') ||
        ticket.status?.toLowerCase().includes('closed');

    if (!isResolved) return null;

    return (
        ticket.resolved_at ||
        ticket.metadata?.resolved_at ||
        ticket.metadata?.completed_at ||
        ticket.updated_at ||
        null
    );
}

/**
 * Formats fractional hours into human readable "Xh Ym" or "< 1m".
 */
export function formatDurationHours(hours) {
    if (hours === null || hours === undefined || isNaN(hours)) return 'N/A';
    if (hours <= 0) return '0m';

    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

/**
 * Groups tickets by individual weekday (Mon -> Sun).
 */
export function groupResolutionByWeekday(tickets = [], options = {}) {
    const { targetSlaHours = 4 } = options;

    const buckets = {
        Mon: { key: 'Mon', label: 'Monday', dayIndex: 1, durations: [], totalResolved: 0, openTickets: 0 },
        Tue: { key: 'Tue', label: 'Tuesday', dayIndex: 2, durations: [], totalResolved: 0, openTickets: 0 },
        Wed: { key: 'Wed', label: 'Wednesday', dayIndex: 3, durations: [], totalResolved: 0, openTickets: 0 },
        Thu: { key: 'Thu', label: 'Thursday', dayIndex: 4, durations: [], totalResolved: 0, openTickets: 0 },
        Fri: { key: 'Fri', label: 'Friday', dayIndex: 5, durations: [], totalResolved: 0, openTickets: 0 },
        Sat: { key: 'Sat', label: 'Saturday', dayIndex: 6, durations: [], totalResolved: 0, openTickets: 0 },
        Sun: { key: 'Sun', label: 'Sunday', dayIndex: 0, durations: [], totalResolved: 0, openTickets: 0 },
    };

    tickets.forEach((t) => {
        if (!t?.created_at) return;
        const createdDate = new Date(t.created_at);
        if (isNaN(createdDate.getTime())) return;

        const dayNum = createdDate.getDay(); // 0 = Sun, 1 = Mon ...
        const weekdayObj = WEEKDAYS.find((w) => w.index === dayNum) || WEEKDAYS[0];
        const bucket = buckets[weekdayObj.short];

        const resolvedAt = getTicketResolvedTimestamp(t);
        if (resolvedAt) {
            const duration = calculateResolutionDurationHours(t.created_at, resolvedAt);
            if (duration !== null) {
                bucket.durations.push(duration);
                bucket.totalResolved += 1;
            }
        } else {
            bucket.openTickets += 1;
        }
    });

    const orderedKeys = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    return orderedKeys.map((key) => {
        const b = buckets[key];
        const count = b.durations.length;

        if (count === 0) {
            return {
                day: key,
                label: b.label,
                avgDurationHours: 0,
                medianDurationHours: 0,
                minDurationHours: 0,
                maxDurationHours: 0,
                totalResolved: 0,
                openTickets: b.openTickets,
                slaTargetHours: targetSlaHours,
                slaComplianceRate: 100,
                formattedAvg: '0h',
            };
        }

        const sum = b.durations.reduce((acc, d) => acc + d, 0);
        const avg = parseFloat((sum / count).toFixed(2));

        const sorted = [...b.durations].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median =
            sorted.length % 2 !== 0
                ? sorted[mid]
                : parseFloat(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));

        const min = sorted[0];
        const max = sorted[sorted.length - 1];

        const withinSla = sorted.filter((d) => d <= targetSlaHours).length;
        const compliance = parseFloat(((withinSla / count) * 100).toFixed(1));

        return {
            day: key,
            label: b.label,
            avgDurationHours: avg,
            medianDurationHours: median,
            minDurationHours: min,
            maxDurationHours: max,
            totalResolved: count,
            openTickets: b.openTickets,
            slaTargetHours: targetSlaHours,
            slaComplianceRate: compliance,
            formattedAvg: formatDurationHours(avg),
        };
    });
}

/**
 * Groups resolution metrics into flexible weekday ranges:
 * - 'daily': Monday through Sunday
 * - 'weekday_weekend': 'Weekdays (Mon-Fri)' vs 'Weekend (Sat-Sun)'
 * - 'tri_range': 'Early Week (Mon-Tue)', 'Mid Week (Wed-Thu)', 'Weekend & Wrap (Fri-Sun)'
 */
export function groupResolutionByWeekdayRange(tickets = [], rangeMode = 'daily', options = {}) {
    const dailyData = groupResolutionByWeekday(tickets, options);
    const { targetSlaHours = 4 } = options;

    if (rangeMode === 'weekday_weekend') {
        const weekdays = dailyData.slice(0, 5); // Mon to Fri
        const weekend = dailyData.slice(5, 7); // Sat, Sun

        const aggregateRange = (items, rangeKey, rangeLabel) => {
            const totalResolved = items.reduce((acc, item) => acc + item.totalResolved, 0);
            const openTickets = items.reduce((acc, item) => acc + item.openTickets, 0);

            if (totalResolved === 0) {
                return {
                    day: rangeKey,
                    label: rangeLabel,
                    avgDurationHours: 0,
                    medianDurationHours: 0,
                    minDurationHours: 0,
                    maxDurationHours: 0,
                    totalResolved: 0,
                    openTickets,
                    slaTargetHours: targetSlaHours,
                    slaComplianceRate: 100,
                    formattedAvg: '0h',
                };
            }

            const totalWeightedHours = items.reduce((acc, item) => acc + item.avgDurationHours * item.totalResolved, 0);
            const avg = parseFloat((totalWeightedHours / totalResolved).toFixed(2));
            const weightedCompliance = items.reduce((acc, item) => acc + item.slaComplianceRate * item.totalResolved, 0);
            const compliance = parseFloat((weightedCompliance / totalResolved).toFixed(1));
            const min = Math.min(...items.map((i) => (i.totalResolved > 0 ? i.minDurationHours : Infinity)));
            const max = Math.max(...items.map((i) => i.maxDurationHours));

            return {
                day: rangeKey,
                label: rangeLabel,
                avgDurationHours: avg,
                medianDurationHours: avg,
                minDurationHours: isFinite(min) ? min : 0,
                maxDurationHours: max,
                totalResolved,
                openTickets,
                slaTargetHours: targetSlaHours,
                slaComplianceRate: compliance,
                formattedAvg: formatDurationHours(avg),
            };
        };

        return [
            aggregateRange(weekdays, 'Mon - Fri', 'Standard Business Days'),
            aggregateRange(weekend, 'Sat - Sun', 'Weekend Hours'),
        ];
    }

    if (rangeMode === 'tri_range') {
        const early = dailyData.slice(0, 2); // Mon, Tue
        const mid = dailyData.slice(2, 4); // Wed, Thu
        const wrap = dailyData.slice(4, 7); // Fri, Sat, Sun

        const aggregateRange = (items, rangeKey, rangeLabel) => {
            const totalResolved = items.reduce((acc, item) => acc + item.totalResolved, 0);
            const openTickets = items.reduce((acc, item) => acc + item.openTickets, 0);

            if (totalResolved === 0) {
                return {
                    day: rangeKey,
                    label: rangeLabel,
                    avgDurationHours: 0,
                    medianDurationHours: 0,
                    minDurationHours: 0,
                    maxDurationHours: 0,
                    totalResolved: 0,
                    openTickets,
                    slaTargetHours: targetSlaHours,
                    slaComplianceRate: 100,
                    formattedAvg: '0h',
                };
            }

            const totalWeightedHours = items.reduce((acc, item) => acc + item.avgDurationHours * item.totalResolved, 0);
            const avg = parseFloat((totalWeightedHours / totalResolved).toFixed(2));
            const weightedCompliance = items.reduce((acc, item) => acc + item.slaComplianceRate * item.totalResolved, 0);
            const compliance = parseFloat((weightedCompliance / totalResolved).toFixed(1));
            const min = Math.min(...items.map((i) => (i.totalResolved > 0 ? i.minDurationHours : Infinity)));
            const max = Math.max(...items.map((i) => i.maxDurationHours));

            return {
                day: rangeKey,
                label: rangeLabel,
                avgDurationHours: avg,
                medianDurationHours: avg,
                minDurationHours: isFinite(min) ? min : 0,
                maxDurationHours: max,
                totalResolved,
                openTickets,
                slaTargetHours: targetSlaHours,
                slaComplianceRate: compliance,
                formattedAvg: formatDurationHours(avg),
            };
        };

        return [
            aggregateRange(early, 'Mon - Tue', 'Early Week'),
            aggregateRange(mid, 'Wed - Thu', 'Mid Week'),
            aggregateRange(wrap, 'Fri - Sun', 'Weekend Wrap'),
        ];
    }

    return dailyData;
}
