// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MyTickets from './MyTickets';

const fixture = vi.hoisted(() => ({ user: { id: 'citizen' }, rows: [], order: vi.fn(), navigate: vi.fn(), notify: vi.fn(), event: null }));
vi.mock('../../store/authStore', () => ({ default: () => ({ user: fixture.user }) }));
vi.mock('../../store/slaStore', () => ({ default: selector => selector({ notifyBreach: fixture.notify }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => fixture.navigate }));
vi.mock('../../lib/supabaseClient', () => ({ supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: fixture.order }) }) }),
    channel: () => ({ on: (_event, _filter, callback) => { fixture.event = callback; return { subscribe: () => ({}) }; } }),
    removeChannel: vi.fn(),
} }));
vi.mock('../../components/ui/tooltip', () => ({
    TooltipProvider: ({ children }) => children,
    Tooltip: ({ children }) => children,
    TooltipTrigger: ({ children }) => children,
    TooltipContent: () => null,
}));

let container, root, interval;
beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    fixture.rows = [
        { id: 'ticket-1', subject: 'VPN access', priority: 'medium', status: 'open', created_at: '2026-11-21T09:00:00Z' },
        { id: 'ticket-2', subject: 'VPN reset', priority: 'critical', status: 'pending', created_at: '2026-11-21T09:30:00Z' },
        { id: 'ticket-3', subject: 'Printer repair', priority: 'low', status: 'resolved', created_at: '2026-11-20T09:00:00Z' },
    ];
    fixture.order.mockResolvedValue({ data: fixture.rows, error: null });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    interval = vi.spyOn(window, 'setInterval');
});
afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers();
});
const render = async () => { await act(async () => root.render(<MyTickets />)); };
const rows = () => [...container.querySelectorAll('tbody tr')];
const row = id => rows().find(element => element.cells[0].textContent.includes(id));
const order = () => rows().map(element => element.cells[0].textContent.trim());
const slaSubscriptions = () => interval.mock.calls.filter(([, delay]) => delay === 1000).length;
const clickSort = async label => { await act(async () => [...container.querySelectorAll('th button')].find(button => button.textContent === label).click()); };

it('preserves row DOM identity and the live SLA subscription while typing and sorting', async () => {
    await render();
    const retained = row('ticket-1'); const subscriptions = slaSubscriptions();
    expect(subscriptions).toBeGreaterThan(0);
    const input = container.querySelector('input');
    for (const value of ['V', 'VP', 'VPN']) {
        await act(async () => {
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(row('ticket-1')).toBe(retained);
        expect(rows()).toHaveLength(2);
        expect(slaSubscriptions()).toBe(subscriptions);
    }
    await act(async () => vi.advanceTimersByTime(1000));
    await clickSort('Priority');
    expect(row('ticket-1')).toBe(retained);
    expect(slaSubscriptions()).toBe(subscriptions);
});

it('toggles date, priority and status ordering with announced sort state', async () => {
    await render();
    expect(order()).toEqual(['#ticket-2', '#ticket-1', '#ticket-3']);
    await clickSort('Submitted');
    expect(order()).toEqual(['#ticket-3', '#ticket-1', '#ticket-2']);
    await clickSort('Priority');
    expect(order()).toEqual(['#ticket-3', '#ticket-1', '#ticket-2']);
    const header = [...container.querySelectorAll('th')].find(element => element.textContent === 'Priority');
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(header.querySelector('button').type).toBe('button');
    await clickSort('Priority');
    expect(header.getAttribute('aria-sort')).toBe('descending');
    expect(order()).toEqual(['#ticket-2', '#ticket-1', '#ticket-3']);
    await clickSort('Status');
    expect(order()).toEqual(['#ticket-1', '#ticket-2', '#ticket-3']);
});

it('updates a sorted row in place on realtime changes and keeps ticket navigation working', async () => {
    await render(); await clickSort('Priority');
    const retained = row('ticket-1');
    await act(async () => fixture.event({ eventType: 'UPDATE', new: { id: 'ticket-1', subject: 'VPN restored', priority: 'critical' } }));
    expect(row('ticket-1')).toBe(retained);
    expect(retained.textContent).toContain('VPN restored');
    await act(async () => retained.click());
    expect(fixture.navigate).toHaveBeenCalledWith('/ticket/ticket-1');
    expect(fixture.order).toHaveBeenCalledTimes(1);
});
