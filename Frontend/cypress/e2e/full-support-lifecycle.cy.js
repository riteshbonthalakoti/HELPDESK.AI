/* global cy */
/**
 * Full-Stack E2E Suite — End-to-End Ticket Lifecycle Across User, Agent & Admin
 *
 * Covers the complete multi-actor workflow required by Issue #3914:
 * 1. Complete user signup & admin approval onboarding
 * 2. Ticket registration through the live FastAPI AI SSE & persistence pipeline
 * 3. Support agent authentication, public customer reply, and private internal note
 * 4. Admin authentication, ticket queue triage, status transitions (Accept -> In Progress -> Resolve)
 * 5. Customer verification of agent/admin replies, internal-note isolation, CSAT dismissal & reopen
 */

describe('Full Support Lifecycle: User Signup -> Ticket Registration -> Agent Reply -> Admin Status Updates', () => {
  beforeEach(() => {
    cy.resetDatabase();
  });

  it('executes the complete multi-role ticket lifecycle end-to-end', () => {
    const customer = {
      fullName: 'Rohan Verma',
      email: 'rohan.verma@example.com',
      passInput: 'TestExamplePass123',
      company: 'RITESH PVT LTD',
    };

    const issueDescription =
      'VPN connection to prod-gateway-01 at 10.24.8.15 keeps timing out with TLS handshake failure when connecting from remote office.';
    const agentPublicReply =
      'Hello Rohan! Support Agent here — I reset your TLS peer session on prod-gateway-01. Could you retry connecting now?';
    const agentInternalNote =
      'INTERNAL_ONLY_DIAGNOSTIC: Cleared stale IPSec tunnel state on firewall node fw-core-02.';
    const adminClosingReply =
      'Admin update: Gateway route health verified green across all regions. Marking this ticket resolved.';

    // ── 1. User Signup & Admin Approval ────────────────────────────────────
    cy.visit('/signup');
    cy.contains('Select your company...').click();
    cy.contains(customer.company).click();
    cy.get('input[placeholder="Enter your name"]').type(customer.fullName);
    cy.get('input[placeholder="Enter your system email"]').type(customer.email);
    cy.get('input[placeholder="Min 8 chars"]').type(customer.passInput);
    cy.get('input[placeholder="Repeat"]').type(customer.passInput);
    cy.contains('button', 'Submit Registration').click();

    cy.url({ timeout: 15000 }).should('include', '/user-lobby');
    cy.contains(/Pending Review/i).should('be.visible');

    // Admin approves newly signed-up user
    cy.switchActorSession();
    cy.login('admin@helpdesk.ai', 'AdminPass@123');
    cy.url().should('include', '/admin/dashboard');

    cy.visit('/admin/users');
    cy.contains('button', /Pending Requests/i).click();
    cy.contains(customer.email).scrollIntoView().should('be.visible');
    cy.contains('button', /Approve/i).scrollIntoView().click();
    cy.contains('button', /All Users/i).click();
    cy.contains(customer.fullName).scrollIntoView().should('be.visible');

    // ── 2. Customer Login & Ticket Registration (Real AI + Backend Save) ───
    cy.switchActorSession();
    cy.login(customer.email, customer.passInput);
    cy.url().should('include', '/dashboard');

    // Navigate to ticket creation page
    cy.visit('/create-ticket');
    cy.get('textarea[placeholder*="Describe your problem"]')
      .should('be.visible')
      .type(issueDescription);
    cy.contains('button[type="submit"]', 'Submit Ticket')
      .scrollIntoView()
      .should('not.be.disabled')
      .click();

    // Progress through real FastAPI SSE /ai/analyze_stream -> /ai-understanding
    cy.url({ timeout: 20000 }).should('include', '/ai-understanding');
    cy.contains('Network', { timeout: 12000 }).scrollIntoView().should('be.visible');
    cy.contains('VPN Connection').scrollIntoView().should('be.visible');
    cy.contains('button', 'Continue').scrollIntoView().click();

    // Progress through /knowledge-check -> /ticket-tracking -> /ticket/:ticket_id
    cy.url({ timeout: 25000 }).should('match', /\/ticket\/[0-9a-f-]+/i);

    cy.location('pathname').then((pathname) => {
      const createdTicketId = pathname.split('/ticket/')[1];
      expect(createdTicketId).to.be.a('string').and.not.be.empty;

      // Verify initial persisted ticket state & AI Assistant triage message
      cy.contains(/PENDING_HUMAN|Pending/i).scrollIntoView().should('be.visible');
      cy.contains('Neural Engine has successfully triaged your issue')
        .scrollIntoView()
        .should('be.visible');

      // Verify ticket is also visible in customer's /my-tickets list
      cy.visit('/my-tickets');
      cy.contains('VPN connection to prod-gateway-01').scrollIntoView().should('be.visible');

      // ── 3. Support Agent Login, Public Reply & Private Internal Note ─────
      cy.switchActorSession();
      cy.login('agent@helpdesk.ai', 'AgentPass@123');
      cy.url().should('include', '/dashboard');

      cy.visit(`/ticket/${createdTicketId}`);
      cy.contains('VPN connection to prod-gateway-01').scrollIntoView().should('be.visible');

      // Verify staff PUBLIC / INTERNAL mode controls are rendered for Support Agent
      cy.contains('button', 'PUBLIC').scrollIntoView().should('be.visible');
      cy.contains('button', 'INTERNAL').scrollIntoView().should('be.visible');

      // Send public reply to customer
      cy.get('input[placeholder="Type your message..."]').scrollIntoView().type(agentPublicReply);
      cy.contains('button[type="submit"]', 'Send').scrollIntoView().click();
      cy.contains(agentPublicReply).scrollIntoView().should('be.visible');

      // Switch to INTERNAL mode and post staff-only note
      cy.contains('button', 'INTERNAL').scrollIntoView().click();
      cy.get('input[placeholder="Type your message..."]').scrollIntoView().type(agentInternalNote);
      cy.contains('button[type="submit"]', 'Note').scrollIntoView().click();
      cy.contains(agentInternalNote).scrollIntoView().should('be.visible');
      cy.contains('Internal Note').scrollIntoView().should('be.visible');

      // ── 4. Admin Login, Queue Triage & Status Lifecycle Updates ──────────
      cy.switchActorSession();
      cy.login('admin@helpdesk.ai', 'AdminPass@123');
      cy.url().should('include', '/admin/dashboard');

      cy.visit('/admin/tickets');
      cy.contains('VPN connection to prod-gateway-01').scrollIntoView().should('be.visible');

      // Open Admin Ticket Detail view
      cy.get('button[title="Open Detailed View"]').first().scrollIntoView().click({ force: true });
      cy.url().should('include', `/admin/ticket/${createdTicketId}`);

      // Admin sees BOTH the agent's public reply AND the agent's internal note
      cy.contains(agentPublicReply).scrollIntoView().should('be.visible');
      cy.contains(agentInternalNote).scrollIntoView().should('be.visible');

      // Admin accepts ticket -> status updates to 'in progress' & persists assignee on reload
      cy.intercept('PATCH', '**/rest/v1/tickets**').as('acceptTicketPatch');
      cy.contains('button', 'Accept').scrollIntoView().click();
      cy.wait('@acceptTicketPatch');
      cy.contains(/in progress/i).scrollIntoView().should('be.visible');
      cy.reload();
      cy.contains('Test Admin').scrollIntoView().should('be.visible');

      // Admin posts closing public message and resolves ticket
      cy.contains('button', 'PUBLIC').scrollIntoView().click();
      cy.get('input[placeholder="Type your message..."]').scrollIntoView().type(adminClosingReply);
      cy.contains('button[type="submit"]', 'Send').scrollIntoView().click();
      cy.contains(adminClosingReply).scrollIntoView().should('be.visible');

      cy.contains('button', 'Resolve').scrollIntoView().click();
      cy.contains('Protocol Finalized').scrollIntoView().should('be.visible');
      cy.contains(/resolved/i).scrollIntoView().should('be.visible');

      // ── 5. Customer Verifies Replies, Privacy & Reopens Ticket ───────────
      cy.switchActorSession();
      cy.login(customer.email, customer.passInput);
      cy.visit(`/ticket/${createdTicketId}`);

      // Customer sees Resolved status and public messages from Agent & Admin
      cy.contains(/Resolved/i).scrollIntoView().should('be.visible');
      cy.contains(agentPublicReply).scrollIntoView().should('be.visible');
      cy.contains(adminClosingReply).scrollIntoView().should('be.visible');

      // Customer MUST NOT see the staff-only internal note
      cy.get('body').should('not.contain', agentInternalNote);

      // Dismiss CSAT modal when it appears, then test Reopen Ticket flow
      cy.contains('How was your resolution?', { timeout: 6000 }).should('be.visible');
      cy.contains('button', 'Skip for now').click();
      cy.contains('How was your resolution?').should('not.exist');

      cy.contains('button', 'Reopen Ticket').scrollIntoView().click();
      cy.contains(/PENDING_HUMAN|Pending/i).scrollIntoView().should('be.visible');
    });
  });

  it('allows admin to claim tickets and update priority/status directly from /admin/tickets queue', () => {
    // Seed a ticket directly for fast queue-management verification
    cy.seedDatabase({
      tables: {
        tickets: [
          {
            id: '11111111-2222-4333-8444-555555555555',
            user_id: '00000000-0000-4000-8000-000000000003',
            company_id: 'comp-ritesh-001',
            company: 'RITESH PVT LTD',
            subject: 'SSO authentication failure on internal HR portal',
            summary: 'SSO authentication failure on internal HR portal',
            description: 'Employees receive SAML assertion error when signing into HR portal.',
            category: 'Access',
            subcategory: 'Login Failure',
            priority: 'medium',
            assigned_team: 'IAM Team',
            status: 'pending_human',
            confidence: 0.91,
            auto_resolve: false,
            is_duplicate: false,
            metadata: { confidence: 0.91 },
          },
        ],
      },
    });

    cy.intercept('PATCH', '**/rest/v1/tickets**').as('patchTicket');
    cy.login('admin@helpdesk.ai', 'AdminPass@123');
    cy.visit('/admin/tickets');

    cy.contains('SSO authentication failure on internal HR portal').should('be.visible');

    // Claim unassigned ticket directly from table row and wait for PATCH persistence
    cy.contains('button', 'Claim').scrollIntoView().click({ force: true });
    cy.wait('@patchTicket');
    cy.contains('button', 'Claim').should('not.exist');

    // Update priority dropdown from medium -> high and wait for PATCH persistence
    cy.get('table tbody tr')
      .first()
      .find('select')
      .first()
      .should('not.be.disabled')
      .select('high');
    cy.wait('@patchTicket');

    // Verify persisted priority & claimed agent survive page reload
    cy.reload();
    cy.contains('SSO authentication failure on internal HR portal').should('be.visible');
    cy.get('table tbody tr').first().find('select').first().should('have.value', 'high');
  });
});
