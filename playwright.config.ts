import { defineConfig } from "@playwright/test";

/**
 * Browser tests of UI behaviour that unit tests can't see (animations,
 * layout, scrolling), in WebKit: the engine of the macOS web view the app
 * runs in (and Chromium for Windows' web view, `windows-*.spec.ts`). Real components, a faked Rust side (tests/browser/harness.tsx).
 * As MonoCode's playwright.config.ts.
 */
/**
 * The Windows-only tests, by file name. Playwright matches against the whole
 * path, so an unanchored pattern also matched a checkout whose folder had
 * "windows-" in its name, and every test then ran in Chromium, none in
 * WebKit (2026-11-12).
 */
const WINDOWS_ONLY = /(^|[\\/])windows-[^\\/]*\.spec\.ts$/;

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1436",
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "webkit", use: { browserName: "webkit" }, testIgnore: WINDOWS_ONLY },
    // Windows' web view (WebView2) is Chromium: `windows-*.spec.ts` test
    // what only goes wrong there.
    { name: "windows", use: { browserName: "chromium" }, testMatch: WINDOWS_ONLY },
  ],
  webServer: {
    command: "bunx vite --host 127.0.0.1 --port 1436 --strictPort",
    url: "http://127.0.0.1:1436/tests/browser/harness.html",
    reuseExistingServer: false,
  },
});
