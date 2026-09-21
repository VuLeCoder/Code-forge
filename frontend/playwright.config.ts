import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:3111", browserName: "chromium" },
  webServer: [
    { command: "node test/profile-server.mjs", url: "http://127.0.0.1:4111/health", reuseExistingServer: false },
    {
      command: "corepack pnpm build && corepack pnpm start --port 3111",
      url: "http://localhost:3111", reuseExistingServer: false, timeout: 180_000,
      env: { BACKEND_URL: "http://127.0.0.1:4111", APP_ORIGIN: "http://localhost:3111" },
    },
  ],
});
