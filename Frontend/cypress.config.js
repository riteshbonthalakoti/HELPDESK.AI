import { defineConfig } from "cypress";

async function callTestHarness(baseUrl, path, method = "GET", body = undefined) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Test harness ${method} ${path} failed (${res.status}): ${errText}`);
  }
  return res.json();
}

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:5173",
    supportFile: "cypress/support/e2e.js",
    specPattern: "cypress/e2e/**/*.cy.{js,jsx,ts,tsx}",
    viewportWidth: 1280,
    viewportHeight: 720,
    video: false,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 12000,
    requestTimeout: 12000,
    responseTimeout: 20000,
    pageLoadTimeout: 30000,
    retries: {
      runMode: 1,
      openMode: 0,
    },
    env: {
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY:
        "e2e-header.e2e-payload.e2e-signature",
      BACKEND_URL: "http://127.0.0.1:8000",
    },
    setupNodeEvents(on, config) {
      const supabaseUrl =
        process.env.VITE_SUPABASE_URL ||
        config.env.SUPABASE_URL ||
        "http://127.0.0.1:54321";

      on("task", {
        log(message) {
          console.log(message);
          return null;
        },
        async "db:reset"() {
          return callTestHarness(supabaseUrl, "/__test__/reset", "POST");
        },
        async "db:seed"(payload = {}) {
          return callTestHarness(supabaseUrl, "/__test__/seed", "POST", payload);
        },
        async "db:getState"() {
          return callTestHarness(supabaseUrl, "/__test__/state", "GET");
        },
      });

      return config;
    },
  },
});
