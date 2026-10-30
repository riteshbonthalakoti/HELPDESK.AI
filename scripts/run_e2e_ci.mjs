#!/usr/bin/env node
/**
 * Full-Stack Cypress E2E Orchestrator for Local & GitHub Actions CI/CD.
 *
 * 1. Builds the Vite production bundle pointed at the local E2E services.
 * 2. Boots the stateful local Supabase emulator (127.0.0.1:54321).
 * 3. Boots the FastAPI backend in degraded-ML E2E mode (127.0.0.1:8000).
 * 4. Serves the built frontend via `vite preview` (http://localhost:5173).
 * 5. Polls health checks on all three services before running Cypress headlessly.
 * 6. Guarantees deterministic process teardown across Linux & Windows.
 */

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const FRONTEND_DIR = path.join(ROOT_DIR, "Frontend");

const SUPABASE_URL = process.env.E2E_SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY || "e2e-header.e2e-payload.e2e-signature";
const BACKEND_URL = process.env.E2E_BACKEND_URL || "http://127.0.0.1:8000";
const FRONTEND_URL = process.env.E2E_FRONTEND_URL || "http://localhost:5173";
const PYTHON_BIN = process.env.PYTHON_BIN || "python";
const VERBOSE = process.env.E2E_VERBOSE === "1";

const VITE_BIN = path.join(FRONTEND_DIR, "node_modules", "vite", "bin", "vite.js");
const CYPRESS_BIN = path.join(FRONTEND_DIR, "node_modules", "cypress", "bin", "cypress");

const children = [];

function killChildTree(entry) {
  const { proc, name } = entry;
  if (!proc || proc.killed || proc.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("C:\\Windows\\System32\\taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      proc.kill("SIGTERM");
    }
  } catch (err) {
    if (VERBOSE) {
      console.warn(`[orchestrator] Failed stopping ${name}:`, err.message);
    }
  }
}

function cleanupAll() {
  for (const entry of children.reverse()) {
    killChildTree(entry);
  }
}

process.on("SIGINT", () => {
  cleanupAll();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanupAll();
  process.exit(143);
});

function startService(name, cmd, args, options = {}) {
  const logs = [];
  const proc = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

  const record = (prefix, chunk) => {
    const text = chunk.toString();
    logs.push(`${prefix}${text}`);
    if (logs.length > 200) logs.shift();
    if (VERBOSE) {
      process.stdout.write(`[${name}] ${text}`);
    }
  };

  proc.stdout.on("data", (d) => record("", d));
  proc.stderr.on("data", (d) => record("[stderr] ", d));

  const entry = { name, proc, logs };
  children.push(entry);
  return entry;
}

async function waitForEndpoint(label, url, serviceEntry, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "no response yet";

  while (Date.now() < deadline) {
    if (serviceEntry && serviceEntry.proc.exitCode !== null) {
      const tail = serviceEntry.logs.join("");
      throw new Error(
        `Service '${label}' exited prematurely with code ${serviceEntry.proc.exitCode}.\n--- Recent logs ---\n${tail}`
      );
    }

    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`[orchestrator] ${label} is ready at ${url} (HTTP ${res.status})`);
        return;
      }
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err.message;
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  const tail = serviceEntry ? serviceEntry.logs.join("") : "";
  throw new Error(
    `Timed out waiting for ${label} at ${url} (${lastErr}).\n--- Recent logs ---\n${tail}`
  );
}

async function main() {
  const sharedEnv = {
    ...process.env,
    VITE_SUPABASE_URL: SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    VITE_BACKEND_URL: BACKEND_URL,
    VITE_API_URL: BACKEND_URL,
    VITE_WS_URL: "ws://127.0.0.1:8000/ws/metrics",
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY: SUPABASE_ANON_KEY,
    ALLOW_DEGRADED_STARTUP: "1",
    PYTHONPATH: ROOT_DIR,
  };

  if (process.env.SKIP_FRONTEND_BUILD !== "1") {
    console.log("[orchestrator] Building production frontend bundle for E2E...");
    const buildRes = spawnSync(process.execPath, [VITE_BIN, "build"], {
      cwd: FRONTEND_DIR,
      env: sharedEnv,
      stdio: "inherit",
    });
    if (buildRes.status !== 0) {
      process.exit(buildRes.status ?? 1);
    }
  }

  try {
    console.log("[orchestrator] Starting stateful local Supabase emulator...");
    const supabaseSvc = startService(
      "mock-supabase",
      process.execPath,
      [path.join(ROOT_DIR, "scripts", "e2e_mock_supabase.mjs")],
      { cwd: ROOT_DIR, env: sharedEnv }
    );
    await waitForEndpoint("mock-supabase", `${SUPABASE_URL}/health`, supabaseSvc, 20000);

    console.log("[orchestrator] Starting FastAPI backend service...");
    const backendSvc = startService(
      "fastapi-backend",
      PYTHON_BIN,
      [path.join(ROOT_DIR, "scripts", "e2e_backend_runner.py")],
      { cwd: ROOT_DIR, env: sharedEnv }
    );
    await waitForEndpoint("fastapi-backend", `${BACKEND_URL}/health`, backendSvc, 45000);

    console.log("[orchestrator] Starting Vite preview frontend server...");
    const frontendSvc = startService(
      "vite-preview",
      process.execPath,
      [VITE_BIN, "preview", "--host", "--port", "5173", "--strictPort"],
      { cwd: FRONTEND_DIR, env: sharedEnv }
    );
    await waitForEndpoint("vite-preview", `${FRONTEND_URL}/`, frontendSvc, 25000);

    const extraCypressArgs = process.argv.slice(2);
    const hasBrowserArg = extraCypressArgs.some(
      (a) => a === "--browser" || a === "-b" || a.startsWith("--browser=")
    );
    const cypressArgs = [
      CYPRESS_BIN,
      "run",
      ...(hasBrowserArg ? [] : ["--browser", process.env.CYPRESS_BROWSER || "electron"]),
      ...extraCypressArgs,
    ];

    console.log(`[orchestrator] Executing Cypress E2E suite: cypress ${cypressArgs.slice(1).join(" ")}`);
    const cypressRes = spawnSync(process.execPath, cypressArgs, {
      cwd: FRONTEND_DIR,
      env: {
        ...sharedEnv,
        CYPRESS_BASE_URL: FRONTEND_URL,
      },
      stdio: "inherit",
    });

    if (cypressRes.status !== 0) {
      console.error(`[orchestrator] Cypress exited with non-zero status: ${cypressRes.status}`);
      for (const svc of children) {
        if (svc.logs.length > 0) {
          console.error(`\n--- [${svc.name}] tail logs ---\n${svc.logs.slice(-30).join("")}`);
        }
      }
      process.exitCode = cypressRes.status ?? 1;
    } else {
      console.log("[orchestrator] Cypress E2E suite completed with 100% green status!");
      process.exitCode = 0;
    }
  } finally {
    console.log("[orchestrator] Shutting down E2E services...");
    cleanupAll();
  }
}

main().catch((err) => {
  console.error("[orchestrator] Fatal error:", err);
  cleanupAll();
  process.exit(1);
});
