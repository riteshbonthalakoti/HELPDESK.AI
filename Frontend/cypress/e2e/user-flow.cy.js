/* global cy */
/**
 * E2E Test Suite — User Login and Ticket Creation Flow
 *
 * Covers:
 * - User authentication via email and password
 * - Successful redirection to dashboard after login
 * - Navigation to ticket creation form
 * - Inputting required fields for a new ticket
 * - Form submission and verification
 *
 * Fixes #2181: Write end-to-end integration tests for user login and ticket creation flow
 */

describe('User Authentication and Ticket Creation', () => {
  const mockUser = {
    id: 'test-user-uid',
    email: 'user@helpdesk.ai',
    password: 'Password123!',
    fullName: 'Test User',
  };

  const userProfile = {
    id: mockUser.id,
    email: mockUser.email,
    role: 'user',
    status: 'active',
    company_id: 'test-company-id',
    company: 'TestCorp',
    full_name: mockUser.fullName,
  };

  beforeEach(() => {
    cy.clearAllLocalStorage();
    cy.clearAllSessionStorage();
    cy.clearAllCookies();
    cy.stubBackendApis();
  });

  it('should successfully authenticate the user and redirect to dashboard', () => {
    const expiresAtSec = Math.floor(Date.now() / 1000) + 3600;

    cy.intercept('POST', '**/auth/v1/token?grant_type=password', {
      statusCode: 200,
      body: {
        access_token: [
          btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
          btoa(JSON.stringify({ sub: mockUser.id, exp: expiresAtSec })),
          'mock-sig',
        ]
          .join('.')
          .replace(/=/g, ''),
        refresh_token: 'fake-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: expiresAtSec,
        user: {
          id: mockUser.id,
          email: mockUser.email,
          user_metadata: { full_name: mockUser.fullName, role: 'user' },
        },
      },
    }).as('loginRequest');

    cy.intercept('GET', '**/rest/v1/profiles**', (req) => {
      const wantsObject = String(req.headers.accept || '').includes(
        'application/vnd.pgrst.object+json'
      );
      req.reply({
        statusCode: 200,
        body: wantsObject ? userProfile : [userProfile],
      });
    }).as('getUserProfile');

    cy.visit('/login');

    cy.get('input[type="email"], input[name="email"]').first().type(mockUser.email);
    cy.get('input[type="password"], input[name="password"]').first().type(mockUser.password);
    cy.get('button[type="submit"]').first().click();

    cy.wait('@loginRequest');

    cy.url().should('include', '/dashboard');
    cy.contains(new RegExp(`${mockUser.fullName}|Welcome`, 'i'), { timeout: 12000 }).should(
      'be.visible'
    );
  });

  it('should navigate to ticket creation, fill the form and submit a new ticket', () => {
    const expiresAtSec = Math.floor(Date.now() / 1000) + 3600;
    const sessionJson = JSON.stringify({
      access_token: [
        btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
        btoa(JSON.stringify({ sub: mockUser.id, exp: expiresAtSec })),
        'mock-sig',
      ]
        .join('.')
        .replace(/=/g, ''),
      refresh_token: 'fake-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAtSec,
      user: {
        id: mockUser.id,
        email: mockUser.email,
        user_metadata: { full_name: mockUser.fullName, role: 'user' },
      },
    });
    const zustandAuthJson = JSON.stringify({
      state: { profile: userProfile },
      version: 0,
    });

    cy.on('window:before:load', (win) => {
      win.localStorage.setItem('sb-localhost-auth-token', sessionJson);
      win.localStorage.setItem('sb-127-auth-token', sessionJson);
      win.localStorage.setItem('auth-storage', zustandAuthJson);
    });

    cy.intercept('GET', '**/auth/v1/user**', {
      statusCode: 200,
      body: {
        id: mockUser.id,
        email: mockUser.email,
        user_metadata: { full_name: mockUser.fullName, role: 'user' },
      },
    }).as('getAuthUser');

    cy.intercept('GET', '**/rest/v1/profiles**', (req) => {
      const wantsObject = String(req.headers.accept || '').includes(
        'application/vnd.pgrst.object+json'
      );
      req.reply({
        statusCode: 200,
        body: wantsObject ? userProfile : [userProfile],
      });
    }).as('getUserProfile');

    cy.visit('/dashboard');
    cy.waitForPageLoad();

    cy.visit('/create-ticket');
    cy.get('textarea[placeholder*="Describe your problem" i]')
      .first()
      .should('be.visible')
      .type(
        'I have been trying to log into the email portal but it keeps giving me a 500 internal server error.'
      );

    cy.contains('button[type="submit"]', 'Submit Ticket').scrollIntoView().click();

    cy.url({ timeout: 15000 }).should('satisfy', (url) =>
      url.includes('/ai-processing') || url.includes('/ai-understanding')
    );
  });
});
