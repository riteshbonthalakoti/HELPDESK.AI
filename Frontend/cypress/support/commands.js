/* global Cypress, cy */

// ─── Database & Session Isolation Commands ───────────────────────────────────

/**
 * Reset the stateful local Supabase emulator and clear all browser state.
 */
Cypress.Commands.add('resetDatabase', () => {
  cy.task('db:reset');
  cy.clearCookies();
  cy.clearLocalStorage();
  cy.window({ log: false }).then((win) => {
    win.localStorage.clear();
    win.sessionStorage.clear();
  });
});

/**
 * Seed custom accounts or table rows into the local Supabase emulator.
 */
Cypress.Commands.add('seedDatabase', (payload = {}) => {
  return cy.task('db:seed', payload);
});

/**
 * Cleanly sign out the current browser session without resetting server DB state
 * (used when switching between Employee, Support Agent, and Admin actors).
 */
Cypress.Commands.add('switchActorSession', () => {
  cy.clearCookies();
  cy.clearLocalStorage();
  cy.window({ log: false }).then((win) => {
    win.localStorage.clear();
    win.sessionStorage.clear();
  });
});

// ─── Auth Commands ───────────────────────────────────────────────────────────

/**
 * Login via the real UI form with email and password.
 */
Cypress.Commands.add('login', (email, password) => {
  cy.visit('/login');
  cy.get('input[type="email"]').clear().type(email);
  cy.get('input[type="password"]').clear().type(password);
  cy.get('button[type="submit"]').click();
  cy.url().should('not.include', '/login');
});

/**
 * Build a deterministic JWT-formatted token string so @supabase/supabase-js
 * parses token expiry cleanly without throwing JWT decode warnings.
 */
function buildStubJwt(sub, email, expiresAtSec) {
  const encode = (obj) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    aud: 'authenticated',
    exp: expiresAtSec,
    sub,
    email,
    role: 'authenticated',
  });
  return `${header}.${payload}.stubsignature`;
}

/**
 * Login as admin using fixture credentials.
 * Works seamlessly for both stubbed specs and local emulator specs.
 */
Cypress.Commands.add('loginAsAdmin', () => {
  cy.fixture('admin').then((admin) => {
    const expiresAtSec = Math.floor(Date.now() / 1000) + 3600;
    const accessToken = buildStubJwt('test-admin-uid', admin.email, expiresAtSec);
    const adminUser = {
      id: 'test-admin-uid',
      aud: 'authenticated',
      role: 'authenticated',
      email: admin.email,
      user_metadata: {
        full_name: admin.fullName,
        role: 'admin',
        company: admin.company || 'TestCorp',
        company_id: 'test-company-id',
      },
      app_metadata: { provider: 'email', providers: ['email'] },
    };
    const adminProfile = {
      id: 'test-admin-uid',
      email: admin.email,
      full_name: admin.fullName,
      role: 'admin',
      status: 'active',
      company_id: 'test-company-id',
      company: admin.company || 'TestCorp',
    };
    const sessionJson = JSON.stringify({
      access_token: accessToken,
      refresh_token: 'fake-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAtSec,
      user: adminUser,
    });
    const zustandAuthJson = JSON.stringify({
      state: { profile: adminProfile },
      version: 0,
    });

    const injectAuthStorage = (win) => {
      win.localStorage.setItem('sb-localhost-auth-token', sessionJson);
      win.localStorage.setItem('sb-127-auth-token', sessionJson);
      win.localStorage.setItem('auth-storage', zustandAuthJson);
    };

    cy.window({ log: false }).then(injectAuthStorage);
    cy.on('window:before:load', injectAuthStorage);

    cy.intercept('GET', '**/auth/v1/user**', {
      statusCode: 200,
      body: adminUser,
    }).as('getAuthUser');

    cy.intercept('POST', '**/auth/v1/token**', {
      statusCode: 200,
      body: JSON.parse(sessionJson),
    }).as('postAuthToken');

    cy.intercept('GET', '**/rest/v1/profiles**', (req) => {
      const wantsObject = String(req.headers.accept || '').includes(
        'application/vnd.pgrst.object+json'
      );
      req.reply({
        statusCode: 200,
        body: wantsObject ? adminProfile : [adminProfile],
      });
    }).as('getAdminProfileDefault');
  });
});

// ─── Settings API Commands ───────────────────────────────────────────────────

/**
 * Stub the Supabase system_settings API to return mock settings.
 * @param {Object} overrides - Partial settings to override defaults
 */
Cypress.Commands.add('stubSettingsApi', (overrides = {}) => {
  const defaultSettings = {
    ai_confidence_threshold: 0.75,
    duplicate_sensitivity: 3,
    enable_auto_resolve: true,
    auto_close_days: 7,
    email_notifications: true,
    admin_alerts: true,
    digest_enabled: false,
    digest_admin_email: 'admin@helpdesk.ai',
    enable_encryption: false,
    enable_pii_redaction: false,
    ...overrides,
  };

  cy.intercept('GET', '**/rest/v1/system_settings**', (req) => {
    const wantsObject = String(req.headers.accept || '').includes(
      'application/vnd.pgrst.object+json'
    );
    req.reply({
      statusCode: 200,
      body: wantsObject ? defaultSettings : [defaultSettings],
      headers: { 'content-range': '0-0/1' },
    });
  }).as('getSettings');

  cy.intercept('PATCH', '**/rest/v1/system_settings**', {
    statusCode: 200,
    body: [{ ...defaultSettings }],
  }).as('saveSettings');

  cy.intercept('POST', '**/rest/v1/system_settings**', {
    statusCode: 201,
    body: [{ ...defaultSettings }],
  }).as('upsertSettings');
});

// ─── Navigation Commands ─────────────────────────────────────────────────────

Cypress.Commands.add('goToAdminSettings', () => {
  cy.visit('/admin/settings');
});

Cypress.Commands.add('goToAdminTickets', () => {
  cy.visit('/admin/tickets');
});

Cypress.Commands.add('goToAdminDashboard', () => {
  cy.visit('/admin/dashboard');
});

// ─── WebSocket / Realtime Commands ───────────────────────────────────────────

Cypress.Commands.add('emitRealtimeTicketUpdate', (ticketId, newStatus) => {
  cy.window().then((win) => {
    const payload = {
      eventType: 'UPDATE',
      new: {
        id: ticketId,
        ticket_id: ticketId,
        status: newStatus,
        updated_at: new Date().toISOString(),
      },
      old: { id: ticketId, ticket_id: ticketId },
    };

    win.dispatchEvent(
      new CustomEvent('supabase-realtime-ticket', { detail: payload })
    );

    if (win.__supabaseRealtimeHandler) {
      win.__supabaseRealtimeHandler(payload);
    }
  });
});

// ─── Utility Commands ────────────────────────────────────────────────────────

Cypress.Commands.add('waitForPageLoad', () => {
  cy.get('body').should('be.visible');
  cy.wait(300);
});

/**
 * Intercept and stub common backend API endpoints with PostgREST single-object awareness.
 */
Cypress.Commands.add('stubBackendApis', () => {
  cy.intercept('GET', '**/rest/v1/tickets**', {
    statusCode: 200,
    body: [],
    headers: { 'content-range': '*/0' },
  }).as('getTicketsList');

  cy.intercept('GET', '**/rest/v1/companies**', (req) => {
    const company = { id: 'test-company-id', name: 'TestCorp', status: 'active' };
    const wantsObject = String(req.headers.accept || '').includes(
      'application/vnd.pgrst.object+json'
    );
    req.reply({
      statusCode: 200,
      body: wantsObject ? company : [company],
    });
  }).as('getCompany');

  cy.intercept('GET', '**/rest/v1/profiles**', (req) => {
    const profile = {
      id: 'test-admin-uid',
      email: 'admin@helpdesk.ai',
      full_name: 'Test Admin',
      role: 'admin',
      status: 'active',
      company_id: 'test-company-id',
      company: 'TestCorp',
    };
    const wantsObject = String(req.headers.accept || '').includes(
      'application/vnd.pgrst.object+json'
    );
    req.reply({
      statusCode: 200,
      body: wantsObject ? profile : [profile],
    });
  }).as('getProfile');
});
