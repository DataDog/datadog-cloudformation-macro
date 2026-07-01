import { readFileSync } from "node:fs";

import { defineConfig } from "vitest/config";

// Load e2e/.env.local (gitignored) for local, non-secret overrides like AWS_REGION
// or DATADOG_CI artifact pins. Secrets (DD_API_KEY/DD_APP_KEY) should come from the
// environment -- e.g. `aws-vault exec <profile> -- yarn test:e2e` with DD keys set.
try {
  for (const line of readFileSync("e2e/.env.local", "utf-8").split("\n")) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)$/);
    if (match && !process.env[match[1]]) {
      let value = match[2];
      if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  }
} catch (e) {
  // No .env.local -- rely on the ambient environment. Surface anything else.
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}

export default defineConfig({
  test: {
    globals: true,
    include: ["e2e/**/*.test.ts"],
    // Cloud lifecycle steps are slow; give tests and setup/teardown generous budgets.
    testTimeout: 600_000,
    hookTimeout: 900_000,
    // The lifecycle is a single ordered stack; never parallelize across files.
    fileParallelism: false,
    reporters: "default",
  },
});
