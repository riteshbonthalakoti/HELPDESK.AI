import { test } from 'node:test';
import assert from 'node:assert';
import {
    calculateResolutionDurationHours,
    getTicketResolvedTimestamp,
    formatDurationHours,
    groupResolutionByWeekday,
    groupResolutionByWeekdayRange
} from './performanceAnalyticsUtils.js';

test('calculateResolutionDurationHours calculates exact hour delta', () => {
    const created = '2026-10-26T08:00:00Z'; // Monday
    const resolved = '2026-10-26T10:30:00Z'; // 2.5 hours later
    const duration = calculateResolutionDurationHours(created, resolved);
    assert.strictEqual(duration, 2.5);
});

test('calculateResolutionDurationHours handles invalid or inverted timestamps', () => {
    assert.strictEqual(calculateResolutionDurationHours(null, '2026-10-26T10:00:00Z'), null);
    assert.strictEqual(calculateResolutionDurationHours('invalid-date', '2026-10-26T10:00:00Z'), null);
    assert.strictEqual(calculateResolutionDurationHours('2026-10-26T10:00:00Z', '2026-10-26T09:00:00Z'), 0);
});

test('getTicketResolvedTimestamp extracts correct resolution timestamp across formats', () => {
    const resolvedTicket = {
        status: 'resolved',
        created_at: '2026-10-26T08:00:00Z',
        resolved_at: '2026-10-26T09:15:00Z'
    };
    assert.strictEqual(getTicketResolvedTimestamp(resolvedTicket), '2026-10-26T09:15:00Z');

    const closedTicketWithMeta = {
        status: 'closed',
        created_at: '2026-10-26T08:00:00Z',
        metadata: { resolved_at: '2026-10-26T11:00:00Z' }
    };
    assert.strictEqual(getTicketResolvedTimestamp(closedTicketWithMeta), '2026-10-26T11:00:00Z');

    const completedTicketWithMeta = {
        status: 'Auto-Resolved',
        created_at: '2026-10-26T08:00:00Z',
        metadata: { completed_at: '2026-10-26T10:45:00Z' }
    };
    assert.strictEqual(getTicketResolvedTimestamp(completedTicketWithMeta), '2026-10-26T10:45:00Z');

    const openTicket = {
        status: 'open',
        created_at: '2026-10-26T08:00:00Z',
        updated_at: '2026-10-26T09:00:00Z'
    };
    assert.strictEqual(getTicketResolvedTimestamp(openTicket), null);
});

test('formatDurationHours outputs human-readable strings', () => {
    assert.strictEqual(formatDurationHours(null), 'N/A');
    assert.strictEqual(formatDurationHours(undefined), 'N/A');
    assert.strictEqual(formatDurationHours(NaN), 'N/A');
    assert.strictEqual(formatDurationHours(0), '0m');
    assert.strictEqual(formatDurationHours(0.5), '30m');
    assert.strictEqual(formatDurationHours(1.0), '1h');
    assert.strictEqual(formatDurationHours(2.75), '2h 45m');
    assert.strictEqual(formatDurationHours(24.5), '24h 30m');
});

test('groupResolutionByWeekday accurately groups and aggregates metrics across Monday-Sunday', () => {
    // 2026-10-26 is Monday
    // 2026-10-27 is Tuesday
    // 2026-10-31 is Saturday
    const tickets = [
        {
            id: 't1',
            status: 'resolved',
            created_at: '2026-10-26T08:00:00Z',
            resolved_at: '2026-10-26T10:00:00Z' // 2 hours
        },
        {
            id: 't2',
            status: 'resolved',
            created_at: '2026-10-26T11:00:00Z',
            resolved_at: '2026-10-26T15:00:00Z' // 4 hours
        },
        {
            id: 't3',
            status: 'resolved',
            created_at: '2026-10-27T09:00:00Z',
            resolved_at: '2026-10-27T10:00:00Z' // 1 hour
        },
        {
            id: 't4',
            status: 'open',
            created_at: '2026-10-27T10:00:00Z'
        }
    ];

    const result = groupResolutionByWeekday(tickets, { targetSlaHours: 3 });
    assert.strictEqual(result.length, 7);

    // Monday (index 0 in ordered result)
    const mon = result.find(r => r.day === 'Mon');
    assert.strictEqual(mon.totalResolved, 2);
    assert.strictEqual(mon.avgDurationHours, 3); // (2 + 4) / 2
    assert.strictEqual(mon.minDurationHours, 2);
    assert.strictEqual(mon.maxDurationHours, 4);
    assert.strictEqual(mon.slaComplianceRate, 50); // 1 of 2 within 3h SLA

    // Tuesday
    const tue = result.find(r => r.day === 'Tue');
    assert.strictEqual(tue.totalResolved, 1);
    assert.strictEqual(tue.avgDurationHours, 1);
    assert.strictEqual(tue.openTickets, 1);
    assert.strictEqual(tue.slaComplianceRate, 100);

    // Wednesday (empty)
    const wed = result.find(r => r.day === 'Wed');
    assert.strictEqual(wed.totalResolved, 0);
    assert.strictEqual(wed.avgDurationHours, 0);
});

test('groupResolutionByWeekday handles empty ticket datasets gracefully', () => {
    const emptyResult = groupResolutionByWeekday([]);
    assert.strictEqual(emptyResult.length, 7);
    emptyResult.forEach(item => {
        assert.strictEqual(item.avgDurationHours, 0);
        assert.strictEqual(item.totalResolved, 0);
        assert.strictEqual(item.slaComplianceRate, 100);
    });
});

test('groupResolutionByWeekdayRange supports weekday_weekend and tri_range groupings', () => {
    const tickets = [
        {
            id: 't1',
            status: 'resolved',
            created_at: '2026-10-26T08:00:00Z', // Mon
            resolved_at: '2026-10-26T10:00:00Z' // 2h
        },
        {
            id: 't2',
            status: 'resolved',
            created_at: '2026-10-31T10:00:00Z', // Sat
            resolved_at: '2026-10-31T16:00:00Z' // 6h
        }
    ];

    const weekendGroup = groupResolutionByWeekdayRange(tickets, 'weekday_weekend');
    assert.strictEqual(weekendGroup.length, 2);
    assert.strictEqual(weekendGroup[0].day, 'Mon - Fri');
    assert.strictEqual(weekendGroup[0].avgDurationHours, 2);
    assert.strictEqual(weekendGroup[1].day, 'Sat - Sun');
    assert.strictEqual(weekendGroup[1].avgDurationHours, 6);

    const triGroup = groupResolutionByWeekdayRange(tickets, 'tri_range');
    assert.strictEqual(triGroup.length, 3);
    assert.strictEqual(triGroup[0].day, 'Mon - Tue');
    assert.strictEqual(triGroup[0].totalResolved, 1);
    assert.strictEqual(triGroup[1].day, 'Wed - Thu');
    assert.strictEqual(triGroup[1].totalResolved, 0);
    assert.strictEqual(triGroup[2].day, 'Fri - Sun');
    assert.strictEqual(triGroup[2].totalResolved, 1);
});
