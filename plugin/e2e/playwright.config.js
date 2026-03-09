const path = require("path");
const { defineConfig } = require("@playwright/test");

const repoRoot = path.resolve(__dirname, "..", "..");

module.exports = defineConfig({
  testDir: path.join(__dirname, "tests"),
  timeout: 180_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  webServer: {
    command:
      "PYTHONPATH=server uv run gunicorn --chdir server main:app --bind 127.0.0.1:8000",
    cwd: repoRoot,
    port: 8000,
    timeout: 120_000,
    reuseExistingServer: true,
    stdout: "pipe",
    stderr: "pipe",
  },
});
