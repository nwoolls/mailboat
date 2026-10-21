import { defineConfig } from "@playwright/test";

/**
 * Browser tests of UI behaviour that unit tests can't see (animations,
 * layout, scrolling), in WebKit: the engine of the macOS web view Mailboat
 * runs in. Real components, a faked Rust side (tests/browser/harness.tsx).
 * As MonoCode's playwright.config.ts.
 */
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1436",
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "webkit", use: { browserName: "webkit" } }],
  webServer: {
    command: "bunx vite --host 127.0.0.1 --port 1436 --strictPort",
    url: "http://127.0.0.1:1436/tests/browser/harness.html",
    reuseExistingServer: false,
  },
});
