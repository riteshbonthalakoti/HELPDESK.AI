import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TicketView } from '../components/TicketView';
import { KeyboardShortcutsModal } from '../components/KeyboardShortcutsModal';

const mockTicket = {
    ticket_id: 101,
    subject: "VPN Gateway Connection Drops on Windows",
    description: "Whenever I connect to the client VPN, the connection drops after 5 minutes.",
    category: "Network",
    status: "Pending Human Support",
    owner_id: "user-123",
    created_at: new Date().toISOString(),
    messages: [
        {
            sender: "user",
            message: "Logs have been captured during the disconnect.",
            timestamp: new Date().toISOString()
        }
    ]
};

describe('TicketView Accessibility & Keyboard Shortcuts', () => {
    it('renders with accessible ARIA landmarks, roles, and labels', () => {
        const onBack = jest.fn();
        const onReopen = jest.fn();
        const onSendMessage = jest.fn();

        render(
            <TicketView 
                ticket={mockTicket} 
                onBack={onBack} 
                onReopen={onReopen} 
                onSendMessage={onSendMessage} 
            />
        );

        // Region landmark
        const workspace = screen.getByRole('region', { name: /ticket detail workspace/i });
        expect(workspace).toBeInTheDocument();

        // Accessible back button with shortcut indicator
        const backBtn = screen.getByRole('button', { name: /navigate back to my tickets/i });
        expect(backBtn).toBeInTheDocument();

        // Shortcuts button with popup state
        const shortcutsBtn = screen.getByRole('button', { name: /open keyboard shortcuts guide/i });
        expect(shortcutsBtn).toHaveAttribute('aria-haspopup', 'dialog');
        expect(shortcutsBtn).toHaveAttribute('aria-expanded', 'false');

        // Message log area
        const logArea = screen.getByRole('log', { name: /ticket message history/i });
        expect(logArea).toHaveAttribute('aria-live', 'polite');

        // Reply textarea
        const textarea = screen.getByLabelText(/type your reply message/i);
        expect(textarea).toBeInTheDocument();
        expect(textarea).toHaveAttribute('aria-required', 'true');
    });

    it('opens keyboard shortcuts modal when clicking the shortcuts button or pressing ?', () => {
        const onBack = jest.fn();
        render(
            <TicketView 
                ticket={mockTicket} 
                onBack={onBack} 
                onReopen={jest.fn()} 
                onSendMessage={jest.fn()} 
            />
        );

        const shortcutsBtn = screen.getByRole('button', { name: /open keyboard shortcuts guide/i });
        fireEvent.click(shortcutsBtn);

        // Dialog should be visible
        const dialog = screen.getByRole('dialog', { name: /keyboard shortcuts/i });
        expect(dialog).toBeInTheDocument();
        expect(dialog).toHaveAttribute('aria-modal', 'true');

        // Close dialog
        const closeBtn = screen.getByRole('button', { name: /close keyboard shortcuts dialog/i });
        fireEvent.click(closeBtn);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('triggers back navigation on pressing b', () => {
        const onBack = jest.fn();
        render(
            <TicketView 
                ticket={mockTicket} 
                onBack={onBack} 
                onReopen={jest.fn()} 
                onSendMessage={jest.fn()} 
            />
        );

        fireEvent.keyDown(window, { key: 'b' });
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('triggers onSendMessage when submitting message form', () => {
        const onSendMessage = jest.fn();
        render(
            <TicketView 
                ticket={mockTicket} 
                onBack={jest.fn()} 
                onReopen={jest.fn()} 
                onSendMessage={onSendMessage} 
            />
        );

        const textarea = screen.getByLabelText(/type your reply message/i);
        fireEvent.change(textarea, { target: { value: 'Testing keyboard accessibility' } });

        const sendBtn = screen.getByRole('button', { name: /send reply message/i });
        fireEvent.click(sendBtn);

        expect(onSendMessage).toHaveBeenCalledWith('Testing keyboard accessibility');
    });

    it('shows reopen button and responds to r shortcut when ticket is resolved', () => {
        const onReopen = jest.fn();
        const resolvedTicket = {
            ...mockTicket,
            status: 'Resolved by Human Support',
            resolved_at: new Date().toISOString()
        };

        render(
            <TicketView 
                ticket={resolvedTicket} 
                onBack={jest.fn()} 
                onReopen={onReopen} 
                onSendMessage={jest.fn()} 
            />
        );

        const reopenBtn = screen.getByRole('button', { name: /reopen this support ticket/i });
        expect(reopenBtn).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'r' });
        expect(onReopen).toHaveBeenCalledTimes(1);
    });
});
