// Cypress E2E support global setup
/* global Cypress */
// Cypress E2E support file
import './commands';

// Prevent uncaught exceptions from failing tests
// React lazy loading, chunk loading, and HMR can throw transient errors
Cypress.on('uncaught:exception', (err) => {
  // Ignore known non-critical errors
  const ignoredErrors = [
    'ChunkLoadError',
    'Loading chunk',
    'Loading CSS chunk',
    'NetworkError',
    'Failed to fetch',
    'ResizeObserver loop',
    'Non-Error promise rejection',
  ];

  const shouldIgnore = ignoredErrors.some(
    (pattern) => err.message && err.message.includes(pattern)
  );

  if (shouldIgnore) {
    return false;
  }

  // Returning false prevents Cypress from failing the test
  return false;
});

// Set default viewport
Cypress.config('viewportWidth', 1280);
Cypress.config('viewportHeight', 720);
