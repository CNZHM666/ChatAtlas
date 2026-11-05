import { defineConfig } from "vitest/config";

/** Benchmarks and evaluations on large fixtures: `npm run test:slow`, not every check. */
export const SLOW_TESTS = ["src/**/*.slow.test.{ts,tsx}"];
// Interface code needs a browser-like document; everything else runs in Node,
// which starts far faster than jsdom for each test file. A plain test that
// needs browser storage opts in with `// @vitest-environment jsdom`.
const DOM_TESTS = ["src/**/*.test.tsx", "src/canvas/**/*.test.ts", "src/sidecar/**/*.test.ts", "src/content/**/*.test.ts"];

export default defineConfig({
  test: {
    // Bound expensive jsdom/IndexedDB workers so full-suite UI waits remain reliable.
    // Never more workers than cores: a 4-vCPU CI runner with 8 workers times out UI waits.
    // Node's navigator.hardwareConcurrency equals os.availableParallelism().
    maxWorkers: Math.max(1, Math.min(8, globalThis.navigator?.hardwareConcurrency || 8)),
    setupFiles: "./src/test/setup.ts",
    // Pipeline tests over large fixtures (554 passages, six long conversations) take 2-4 s here and up to twice that on a
    // shared CI runner; 5 s failed a different one on different runs. A hang still fails, at 15 s.
    testTimeout: 15_000,
    projects: [
      { extends: true, test: { name: "unit", environment: "node", include: ["src/**/*.test.ts"], exclude: [...DOM_TESTS, ...SLOW_TESTS] } },
      { extends: true, test: { name: "dom", environment: "jsdom", include: DOM_TESTS, exclude: SLOW_TESTS } },
    ],
  },
});
