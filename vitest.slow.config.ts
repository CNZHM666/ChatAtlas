import { defineConfig } from "vitest/config";
import { SLOW_TESTS } from "./vitest.config";

export default defineConfig({
  test: { environment: "node", include: SLOW_TESTS, setupFiles: "./src/test/setup.ts" },
});
