/**
 * @file slaStore.test.js
 * @description Unit tests for Zustand SLA store actions, notifications, and de-duplication.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import useSLAStore from './slaStore';

describe('useSLAStore', () => {
    beforeEach(() => {
        const store = useSLAStore.getState();
        store.clearBreachedTickets();
        store.setSoundEnabled(true);
        store.setDesktopNotificationsEnabled(true);
    });

    it('initializes with default toggles enabled', () => {
        const state = useSLAStore.getState();
        expect(state.soundEnabled).toBe(true);
        expect(state.desktopNotificationsEnabled).toBe(true);
        expect(state.breachedTicketIds).toEqual([]);
    });

    it('toggles sound on and off', () => {
        const store = useSLAStore.getState();
        store.toggleSound();
        expect(useSLAStore.getState().soundEnabled).toBe(false);

        store.toggleSound();
        expect(useSLAStore.getState().soundEnabled).toBe(true);
    });

    it('sets sound enabled directly', () => {
        const store = useSLAStore.getState();
        store.setSoundEnabled(false);
        expect(useSLAStore.getState().soundEnabled).toBe(false);

        store.setSoundEnabled(true);
        expect(useSLAStore.getState().soundEnabled).toBe(true);
    });

    it('sets desktop notifications directly', () => {
        const store = useSLAStore.getState();
        store.setDesktopNotificationsEnabled(false);
        expect(useSLAStore.getState().desktopNotificationsEnabled).toBe(false);

        store.setDesktopNotificationsEnabled(true);
        expect(useSLAStore.getState().desktopNotificationsEnabled).toBe(true);
    });

    it('tracks breached ticket and prevents duplicate alert spam', () => {
        const store = useSLAStore.getState();
        const testTicket = { id: 'ticket-123', priority: 'p1', subject: 'Server down' };

        // First notification should succeed
        const alertedFirst = store.notifyBreach(testTicket);
        expect(alertedFirst).toBe(true);
        expect(useSLAStore.getState().breachedTicketIds).toContain('ticket-123');

        // Subsequent notification on the same ticket should be ignored
        const alertedSecond = store.notifyBreach(testTicket);
        expect(alertedSecond).toBe(false);
        expect(useSLAStore.getState().breachedTicketIds.length).toBe(1);
    });

    it('supports ticket_id property identifier', () => {
        const store = useSLAStore.getState();
        const testTicket = { ticket_id: 't-456', priority: 'p2', subject: 'High latency' };

        expect(store.notifyBreach(testTicket)).toBe(true);
        expect(useSLAStore.getState().breachedTicketIds).toContain('t-456');
    });

    it('resets breached ticket so it can alert again', () => {
        const store = useSLAStore.getState();
        const testTicket = { id: 'ticket-789', priority: 'critical' };

        store.notifyBreach(testTicket);
        expect(useSLAStore.getState().breachedTicketIds).toContain('ticket-789');

        store.resetBreachedTicket('ticket-789');
        expect(useSLAStore.getState().breachedTicketIds).not.toContain('ticket-789');

        const alertedAgain = store.notifyBreach(testTicket);
        expect(alertedAgain).toBe(true);
    });

    it('clears all breached tickets', () => {
        const store = useSLAStore.getState();
        store.notifyBreach({ id: 't1' });
        store.notifyBreach({ id: 't2' });
        expect(useSLAStore.getState().breachedTicketIds.length).toBe(2);

        store.clearBreachedTickets();
        expect(useSLAStore.getState().breachedTicketIds).toEqual([]);
    });
});
