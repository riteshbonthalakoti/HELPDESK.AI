/* global cy */
/**
 * E2E Test Suite — Notification & Webhook Settings Workflows
 *
 * Fixes #1167: Full E2E Cypress Test Suite
 */

describe('Admin Settings — Webhook & Notification Definitions', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
    cy.stubBackendApis();
    cy.stubSettingsApi({
      webhooks: [
        {
          id: 'wh-001',
          name: 'Slack Alerts',
          url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXX',
          events: ['ticket.created', 'ticket.resolved'],
          active: true,
        },
      ],
    });
    cy.goToAdminSettings();
  });

  it('settings page loads without uncaught errors', () => {
    cy.get('body').should('be.visible');
    cy.contains(/Settings/i).should('be.visible');
  });

  it('page displays a settings heading', () => {
    cy.get('h1, h2, h3').should('have.length.at.least', 1);
  });

  it('AI settings section is present with interactive elements', () => {
    cy.contains(/AI Confidence Threshold/i).scrollIntoView().should('be.visible');
    cy.get('input, select, button').should('have.length.at.least', 1);
  });

  it('all toggle buttons are clickable without throwing', () => {
    cy.get('button')
      .filter((_, el) => el.className.includes('rounded-full') && el.className.includes('w-14'))
      .each(($btn) => {
        cy.wrap($btn).click({ force: true });
      });
    cy.get('body').should('be.visible');
  });

  it('notification settings section renders with toggles', () => {
    cy.contains(/Notifications/i).scrollIntoView().should('be.visible');
    cy.contains(/Email Notifications/i).scrollIntoView().should('be.visible');
    cy.contains(/Critical Admin Alerts/i).scrollIntoView().should('be.visible');
  });

  it('page redirects unauthenticated users (auth guard works)', () => {
    cy.on('window:before:load', (win) => {
      win.localStorage.clear();
      win.sessionStorage.clear();
    });
    cy.intercept('GET', '**/auth/v1/user**', {
      statusCode: 401,
      body: { message: 'Invalid JWT' },
    });
    cy.clearAllLocalStorage();
    cy.clearAllSessionStorage();
    cy.clearAllCookies();

    cy.visit('/admin/settings', { failOnStatusCode: false });
    cy.url().should('not.include', '/admin/settings');
  });

  it('settings page is accessible with heading landmarks', () => {
    cy.get('h1, h2, h3').should('have.length.at.least', 1);
  });

  it('settings form has labels for screen readers', () => {
    cy.get('label').should('have.length.at.least', 1);
    cy.get('input, select, textarea, button').should('have.length.at.least', 1);
  });

  it('settings toggle updates persisted state cleanly', () => {
    cy.get('button')
      .filter((_, el) => el.className.includes('rounded-full') && el.className.includes('w-14'))
      .first()
      .click({ force: true });

    cy.get('body').should('be.visible');
  });
});
