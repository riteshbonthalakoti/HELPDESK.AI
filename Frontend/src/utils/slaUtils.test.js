/**
 * @file slaUtils.test.js
 * @description Unit tests for SLA calculation utility across multiple priority tiers.
 */

import { describe, it, expect } from 'vitest';
import {
    SLA_THRESHOLDS,
    normalizePriority,
    getSLADuration,
    calculateSLABreach,
    formatTimeRemaining,
    getVisualAlertClasses,
} from './slaUtils';

describe('slaUtils', () => {
    describe('normalizePriority', () => {
        it('normalizes P1 / Critical variants', () => {
            expect(normalizePriority('p1')).toBe('p1');
            expect(normalizePriority('P1')).toBe('p1');
            expect(normalizePriority('critical')).toBe('p1');
            expect(normalizePriority('CRITICAL')).toBe('p1');
            expect(normalizePriority('P1 (Critical)')).toBe('p1');
            expect(normalizePriority('p1_critical')).toBe('p1');
            expect(normalizePriority('urgent')).toBe('p1');
        });

        it('normalizes P2 / High variants', () => {
            expect(normalizePriority('p2')).toBe('p2');
            expect(normalizePriority('P2')).toBe('p2');
            expect(normalizePriority('high')).toBe('p2');
            expect(normalizePriority('HIGH')).toBe('p2');
            expect(normalizePriority('P2 (High)')).toBe('p2');
        });

        it('normalizes P3 / Medium variants', () => {
            expect(normalizePriority('p3')).toBe('p3');
            expect(normalizePriority('P3')).toBe('p3');
            expect(normalizePriority('medium')).toBe('p3');
            expect(normalizePriority('normal')).toBe('p3');
            expect(normalizePriority('P3 (Medium)')).toBe('p3');
        });

        it('normalizes P4 / Low variants', () => {
            expect(normalizePriority('p4')).toBe('p4');
            expect(normalizePriority('P4')).toBe('p4');
            expect(normalizePriority('low')).toBe('p4');
            expect(normalizePriority('LOW')).toBe('p4');
            expect(normalizePriority('P4 (Low)')).toBe('p4');
        });

        it('defaults to p3 for unknown or missing priority', () => {
            expect(normalizePriority(null)).toBe('p3');
            expect(normalizePriority(undefined)).toBe('p3');
            expect(normalizePriority('')).toBe('p3');
            expect(normalizePriority('other')).toBe('p3');
        });
    });

    describe('getSLADuration', () => {
        it('returns 15 minutes for P1 (Critical)', () => {
            expect(getSLADuration('p1')).toBe(15 * 60 * 1000);
            expect(getSLADuration('critical')).toBe(15 * 60 * 1000);
        });

        it('returns 1 hour for P2 (High)', () => {
            expect(getSLADuration('p2')).toBe(60 * 60 * 1000);
            expect(getSLADuration('high')).toBe(60 * 60 * 1000);
        });

        it('returns 4 hours for P3 (Medium)', () => {
            expect(getSLADuration('p3')).toBe(4 * 60 * 60 * 1000);
            expect(getSLADuration('medium')).toBe(4 * 60 * 60 * 1000);
        });

        it('returns 24 hours for P4 (Low)', () => {
            expect(getSLADuration('p4')).toBe(24 * 60 * 60 * 1000);
            expect(getSLADuration('low')).toBe(24 * 60 * 60 * 1000);
        });
    });

    describe('calculateSLABreach across priority tiers', () => {
        const baseTime = 1700000000000;

        describe('P1 (Critical) - 15 minutes SLA', () => {
            const threshold = 15 * 60 * 1000; // 900,000 ms

            it('identifies healthy ticket when just created', () => {
                const res = calculateSLABreach({
                    createdAt: new Date(baseTime).toISOString(),
                    priority: 'p1',
                    now: baseTime,
                });

                expect(res.isBreached).toBe(false);
                expect(res.isUrgent).toBe(false);
                expect(res.urgencyLevel).toBe('healthy');
                expect(res.remainingMs).toBe(threshold);
                expect(res.percentageRemaining).toBe(100);
            });

            it('marks as urgent critical when remaining time is < 15% of SLA threshold', () => {
                // 13 minutes elapsed out of 15 min = 2 minutes (120s) remaining = 13.33% remaining
                const elapsed = 13 * 60 * 1000;
                const res = calculateSLABreach({
                    createdAt: new Date(baseTime).toISOString(),
                    priority: 'critical',
                    now: baseTime + elapsed,
                });

                expect(res.isBreached).toBe(false);
                expect(res.isUrgent).toBe(true); // < 15% threshold triggers urgency alert
                expect(res.urgencyLevel).toBe('critical');
                expect(res.percentageRemaining).toBeCloseTo(13.33, 1);
            });

            it('marks as breached when remaining time is <= 0', () => {
                // 16 minutes elapsed out of 15 min
                const elapsed = 16 * 60 * 1000;
                const res = calculateSLABreach({
                    createdAt: new Date(baseTime).toISOString(),
                    priority: 'p1',
                    now: baseTime + elapsed,
                });

                expect(res.isBreached).toBe(true);
                expect(res.isUrgent).toBe(true);
                expect(res.urgencyLevel).toBe('breached');
                expect(res.remainingMs).toBe(-1 * 60 * 1000);
                expect(res.breachedByMs).toBe(1 * 60 * 1000);
            });
        });

        describe('P2 (High) - 1 hour SLA', () => {
            const threshold = 60 * 60 * 1000; // 3,600,000 ms

            it('identifies warning when remaining time is between 15% and 30%', () => {
                // 45 minutes elapsed -> 15 min remaining (25%)
                const elapsed = 45 * 60 * 1000;
                const res = calculateSLABreach({
                    createdAt: new Date(baseTime).toISOString(),
                    priority: 'high',
                    now: baseTime + elapsed,
                });

                expect(res.isBreached).toBe(false);
                expect(res.isUrgent).toBe(false);
                expect(res.urgencyLevel).toBe('warning');
                expect(res.percentageRemaining).toBe(25);
            });

            it('identifies critical urgency when remaining time is < 15% (< 9 minutes)', () => {
                // 52 minutes elapsed -> 8 min remaining = 13.33%
                const elapsed = 52 * 60 * 1000;
                const res = calculateSLABreach({
                    createdAt: new Date(baseTime).toISOString(),
                    priority: 'p2',
                    now: baseTime + elapsed,
                });

                expect(res.isBreached).toBe(false);
                expect(res.isUrgent).toBe(true);
                expect(res.urgencyLevel).toBe('critical');
            });

            it('identifies breach when 60+ minutes elapsed', () => {
                const elapsed = 65 * 60 * 1000;
                const res = calculateSLABreach({
                    createdAt: new Date(baseTime).toISOString(),
                    priority: 'p2',
                    now: baseTime + elapsed,
                });

                expect(res.isBreached).toBe(true);
                expect(res.urgencyLevel).toBe('breached');
                expect(res.breachedByMs).toBe(5 * 60 * 1000);
            });
        });

        describe('P3 (Medium) and P4 (Low) tiers', () => {
            it('calculates P3 (4 hour) SLA correctly', () => {
                const elapsed = 3.5 * 60 * 60 * 1000; // 3.5h elapsed, 30m remaining = 12.5% (< 15%)
                const res = calculateSLABreach({
                    createdAt: new Date(baseTime).toISOString(),
                    priority: 'medium',
                    now: baseTime + elapsed,
                });

                expect(res.isBreached).toBe(false);
                expect(res.isUrgent).toBe(true);
                expect(res.urgencyLevel).toBe('critical');
            });

            it('calculates P4 (24 hour) SLA correctly', () => {
                const elapsed = 25 * 60 * 60 * 1000; // 25h elapsed -> breached
                const res = calculateSLABreach({
                    createdAt: new Date(baseTime).toISOString(),
                    priority: 'low',
                    now: baseTime + elapsed,
                });

                expect(res.isBreached).toBe(true);
                expect(res.breachedByMs).toBe(1 * 60 * 60 * 1000);
            });
        });

        describe('Resolved tickets', () => {
            it('handles resolved tickets without breach', () => {
                const res = calculateSLABreach({
                    createdAt: new Date(baseTime).toISOString(),
                    priority: 'p1',
                    status: 'resolved',
                    resolvedAt: new Date(baseTime + 10 * 60 * 1000).toISOString(),
                });

                expect(res.isResolved).toBe(true);
                expect(res.isBreached).toBe(false);
                expect(res.isUrgent).toBe(false);
                expect(res.urgencyLevel).toBe('resolved');
                expect(res.status).toBe('met');
            });

            it('handles closed/auto-resolved statuses', () => {
                expect(calculateSLABreach({ status: 'closed' }).isResolved).toBe(true);
                expect(calculateSLABreach({ status: 'auto-resolved' }).isResolved).toBe(true);
                expect(calculateSLABreach({ status: 'auto resolved' }).isResolved).toBe(true);
            });

            it('flags resolved ticket as breached if resolution was past SLA deadline', () => {
                const res = calculateSLABreach({
                    createdAt: new Date(baseTime).toISOString(),
                    priority: 'p1',
                    status: 'resolved',
                    resolvedAt: new Date(baseTime + 20 * 60 * 1000).toISOString(),
                });

                expect(res.isResolved).toBe(true);
                expect(res.isBreached).toBe(true);
                expect(res.breachedByMs).toBe(5 * 60 * 1000);
            });
        });
    });

    describe('formatTimeRemaining', () => {
        it('formats positive remaining time in hours, minutes, seconds', () => {
            expect(formatTimeRemaining(3665000)).toBe('1h 1m 5s');
            expect(formatTimeRemaining(125000)).toBe('2m 5s');
            expect(formatTimeRemaining(45000)).toBe('45s');
        });

        it('formats digital clock HH:MM:SS or MM:SS', () => {
            expect(formatTimeRemaining(3665000, { digital: true })).toBe('01:01:05');
            expect(formatTimeRemaining(125000, { digital: true })).toBe('02:05');
        });

        it('formats breached time with ago duration', () => {
            expect(formatTimeRemaining(-125000)).toBe('Breached (2m ago)');
            expect(formatTimeRemaining(-125000, { compact: true })).toBe('Breached');
        });

        it('handles null/undefined gracefully', () => {
            expect(formatTimeRemaining(null)).toBe('--:--');
            expect(formatTimeRemaining(undefined)).toBe('--:--');
        });
    });

    describe('getVisualAlertClasses', () => {
        it('returns amber pulsating classes for critical (<15% threshold)', () => {
            const cardClasses = getVisualAlertClasses('critical', { isCard: true });
            expect(cardClasses).toContain('animate-pulse');
            expect(cardClasses).toContain('amber');

            const badgeClasses = getVisualAlertClasses('critical', { isBadge: true });
            expect(badgeClasses).toContain('animate-pulse');
            expect(badgeClasses).toContain('amber');
        });

        it('returns red pulsating classes for breached tickets', () => {
            const rowClasses = getVisualAlertClasses('breached', { isRow: true });
            expect(rowClasses).toContain('animate-pulse');
            expect(rowClasses).toContain('red');

            const badgeClasses = getVisualAlertClasses('breached', { isBadge: true });
            expect(badgeClasses).toContain('animate-pulse');
            expect(badgeClasses).toContain('red');
        });

        it('returns green classes for resolved tickets', () => {
            const badgeClasses = getVisualAlertClasses('resolved', { isBadge: true });
            expect(badgeClasses).toContain('emerald');
            expect(badgeClasses).not.toContain('animate-pulse');
        });
    });
});
