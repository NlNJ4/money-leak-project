import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = {
  "@": path.resolve(__dirname),
  // The server-only guard throws outside React Server Components;
  // stub it so tests can import server modules.
  "server-only": path.resolve(__dirname, "test/server-only-stub.ts"),
};

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      {
        resolve: { alias },
        test: {
          // Fast, hermetic unit tests — no database, no network.
          name: "unit",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          // Integration tests run against a real (local/CI) Supabase stack.
          // The setup file refuses to run against anything but localhost, so
          // production credentials can never execute these suites.
          name: "integration",
          environment: "node",
          include: ["test-integration/**/*.test.ts"],
          setupFiles: ["test-integration/setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
