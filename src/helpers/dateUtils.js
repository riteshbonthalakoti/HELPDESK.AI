import { formatDistance } from 'date-fns';

/**
 * Unified Date Utility for HELPDESK.AI
 * Fixes timezone shift issues by explicitly forcing local display.
 */

// Shared UTC-safe parser used by every formatter below, so relative and
// absolute timestamps always agree on the same underlying instant.
const parseDate = (dateStr) => {
    if (!dateStr) return null;

    // Ensure the date string is interpreted as UTC if it's an ISO string from DB
    let date;
    if (typeof dateStr === 'string' && !dateStr.includes('Z') && !dateStr.includes('+')) {
        // If it's a raw string without TZ, assume it was intended as UTC from our backend
        date = new Date(dateStr + 'Z');
    } else {
        date = new Date(dateStr);
    }

    return date;
};

export const formatTimelineDate = (dateStr) => {
    const date = parseDate(dateStr);
    if (!date) return null;
    if (isNaN(date.getTime())) return 'Invalid Date';

    // Using the browser's default locale and timeZone (which is the user's local)
    return date.toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
};

/**
 * Dynamic relative timestamp, e.g. "3 hours ago", "2 days ago".
 * Powered by date-fns' formatDistance so ticket views feel "live".
 */
export const formatRelativeTime = (dateStr) => {
    const date = parseDate(dateStr);
    if (!date) return null;
    if (isNaN(date.getTime())) return 'Invalid Date';

    return formatDistance(date, new Date(), { addSuffix: true });
};

export const getTimeZoneAbbr = () => {
    try {
        return new Intl.DateTimeFormat('en-US', {
            timeZoneName: 'short'
        })
        .formatToParts(new Date())
        .find(part => part.type === 'timeZoneName')?.value || 'IST';
    } catch (_e) {
        return 'IST';
    }
};

export const formatFullTimestamp = (dateStr) => {
    const formatted = formatTimelineDate(dateStr);
    if (!formatted) return 'Processing...';
    return `${formatted} (${getTimeZoneAbbr()})`;
};