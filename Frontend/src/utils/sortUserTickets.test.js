import { describe, expect, it } from 'vitest';
import { sortUserTickets } from './sortUserTickets';

const ids = rows => rows.map(row => row.id);
describe('ticket ordering', () => {
    it('orders dates both ways and leaves invalid/missing dates last', () => {
        const rows = [{ id: '3' }, { id: '2', created_at: '2026-11-20' }, { id: '4', created_at: 'invalid' }, { id: '1', created_at: '2026-11-21' }];
        expect(ids(sortUserTickets(rows, { field: 'created_at', direction: 'desc' }))).toEqual(['1', '2', '3', '4']);
        expect(ids(sortUserTickets(rows, { field: 'created_at', direction: 'asc' }))).toEqual(['2', '1', '3', '4']);
        expect(ids(rows)).toEqual(['3', '2', '4', '1']);
    });
    it('uses SLA priority tiers instead of alphabetical priority labels', () => {
        const rows = [{ id: '1', priority: 'critical' }, { id: '2', priority: 'P4' }, { id: '3', priority: 'high' }, { id: '4', priority: null }];
        expect(ids(sortUserTickets(rows, { field: 'priority', direction: 'asc' }))).toEqual(['2', '4', '3', '1']);
        expect(ids(sortUserTickets(rows, { field: 'priority', direction: 'desc' }))).toEqual(['1', '3', '4', '2']);
    });
    it('breaks equal/case-insensitive status ties by stable numeric ID in both directions', () => {
        const rows = [{ id: '10', status: 'OPEN' }, { id: '2', status: 'open' }, { id: '3', status: 'Resolved' }];
        expect(ids(sortUserTickets(rows, { field: 'status', direction: 'asc' }))).toEqual(['2', '10', '3']);
        expect(ids(sortUserTickets(rows.reverse(), { field: 'status', direction: 'desc' }))).toEqual(['3', '2', '10']);
    });
});
