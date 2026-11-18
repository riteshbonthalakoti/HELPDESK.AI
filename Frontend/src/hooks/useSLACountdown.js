import { useState, useEffect, useRef } from 'react';
import { calculateSLABreach } from '../utils/slaUtils';
import useSLAStore from '../store/slaStore';

/**
 * Real-time (1 second) SLA countdown hook for a ticket.
 * Encapsulates the 1s interval to prevent re-rendering unrelated tickets or parent lists.
 * Dispatches audio & browser notifications via Zustand SLA store when ticket breaches SLA.
 * 
 * @param {Object} ticket - Ticket data object
 * @returns {Object} slaState
 */
export function useSLACountdown(ticket) {
    const notifyBreach = useSLAStore((state) => state.notifyBreach);
    const prevBreachedRef = useRef(false);

    const [slaState, setSlaState] = useState(() =>
        calculateSLABreach({
            createdAt: ticket?.created_at || ticket?.createdAt || ticket?.timestamp,
            priority: ticket?.priority,
            status: ticket?.status,
            resolvedAt: ticket?.resolved_at || ticket?.resolvedAt,
        })
    );

    useEffect(() => {
        if (!ticket) return;

        const updateTick = () => {
            const next = calculateSLABreach({
                createdAt: ticket.created_at || ticket.createdAt || ticket.timestamp,
                priority: ticket.priority,
                status: ticket.status,
                resolvedAt: ticket.resolved_at || ticket.resolvedAt,
            });

            setSlaState(next);

            // Check if ticket just breached and alert user
            if (next.isBreached && !prevBreachedRef.current) {
                notifyBreach(ticket);
            }
            prevBreachedRef.current = next.isBreached;
        };

        // Immediate recalculation when ticket props update
        updateTick();

        // Terminal/resolved tickets don't need real-time interval
        const isTerminal = Boolean(
            ticket.status &&
            ['resolved', 'closed', 'auto-resolved', 'auto resolved'].includes(
                String(ticket.status).toLowerCase().trim()
            )
        );

        if (isTerminal) return;

        const intervalId = setInterval(updateTick, 1000);
        return () => clearInterval(intervalId);
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
