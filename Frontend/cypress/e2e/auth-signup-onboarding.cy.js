/* global cy */
/**
 * Full-Stack E2E Suite — Complete User Signup, Validation & Admin Onboarding
 *
 * Covers:
 * - Signup form validation (missing fields, missing company, password policy, mismatch)
 * - Duplicate account registration rejection
 * - Full employee registration under RITESH PVT LTD -> /user-lobby
 * - Admin approval workflow in /admin/users ("Pending Requests" -> "Approve" -> "All Users")
 * - Post-approval employee login -> /dashboard & invalid credential handling
 *
 * Issue #3914
 */

describe('Complete User Signup & Onboarding Workflow', () => {
  beforeEach(() => {
    cy.resetDatabase();
  });

  it('validates signup form constraints before allowing submission', () => {
    cy.visit('/signup');
    cy.contains('Create Account').should('be.visible');

    // 1. Empty form submission
    cy.contains('button', 'Submit Registration').click();
    cy.contains('All fields are required.').should('be.visible');

    // 2. Fill fields without selecting a company
    cy.get('input[placeholder="Enter your name"]').type('Priya Nair');
    cy.get('input[placeholder="Enter your system email"]').type('priya.nair@example.com');
    cy.get('input[placeholder="Min 8 chars"]').type('Weak12');
    cy.get('input[placeholder="Repeat"]').type('Weak12');
    cy.contains('button', 'Submit Registration').click();
    cy.contains('Please select your company.').should('be.visible');

    // 3. Select active company from searchable dropdown
    cy.contains('Select your company...').click();
    cy.get('input[placeholder="Search companies..."]').type('RITESH');
    cy.contains('RITESH PVT LTD').click();

    // 4. Weak password (< 8 chars) rejected
    cy.contains('button', 'Submit Registration').click();
    cy.contains('Password must be at least 8 characters long.').should('be.visible');

    // 5. Mismatched confirm password rejected while live checklist turns green
    cy.get('input[placeholder="Min 8 chars"]').clear().type('StrongPass123');
    cy.contains('✓').should('be.visible');
    cy.get('input[placeholder="Repeat"]').clear().type('DifferentPass123');
    cy.contains('button', 'Submit Registration').click();
    cy.contains('Passwords do not match.').should('be.visible');
  });

  it('rejects duplicate registration for an already-registered email', () => {
    cy.visit('/signup');

    cy.contains('Select your company...').click();
    cy.contains('RITESH PVT LTD').click();

    cy.get('input[placeholder="Enter your name"]').type('Existing Employee');
    cy.get('input[placeholder="Enter your system email"]').type('employee@helpdesk.ai');
    cy.get('input[placeholder="Min 8 chars"]').type('StrongPass123');
    cy.get('input[placeholder="Repeat"]').type('StrongPass123');

    cy.contains('button', 'Submit Registration').click();
    cy.contains(/already registered/i).should('be.visible');
  });

  it('completes user signup, admin approval, and authenticated dashboard login', () => {
    const newEmployee = {
      fullName: 'Aarav Sharma',
      email: 'aarav.sharma@example.com',
      passInput: 'TestExamplePass123',
      company: 'RITESH PVT LTD',
    };

    // ── Step 1: Employee registers on /signup ──────────────────────────────
    cy.visit('/signup');

    cy.contains('Select your company...').click();
    cy.get('input[placeholder="Search companies..."]').type('RITESH');
    cy.contains(newEmployee.company).click();

    cy.get('input[placeholder="Enter your name"]').type(newEmployee.fullName);
    cy.get('input[placeholder="Enter your system email"]').type(newEmployee.email);
    cy.get('input[placeholder="Min 8 chars"]').type(newEmployee.passInput);
    cy.get('input[placeholder="Repeat"]').type(newEmployee.passInput);

    cy.contains('button', 'Submit Registration').click();

    // Newly registered employee enters pending-review lobby
    cy.url({ timeout: 15000 }).should('include', '/user-lobby');
    cy.contains(/Pending Review/i).should('be.visible');
    cy.contains(newEmployee.fullName).should('be.visible');
    cy.contains(newEmployee.company).should('be.visible');

    // ── Step 2: Admin logs in and approves the pending employee ────────────
    cy.switchActorSession();
    cy.visit('/login');
    cy.get('input[type="email"]').type('admin@helpdesk.ai');
    cy.get('input[type="password"]').type('AdminPass@123');
    cy.get('button[type="submit"]').click();

    cy.url({ timeout: 15000 }).should('include', '/admin/dashboard');

    cy.visit('/admin/users');
    cy.contains('button', /Pending Requests/i).click();
    cy.contains(newEmployee.fullName).scrollIntoView().should('be.visible');
    cy.contains(newEmployee.email).scrollIntoView().should('be.visible');

    cy.contains('button', /Approve/i).scrollIntoView().click();

    // Verify user is now listed in All Users directory
    cy.contains('button', /All Users/i).click();
    cy.contains(newEmployee.fullName).scrollIntoView().should('be.visible');

    // ── Step 3: Approved employee logs in (and wrong password fails first) ─
    cy.switchActorSession();
    cy.visit('/login');

    cy.get('input[type="email"]').type(newEmployee.email);
    cy.get('input[type="password"]').type('WrongPassword999');
    cy.get('button[type="submit"]').click();
    cy.contains(/Invalid login credentials/i).should('be.visible');

    cy.get('input[type="password"]').clear().type(newEmployee.passInput);
    cy.get('button[type="submit"]').click();

    cy.url({ timeout: 15000 }).should('include', '/dashboard');
    cy.contains(newEmployee.fullName, { timeout: 12000 }).should('be.visible');
  });
});
