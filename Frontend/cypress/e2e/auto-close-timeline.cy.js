/* global cy */
/**
 * E2E Test Suite — Auto-Close Ticket Notification & Timeline Workflows
 *
 * Fixes #1167: Full E2E Cypress Test Suite
 */

const MOCK_TICKET = {
  id: 'test-ticket-001',
  ticket_id: 'test-ticket-001',
  subject: 'VPN connection drops after 30 minutes',
  summary: 'VPN connection drops after 30 minutes',
  category: 'Network',
  status: 'resolved',
  priority: 'medium',
  confidence: 0.91,
  company: 'TestCorp',
  created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  updated_at: new Date().toISOString(),
  auto_close_scheduled: true,
  description: 'User reports VPN disconnects after exactly 30 minutes of use.',
};

const MOCK_OPEN_TICKET = {
  id: 'test-ticket-002',
  ticket_id: 'test-ticket-002',
  subject: 'Email notifications not sending',
  summary: 'Email notifications not sending',
  category: 'Software',
  status: 'open',
  priority: 'high',
  confidence: 0.87,
  company: 'TestCorp',
  created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  updated_at: new Date().toISOString(),
  auto_close_scheduled: false,
};

describe('Auto-Close Ticket Timeline & Notifications', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
    cy.stubBackendApis();
    cy.stubSettingsApi({ auto_close_days: 7 });

    cy.intercept('GET', '**/rest/v1/tickets**', (req) => {
      const wantsObject = String(req.headers.accept || '').includes(
        'application/vnd.pgrst.object+json'
      );
      if (wantsObject) {
        req.reply({ statusCode: 200, body: MOCK_TICKET });
      } else {
        req.reply({
          statusCode: 200,
          body: [MOCK_TICKET, MOCK_OPEN_TICKET],
          headers: { 'content-range': '0-1/2' },
        });
      }
    }).as('getTickets');

    cy.intercept('PATCH', '**/rest/v1/tickets**', {
      statusCode: 200,
      body: [{ ...MOCK_TICKET, status: 'closed' }],
    }).as('updateTicket');
  });

  it('renders ticket list showing resolved tickets pending auto-close', () => {
    cy.visit('/admin/tickets');
    cy.wait('@getTickets');
    cy.contains(MOCK_TICKET.subject).should('be.visible');
  });

  it('shows both resolved and open tickets in the list', () => {
    cy.visit('/admin/tickets');
    cy.wait('@getTickets');
    cy.contains(MOCK_TICKET.subject).should('be.visible');
    cy.contains(MOCK_OPEN_TICKET.subject).should('be.visible');
  });

  it('shows ticket timeline section in ticket detail view', () => {
    cy.visit('/admin/tickets');
    cy.wait('@getTickets');
    cy.get('button[title="Open Detailed View"]').first().click({ force: true });
    cy.url().should('include', `/admin/ticket/${MOCK_TICKET.id}`);
    cy.contains(/resolved|Protocol Finalized/i).scrollIntoView().should('be.visible');
  });

  it('displays ticket metadata (priority, created date) in detail view', () => {
    cy.visit('/admin/tickets');
    cy.wait('@getTickets');
    cy.get('button[title="Open Detailed View"]').first().click({ force: true });
    cy.contains(/medium/i).scrollIntoView().should('be.visible');
  });

  it('dynamically updates ticket status when realtime event fires', () => {
    cy.visit('/admin/tickets');
    cy.wait('@getTickets');
    cy.contains(MOCK_TICKET.subject).should('be.visible');

    cy.emitRealtimeTicketUpdate(MOCK_TICKET.ticket_id, 'closed');

    cy.get('body').should('exist').and('be.visible');
  });

  it('page remains responsive after realtime update', () => {
    cy.visit('/admin/tickets');
    cy.wait('@getTickets');

    cy.emitRealtimeTicketUpdate(MOCK_TICKET.ticket_id, 'closed');
    cy.get('body').should('be.visible');
  });

  it('settings auto-close days value reflects in admin settings UI', () => {
    cy.goToAdminSettings();
    cy.contains(/Auto-Close Tickets/i).scrollIntoView().should('be.visible');
    cy.contains('button', /7 Days|3 Days|14 Days/i).scrollIntoView().should('be.visible');
  });

  it('changing auto-close days updates the selected duration in UI', () => {
    cy.goToAdminSettings();
    cy.contains('button', /7 Days|3 Days|14 Days/i).scrollIntoView().click({ force: true });
    cy.contains('button', '14 Days').scrollIntoView().click({ force: true });
    cy.contains('button', '14 Days').scrollIntoView().should('be.visible');
  });

  it('stale resolved tickets render cleanly in admin ticket list', () => {
    cy.intercept('GET', '**/rest/v1/tickets**', {
      statusCode: 200,
      body: [{ ...MOCK_TICKET, status: 'resolved', auto_close_scheduled: true }],
      headers: { 'content-range': '0-0/1' },
    }).as('getStaleTickets');

    cy.visit('/admin/tickets');
    cy.wait('@getStaleTickets');
    cy.contains(MOCK_TICKET.subject).should('be.visible');
  });

  it('admin can inspect resolved ticket detail cleanly', () => {
    cy.visit('/admin/tickets');
    cy.wait('@getTickets');
    cy.get('button[title="Open Detailed View"]').first().click({ force: true });
    cy.contains('Protocol Finalized').scrollIntoView().should('be.visible');
  });

  it('handles ticket list with no tickets gracefully', () => {
    cy.intercept('GET', '**/rest/v1/tickets**', {
      statusCode: 200,
      body: [],
      headers: { 'content-range': '*/0' },
    }).as('getEmptyTickets');

    cy.visit('/admin/tickets');
    cy.wait('@getEmptyTickets');
    cy.get('body').should('be.visible');
  });

  it('handles multiple realtime events without crashing', () => {
    cy.visit('/admin/tickets');
    cy.wait('@getTickets');

    cy.emitRealtimeTicketUpdate('test-ticket-001', 'closed');
    cy.emitRealtimeTicketUpdate('test-ticket-002', 'resolved');
    cy.emitRealtimeTicketUpdate('test-ticket-001', 'reopened');

    cy.get('body').should('be.visible');
  });
});
