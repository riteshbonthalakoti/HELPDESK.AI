/* global describe, it, cy */
describe('User Login Flow', () => {
  it('should allow a user to login and load the dashboard', () => {
    cy.visit('/login');
    cy.get('input[name="email"]').type('employee@helpdesk.ai');
    cy.get('input[name="password"]').type('UserPass@123');
    cy.get('button[type="submit"]').click();

    cy.url({ timeout: 15000 }).should('include', '/dashboard');
    cy.contains(/Jane Employee|Dashboard|Welcome/i).should('be.visible');
  });
});
