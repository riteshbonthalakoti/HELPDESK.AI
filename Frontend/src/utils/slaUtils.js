/**
 * SLA Tracking & Target Bound Utilities (issue #3904)
 * Precision duration offsets, target bounds, and status thresholds.
 */

export const SLA_PRIORITY_HOURS = {
  critical: 1,
  high: 4,
  medium: 24,
  low: 48,
  normal: 48,
};

export const RESOLVED_STATUSES = new Set([
  'resolved',
  'closed',
  'auto-resolved',
  'completed',
]);

/**
 * Returns target duration in milliseconds for a priority or custom hour target.
 */
export function getSlaTargetMs(priority = 'normal', customHours = null) {
  if (typeof customHours === 'number' && customHours > 0) {
    return customHours * 60 * 60 * 1000;
  }
  const key = String(priority || 'normal').toLowerCase();
  const hours = SLA_PRIORITY_HOURS[key] ?? SLA_PRIORITY_HOURS.normal;
  return hours * 60 * 60 * 1000;
}

/**
 * Calculates current SLA countdown offsets and status against ticket bounds.
 */
export function calculateSlaCountdown(createdAt, priority = 'normal', options = {}) {
  const {
    now = Date.now(),
    ticketStatus = '',
    customHours = null,
    resolvedAt = null,
  } = options;

  const isResolved = RESOLVED_STATUSES.has(String(ticketStatus).toLowerCase());
  const createdMs = new Date(createdAt).getTime();
  const targetMs = getSlaTargetMs(priority, customHours);
  const deadlineMs = createdMs + targetMs;

  if (isNaN(createdMs)) {
    return {
      isValid: false,
      status: 'unknown',
      remainingMs: 0,
      elapsedMs: 0,
      progressPct: 0,
      deadline: new Date(),
      isResolved: false,
      isBreached: false,
    };
  }

  if (isResolved) {
    const endMs = resolvedAt ? new Date(resolvedAt).getTime() : now;
    const finalElapsed = Math.max(0, endMs - createdMs);
    const met = finalElapsed <= targetMs;
    return {
      isValid: true,
      status: met ? 'resolved' : 'resolved_breached',
      remainingMs: Math.max(0, targetMs - finalElapsed),
      elapsedMs: finalElapsed,
      targetMs,
      progressPct: 100,
      deadline: new Date(deadlineMs),
      isResolved: true,
      isBreached: !met,
      slaMet: met,
    };
  }

  const elapsedMs = Math.max(0, now - createdMs);
  const remainingMs = deadlineMs - now;
  const isBreached = remainingMs <= 0;
  const progressPct = Math.max(0, Math.min(100, (remainingMs / targetMs) * 100));

  let status = 'on_track';
  if (isBreached) {
    status = 'breached';
  } else if (remainingMs <= targetMs * 0.25) {
    status = 'critical';
  } else if (remainingMs <= targetMs * 0.5) {
    status = 'warning';
  }

  return {
    isValid: true,
    status,
    remainingMs,
    elapsedMs,
    targetMs,
    progressPct,
    deadline: new Date(deadlineMs),
    isResolved: false,
    isBreached,
    slaMet: false,
  };
}

/**
 * Formats a duration in milliseconds to HH:MM:SS or digital ticking clock offset.
 */
export function formatTickingOffset(ms, options = {}) {
  const { showSign = false, compact = false } = options;
  const isNegative = ms < 0;
  const absMs = Math.abs(ms);

  const totalSeconds = Math.floor(absMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const sign = isNegative ? (showSign ? '-' : '') : (showSign ? '+' : '');

  if (compact) {
    if (hours > 0) {
      return `${sign}${hours}h ${minutes}m`;
    }
    return `${sign}${minutes}m ${seconds}s`;
  }

  const pad = (n) => String(n).padStart(2, '0');
  return `${sign}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Color & Theme metadata for SLA statuses.
 */
export function getSlaStatusTheme(status) {
  switch (status) {
    case 'resolved':
      return {
        key: 'resolved',
        label: 'SLA Met',
        primary: '#10B981',
        bg: '#F0FDF4',
        border: '#BBF7D0',
        text: '#15803D',
        ring: '#34D399',
        pulse: false,
      };
    case 'resolved_breached':
      return {
        key: 'resolved_breached',
        label: 'Resolved Post-Breach',
        primary: '#F97316',
        bg: '#FFF7ED',
        border: '#FED7AA',
        text: '#C2410C',
        ring: '#FB923C',
        pulse: false,
      };
    case 'breached':
      return {
        key: 'breached',
        label: 'SLA Breached',
        primary: '#EF4444',
        bg: '#FEF2F2',
        border: '#FECACA',
        text: '#B91C1C',
        ring: '#F87171',
        pulse: true,
      };
    case 'critical':
      return {
        key: 'critical',
        label: 'Urgent SLA',
        primary: '#F97316',
        bg: '#FFF7ED',
        border: '#FED7AA',
        text: '#C2410C',
        ring: '#FB923C',
        pulse: true,
      };
    case 'warning':
      return {
        key: 'warning',
        label: 'Approaching SLA',
        primary: '#F59E0B',
        bg: '#FEFCE8',
        border: '#FDE68A',
        text: '#A16207',
        ring: '#FBBF24',
        pulse: false,
      };
    case 'on_track':
    default:
      return {
        key: 'on_track',
        label: 'SLA On Track',
        primary: '#10B981',
        bg: '#F0FDF4',
        border: '#BBF7D0',
        text: '#15803D',
        ring: '#34D399',
        pulse: false,
      };
  }
}
