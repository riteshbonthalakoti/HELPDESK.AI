import { useState, useEffect, useRef } from 'react';
import { calculateSLABreach } from '../utils/slaUtils';
import useSLAStore from '../store/slaStore';

// Single shared 1-second ticker across ALL mounted SLA badges/rows (prevents N separate intervals)
const listeners = new Set();
let sharedTimerId = null;

function subscribeTick(fn) {
    listeners.add(fn);
    if (!sharedTimerId && typeof window !== 'undefined') {
        sharedTimerId = window.setInterval(() => {
            const now = Date.now();
            listeners.forEach((cb) => cb(now));
        }, 1000);
    }
    return () => {
        listeners.delete(fn);
        if (listeners.size === 0 && sharedTimerId !== null) {
            window.clearInterval(sharedTimerId);
            sharedTimerId = null;
        }
    };
}

/**
 * Real-time SLA countdown hook backed by a single shared global timer.
 * Only alerts on live transitions into breach (never spams sounds for already-breached tickets on load).
 */
export function useSLACountdown(ticket) {
    const notifyBreach = useSLAStore((state) => state.notifyBreach);

    const [slaState, setSlaState] = useState(() =>
        calculateSLABreach({
            createdAt: ticket?.created_at || ticket?.createdAt || ticket?.timestamp,
            priority: ticket?.priority,
            status: ticket?.status,
            resolvedAt: ticket?.resolved_at || ticket?.resolvedAt,
        })
    );

    // Seed with initial breach state so historical breached tickets never fire audio on page load
    const prevBreachedRef = useRef(slaState.isBreached);

    useEffect(() => {
        if (!ticket) return;

        const compute = (now = Date.now()) =>
            calculateSLABreach({
                createdAt: ticket.created_at || ticket.createdAt || ticket.timestamp,
                priority: ticket.priority,
                status: ticket.status,
                resolvedAt: ticket.resolved_at || ticket.resolvedAt,
                now,
            });

        const initial = compute();
        setSlaState(initial);
        prevBreachedRef.current = initial.isBreached;

        const isTerminal = Boolean(
            ticket.status &&
            ['resolved', 'closed', 'auto-resolved', 'auto resolved'].includes(
                String(ticket.status).toLowerCase().trim()
            )
        );

        // No ticking needed for terminal/resolved tickets
        if (isTerminal) return;

        const unsubscribe = subscribeTick((now) => {
            const next = compute(now);
            setSlaState(next);

            if (next.isBreached && !prevBreachedRef.current) {
                notifyBreach(ticket);
            }
            prevBreachedRef.current = next.isBreached;
        });

        return unsubscribe;
    }, [
        ticket?.id,
        ticket?.ticket_id,
        ticket?.created_at,
        ticket?.createdAt,
        ticket?.timestamp,
        ticket?.priority,
        ticket?.status,
        ticket?.resolved_at,
        ticket?.resolvedAt,
        notifyBreach,
    ]);

    return slaState;
}

export default useSLACountdown;
