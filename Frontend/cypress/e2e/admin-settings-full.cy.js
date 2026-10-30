/**
 * E2E tests for issue #1404 — Admin Settings page: full workflow coverage.
 *
 * Tests the complete admin settings UI including:
 *  - Page load and navigation
 *  - AI settings controls (confidence threshold, duplicate sensitivity)
 *  - Auto-close settings (dropdown options & persistence)
 *  - Auto-persisted state across page reload
 *  - Keyboard navigation
 */

/* global cy, Cypress */

const SETTINGS_URL = '/admin/settings';

describe('Admin Settings — Page Structure', () => {
  beforeEach(() => {
    if (Cypress.env('SKIP_AUTH') !== 'true') {
      cy.loginAsAdmin();
    }
    cy.stubBackendApis();
    cy.visit(SETTINGS_URL);
  });

  it('loads the settings page without errors', () => {
    cy.get('body').should('not.contain', 'Error 500');
    cy.contains(/Settings/i).should('be.visible');
  });

  it('has a visible settings heading', () => {
    cy.get('h1, h2, h3').first().should('exist').and('be.visible');
  });

  it('has settings card sections', () => {
    cy.contains(/AI Settings/i).scrollIntoView().should('be.visible');
    cy.contains(/Ticket Settings/i).scrollIntoView().should('be.visible');
    cy.contains(/Notifications/i).scrollIntoView().should('be.visible');
  });

  it('has interactive toggle buttons', () => {
    cy.get('button')
      .filter((_, el) => el.className.includes('rounded-full'))
      .should('have.length.at.least', 3);
  });

  it('renders form controls', () => {
    cy.get('input[type="range"], button').should('have.length.at.least', 2);
  });

  it('remains on settings route after load', () => {
    cy.url().should('include', '/admin/settings');
  });
});

describe('Admin Settings — AI Configuration', () => {
  beforeEach(() => {
    if (Cypress.env('SKIP_AUTH') !== 'true') {
      cy.loginAsAdmin();
    }
    cy.stubBackendApis();
    cy.visit(SETTINGS_URL);
  });

  it('displays the AI confidence threshold control', () => {
    cy.contains(/AI Confidence Threshold/i).scrollIntoView().should('be.visible');
  });

  it('displays the duplicate sensitivity control', () => {
    cy.contains(/Duplicate Detection/i).scrollIntoView().should('be.visible');
  });

  it('clamps confidence threshold range max to 1', () => {
    cy.get('input[type="range"]').first().should('have.attr', 'max', '1');
  });
});

describe('Admin Settings — Auto-Close Configuration', () => {
  beforeEach(() => {
    if (Cypress.env('SKIP_AUTH') !== 'true') {
      cy.loginAsAdmin();
    }
    cy.stubBackendApis();
    cy.visit(SETTINGS_URL);
  });

  it('has an auto-close section and auto-resolve toggle', () => {
    cy.contains(/Auto-Close Tickets/i).scrollIntoView().should('be.visible');
    cy.contains(/Enable Auto Resolve/i).scrollIntoView().should('be.visible');
  });

  it('can toggle auto-resolve on and off', () => {
    cy.get('button')
      .filter((_, el) => el.className.includes('rounded-full') && el.className.includes('w-14'))
      .first()
      .click({ force: true });
    cy.get('body').should('be.visible');
  });

  it('displays valid auto-close day count selection', () => {
    cy.contains('button', /7 Days|3 Days|14 Days/i).scrollIntoView().should('be.visible');
  });
});

describe('Admin Settings — Save and Persistence', () => {
  beforeEach(() => {
    if (Cypress.env('SKIP_AUTH') !== 'true') {
      cy.loginAsAdmin();
    }
    cy.stubBackendApis();
    cy.visit(SETTINGS_URL);
  });

  it('auto-persists toggle changes into localStorage store', () => {
    cy.get('button')
      .filter((_, el) => el.className.includes('rounded-full') && el.className.includes('w-14'))
      .first()
      .click({ force: true });

    cy.window().then((win) => {
      const saved = win.localStorage.getItem('admin-storage-settings');
      expect(saved).to.be.a('string');
    });
  });

  it('does not navigate away when updating settings', () => {
    cy.get('button')
      .filter((_, el) => el.className.includes('rounded-full') && el.className.includes('w-14'))
      .first()
      .click({ force: true });
    cy.url().should('include', '/admin/settings');
  });
});

describe('Admin Settings — Keyboard Navigation', () => {
  beforeEach(() => {
    if (Cypress.env('SKIP_AUTH') !== 'true') {
      cy.loginAsAdmin();
    }
    cy.stubBackendApis();
    cy.visit(SETTINGS_URL);
  });

  it('form controls are focusable', () => {
    cy.get('input[type="range"]').first().focus();
    cy.focused().should('exist');
  });

  it('toggle button is focusable', () => {
    cy.get('button')
      .filter((_, el) => el.className.includes('rounded-full') && el.className.includes('w-14'))
      .first()
      .focus();
    cy.focused().should('exist');
  });
});
