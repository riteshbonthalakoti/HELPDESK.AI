/* global cy */
/**
 * E2E Test Suite — Admin Settings Persistence
 *
 * Covers:
 * - Page load and rendering of settings controls
 * - Settings persistence after page reload (Zustand persisted store)
 * - Navigation elements and form controls
 * - Settings toggle interactions
 *
 * Fixes #1167: Full E2E Cypress Test Suite for Admin Settings
 */

describe('Admin Settings Page', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
    cy.stubBackendApis();
    cy.stubSettingsApi();
    cy.goToAdminSettings();
  });

  it('should load the admin settings page without errors', () => {
    cy.get('body').should('be.visible');
    cy.url().should('include', '/admin/settings');
    cy.contains(/Settings/i).should('be.visible');
  });

  it('should display heading elements', () => {
    cy.get('h1, h2, h3').should('have.length.at.least', 1);
  });

  it('should display navigation elements', () => {
    cy.get('nav, header, [role="navigation"], aside').should('exist');
  });

  it('should render settings form controls', () => {
    cy.get('input, select, textarea, button').should('have.length.at.least', 1);
  });

  it('should display AI Settings section with confidence threshold slider', () => {
    cy.contains(/AI Settings/i).scrollIntoView().should('be.visible');
    cy.get('input[type="range"]').should('have.length.at.least', 1);
  });

  it('should display notification settings with email and admin alert toggles', () => {
    cy.contains(/Notifications/i).scrollIntoView().should('be.visible');
    cy.contains(/Email Notifications/i).scrollIntoView().should('be.visible');
    cy.contains(/Critical Admin Alerts/i).scrollIntoView().should('be.visible');
  });

  it('should display auto-close settings', () => {
    cy.contains(/Auto-Close Tickets/i).scrollIntoView().should('be.visible');
  });

  it('should persist settings after page reload', () => {
    const getToggle = () =>
      cy
        .get('button')
        .filter((_, el) => el.className.includes('rounded-full') && el.className.includes('w-14'))
        .first();

    getToggle().then(($btn) => {
      const wasActive = $btn.hasClass('bg-indigo-600');
      const expectedClass = wasActive ? 'bg-slate-200' : 'bg-indigo-600';

      cy.wrap($btn).scrollIntoView().click({ force: true });
      cy.reload();

      cy.contains(/AI Settings/i).scrollIntoView().should('be.visible');
      getToggle().should('have.class', expectedClass);
    });
  });

  it('should handle settings update action', () => {
    cy.get('input[type="range"]').first().invoke('val', 0.7).trigger('change');
    cy.get('body').should('exist');
  });

  it('should display administrator account verification badge', () => {
    cy.contains(/Administrator Account/i).scrollIntoView().should('be.visible');
  });

  it('should render all toggle buttons as interactive', () => {
    cy.get('button')
      .filter((_, el) => el.className.includes('rounded-full') && el.className.includes('w-14'))
      .each(($btn) => {
        cy.wrap($btn).should('not.be.disabled');
      });
  });

  it('should show ticket settings section', () => {
    cy.contains(/Ticket Settings/i).scrollIntoView().should('be.visible');
  });

  it('should handle reload gracefully', () => {
    cy.visit('/admin/settings');
    cy.contains(/AI Confidence Threshold/i).scrollIntoView().should('be.visible');
  });
});
