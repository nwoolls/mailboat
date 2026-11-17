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

/**
 * `bun run test:browser:slow` keeps the page busy on purpose
 * (tests/browser/slowMachine.ts), so a whole test takes several times as
 * long, and its own limit grows to match.
 */
const SLOW = Number(process.env.VITE_SLOW_MACHINE ?? 0) > 0;
/** `BROWSER_TESTS_PORT` lets a second run go beside a long one. */
const PORT = Number(process.env.BROWSER_TESTS_PORT ?? 1436);

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: SLOW ? 180_000 : 30_000,
  outputDir: PORT === 1436 ? "test-results" : `test-results-${PORT}`,
  // How long an `expect` waits for what it checks to become true: 15 s,
  // not Playwright's 5. A busy CI runner sometimes took longer than 5 s to
  // load the page and show the first email, and the test failed there,
  // before checking anything (docs/ROADMAP.md → Flaky tests). A check
  // passes as soon as it holds, so a longer limit only makes a real
  // failure slower to report. What must happen quickly says so itself.
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
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
    command: `bunx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/tests/browser/harness.html`,
    reuseExistingServer: false,
  },
});
