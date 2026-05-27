import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "dist/**"],
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
