/* global cy */
/**
 * E2E Test Suite — WebSocket Realtime Event Handling
 *
 * Fixes #1167: Full E2E Cypress Test Suite
 */

const REALTIME_TICKETS = [
  {
    id: 'rt-ticket-001',
    ticket_id: 'rt-ticket-001',
    subject: 'Database connection pool exhausted',
    summary: 'Database connection pool exhausted',
    category: 'Software',
    status: 'open',
    priority: 'critical',
    confidence: 0.94,
    company: 'TestCorp',
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'rt-ticket-002',
    ticket_id: 'rt-ticket-002',
    subject: 'SSL certificate expiring in 3 days',
    summary: 'SSL certificate expiring in 3 days',
    category: 'Network',
    status: 'open',
    priority: 'high',
    confidence: 0.89,
    company: 'TestCorp',
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

describe('WebSocket Realtime Event Handling', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
    cy.stubBackendApis();
    cy.stubSettingsApi();

    cy.intercept('GET', '**/rest/v1/tickets**', {
      statusCode: 200,
      body: REALTIME_TICKETS,
      headers: { 'content-range': '0-1/2' },
    }).as('getTickets');
  });

  it('page remains stable after single realtime event', () => {
    cy.visit('/admin/tickets');
    cy.wait('@getTickets');

    cy.emitRealtimeTicketUpdate('rt-ticket-001', 'resolved');

    cy.get('body').should('be.visible');
    cy.contains('Database connection pool exhausted').should('be.visible');
  });

  it('page remains stable after multiple rapid realtime events', () => {
    cy.visit('/admin/tickets');
    cy.wait('@getTickets');

    cy.emitRealtimeTicketUpdate('rt-ticket-001', 'resolved');
    cy.emitRealtimeTicketUpdate('rt-ticket-002', 'closed');
    cy.emitRealtimeTicketUpdate('rt-ticket-001', 'reopened');
    cy.emitRealtimeTicketUpdate('rt-ticket-002', 'resolved');
    cy.emitRealtimeTicketUpdate('rt-ticket-001', 'closed');

    cy.get('body').should('be.visible');
  });

  it('realtime event does not crash the app when on settings page', () => {
    cy.goToAdminSettings();
    cy.contains(/AI Settings/i).should('be.visible');

    cy.emitRealtimeTicketUpdate('rt-ticket-001', 'resolved');

    cy.get('body').should('be.visible');
  });

  it('realtime event with unknown ticket ID does not crash', () => {
    cy.visit('/admin/tickets');
    cy.wait('@getTickets');

    cy.emitRealtimeTicketUpdate('nonexistent-ticket-999', 'closed');

    cy.get('body').should('be.visible');
  });

  it('realtime event fires during page navigation without errors', () => {
    cy.visit('/admin/tickets');
    cy.wait('@getTickets');

    cy.emitRealtimeTicketUpdate('rt-ticket-001', 'resolved');
    cy.goToAdminSettings();

    cy.get('body').should('be.visible');
  });

  it('handles realtime events for all status transitions', () => {
    cy.visit('/admin/tickets');
    cy.wait('@getTickets');

    const statuses = ['open', 'in_progress', 'resolved', 'closed', 'reopened'];
    statuses.forEach((status) => {
      cy.emitRealtimeTicketUpdate('rt-ticket-001', status);
    });

    cy.get('body').should('be.visible');
  });
});
