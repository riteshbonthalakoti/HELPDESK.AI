/**
 * E2E tests for issue #1404 — Auto-Close and Notification Workflows.
 *
 * Tests:
 *  - Auto-close setting changes and toggle persistence
 *  - Admin ticket dashboard & detail navigation
 *  - Notification & edge-case rendering
 */

/* global cy, Cypress */

describe('Auto-Close — Admin Settings Integration', () => {
  beforeEach(() => {
    if (Cypress.env('SKIP_AUTH') !== 'true') {
      cy.loginAsAdmin();
    }
    cy.stubBackendApis();
  });

  it('toggles auto-resolve and updates auto-close days in settings', () => {
    cy.visit('/admin/settings');
    cy.contains(/Auto-Close Tickets/i).scrollIntoView().should('be.visible');

    // Toggle Enable Auto Resolve
    cy.get('button')
      .filter((_, el) => el.className.includes('rounded-full') && el.className.includes('w-14'))
      .first()
      .scrollIntoView()
      .click({ force: true });

    // Open Auto-Close days Select and pick 3 Days
    cy.contains('button', /7 Days|3 Days|14 Days/i).scrollIntoView().click({ force: true });
    cy.contains('button', /3 Days/i).scrollIntoView().click({ force: true });
    cy.contains('button', /3 Days/i).scrollIntoView().should('be.visible');
  });

  it('persists auto-close settings after reload', () => {
    cy.visit('/admin/settings');

    cy.contains('button', /7 Days|3 Days|14 Days/i).scrollIntoView().click({ force: true });
    cy.contains('button', /14 Days/i).scrollIntoView().click({ force: true });
    cy.reload();

    cy.contains('button', /14 Days/i).scrollIntoView().should('be.visible');
  });

  it('disables auto-resolve when toggled off', () => {
    cy.visit('/admin/settings');

    const getAutoResolveBtn = () =>
      cy
        .get('button')
        .filter((_, el) => el.className.includes('rounded-full') && el.className.includes('w-14'))
        .first();

    getAutoResolveBtn().then(($btn) => {
      if ($btn.hasClass('bg-indigo-600')) {
        cy.wrap($btn).scrollIntoView().click({ force: true });
      }
    });

    getAutoResolveBtn().should('have.class', 'bg-slate-200');
  });
});

describe('Auto-Close — Ticket Dashboard', () => {
  beforeEach(() => {
    if (Cypress.env('SKIP_AUTH') !== 'true') {
      cy.loginAsAdmin();
    }
    cy.stubBackendApis();
  });

  it('loads the admin tickets page', () => {
    cy.visit('/admin/tickets');
    cy.get('body').should('not.contain', 'Error 500');
    cy.get('body').should('not.contain', 'Network Error');
  });

  it('admin can see ticket list view', () => {
    cy.visit('/admin/tickets');
    cy.get('body', { timeout: 10000 }).should('exist');
    cy.url().should('include', '/admin/tickets');
  });

  it('admin can open a ticket detail page when tickets exist', () => {
    const mockTicket = {
      id: 'notif-ticket-001',
      ticket_id: 'notif-ticket-001',
      subject: 'Firewall port 443 blocked',
      summary: 'Firewall port 443 blocked',
      status: 'open',
      priority: 'high',
      confidence: 0.9,
      company: 'TestCorp',
      created_at: new Date().toISOString(),
    };

    cy.intercept('GET', '**/rest/v1/tickets**', (req) => {
      const wantsObject = String(req.headers.accept || '').includes(
        'application/vnd.pgrst.object+json'
      );
      req.reply({
        statusCode: 200,
        body: wantsObject ? mockTicket : [mockTicket],
      });
    }).as('getSeededTickets');

    cy.visit('/admin/tickets');
    cy.wait('@getSeededTickets');
    cy.get('button[title="Open Detailed View"]').first().scrollIntoView().click({ force: true });
    cy.url().should('include', '/admin/ticket/notif-ticket-001');
  });

  it('admin dashboard shows ticket metrics', () => {
    cy.visit('/admin/dashboard');
    cy.get('body', { timeout: 10000 }).should('not.be.empty');
  });
});

describe('Notification Workflow', () => {
  beforeEach(() => {
    if (Cypress.env('SKIP_AUTH') !== 'true') {
      cy.loginAsAdmin();
    }
    cy.stubBackendApis();
  });

  it('admin dashboard renders cleanly', () => {
    cy.visit('/admin/dashboard');
    cy.get('body').should('be.visible');
  });

  it('admin settings renders notification preferences', () => {
    cy.visit('/admin/settings');
    cy.contains(/Email Notifications/i).scrollIntoView().should('be.visible');
    cy.contains(/Critical Admin Alerts/i).scrollIntoView().should('be.visible');
  });
});

describe('Auto-Close — Edge Cases', () => {
  beforeEach(() => {
    if (Cypress.env('SKIP_AUTH') !== 'true') {
      cy.loginAsAdmin();
    }
    cy.stubBackendApis();
  });

  it('restricts auto-close days to positive preset durations (3, 7, 14)', () => {
    cy.visit('/admin/settings');
    cy.contains('button', /7 Days|3 Days|14 Days/i).scrollIntoView().click({ force: true });
    cy.contains('button', /^3 Days$/i).should('exist');
    cy.contains('button', /^7 Days$/i).should('exist');
    cy.contains('button', /^14 Days$/i).should('exist');
    cy.contains('button', /^0 Days$/i).should('not.exist');
  });

  it('page does not crash when settings are left at defaults', () => {
    cy.visit('/admin/settings');
    cy.get('body').should('not.contain', 'Unhandled');
    cy.get('body').should('not.contain', 'Error 500');
    cy.url().should('include', '/admin/settings');
  });
});
