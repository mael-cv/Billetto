import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false, // Exécution séquentielle pour éviter les conflits d'état sur la DB
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node apps/api/dist/main.js",
      url: "http://localhost:3001/api/v1/health",
      reuseExistingServer: true,
      cwd: "../..",
      timeout: 20_000,
    },
    {
      command: "pnpm --filter @billetto/web dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      cwd: "../..",
      timeout: 20_000,
    },
  ],
});
