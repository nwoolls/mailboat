import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    // The Mac's web view, so labels read as on the Mac (⌘K); the Windows
    // forms are tested by passing the platform (`shared/lib/platform`).
    environmentOptions: {
      happyDOM: {
        settings: {
          navigator: {
            userAgent:
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
          },
        },
      },
    },
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    // `bun run coverage` (scripts/coverage.ts) turns this on and reads the
    // summary; a plain `bun run test` doesn't measure.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
      exclude: ["**/*.test.{ts,tsx}", "src/platform/tauri/bindings.ts", "**/*.d.ts"],
      reporter: ["json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
