import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useTicketStore from '../store/ticketStore';
import { TicketView } from '../components/TicketView';

function TicketDetailView() {
    const { ticket_id } = useParams();
    const { tickets, appendMessage, updateTicket } = useTicketStore();
    const navigate = useNavigate();
    const [ticket, setTicket] = useState(null);
    const [isSending, setIsSending] = useState(false);
    const viewedRef = useRef(null);

    // Force refresh when window gains focus to ensure latest data from Admin updates
    useEffect(() => {
        const handleFocus = () => {
            useTicketStore.persist?.rehydrate?.();
        };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    useEffect(() => {
        const foundTicket = tickets.find(t => t.ticket_id?.toString() === ticket_id?.toString());

        if (!foundTicket) {
            // Only navigate if we've already loaded tickets and still don't find it
            if (tickets.length > 0) {
                navigate('/my-tickets');
            }
            return;
        }

        setTicket(foundTicket);

        // Mark ticket as viewed — only once per ticket_id visit to avoid infinite loops
        if (viewedRef.current !== ticket_id) {
            updateTicket(foundTicket.ticket_id, {
                last_user_viewed_at: new Date().toISOString()
            });
            viewedRef.current = ticket_id;
        }
    }, [ticket_id, tickets, navigate, updateTicket]);

    if (!ticket) return null;

    const handleReopenTicket = () => {
        updateTicket(ticket.ticket_id, {
            status: 'Pending Human Support',
            reopened_at: new Date().toISOString(),
            reopened_by: ticket.owner_id
        });
    };

    const handleSendMessage = (messageText) => {
        if (!messageText || isSending) return;
        setIsSending(true);

        appendMessage(ticket.ticket_id, {
            sender: 'user',
            message: messageText,
            timestamp: new Date().toISOString()
        });

        setIsSending(false);
    };

    return (
        <TicketView
            ticket={ticket}
            onBack={() => navigate('/my-tickets')}
            onReopen={handleReopenTicket}
            onSendMessage={handleSendMessage}
            isSending={isSending}
        />
    );
}

export default TicketDetailView;
