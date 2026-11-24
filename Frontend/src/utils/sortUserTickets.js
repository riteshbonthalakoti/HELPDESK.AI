import { normalizePriority } from './slaUtils';

const priorityRank = { p4: 0, p3: 1, p2: 2, p1: 3 };
const compareText = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });

/** Sort a copy; missing dates remain last in either direction. IDs break ties
 * independently of direction so realtime delivery order cannot shuffle rows. */
export function sortUserTickets(tickets, { field, direction }) {
    const factor = direction === 'asc' ? 1 : -1;
    return [...tickets].sort((a, b) => {
        let result = 0;
        if (field === 'created_at') {
            const left = a.created_at ? Date.parse(a.created_at) : NaN;
            const right = b.created_at ? Date.parse(b.created_at) : NaN;
            if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
            if (Number.isFinite(left)) result = left - right;
        } else if (field === 'priority') {
            result = priorityRank[normalizePriority(a.priority)] - priorityRank[normalizePriority(b.priority)];
        } else if (field === 'status') {
            result = compareText(a.status || 'open', b.status || 'open');
        } else if (field === 'id') {
            result = compareText(a.id, b.id);
        }
        return result * factor || compareText(a.id, b.id);
    });
}
