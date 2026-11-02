import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

if (existsSync('.env')) process.loadEnvFile('.env');

const CI = !!process.env.CI;
// Set by `tl falsify`: mutants exist on disk and must fail fast.
const MUTATING = !!process.env.TRUTHLINE_MUTATING;
const FAST_FAIL = MUTATING || !!process.env.TRUTHLINE_FAST_FAIL;

const shard = process.env.TRUTHLINE_SHARD ?? '0';
const demoPort = Number(process.env.DEMO_PORT ?? 4173);
const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${demoPort}`;
const storageState = `playwright/.auth/user-${shard}.json`;

// @flaky tests only run in the quarantine lane.
const grepInvert = process.env.TRUTHLINE_QUARANTINE ? undefined : /@flaky/;
const testIgnore = MUTATING ? [] : ['**/*.mutant-*.spec.ts'];

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: CI && !MUTATING,
  retries: 0, // A retry would hide flakiness that Stage 6 exists to expose.
  timeout: FAST_FAIL ? 20_000 : 30_000,
  expect: { timeout: FAST_FAIL ? 1_500 : 5_000 },
  reporter: CI
    ? [['blob'], ['line']]
    : [
        ['list'],
        ['json', { outputFile: 'reports/results.json' }],
        ['junit', { outputFile: 'reports/junit.xml' }],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
      ],
  use: {
    baseURL,
    actionTimeout: FAST_FAIL ? 3_000 : 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npx tsx demo-app/server.ts',
        url: `${baseURL}/health`,
        reuseExistingServer: !CI,
        env: { DEMO_PORT: String(demoPort) },
      },
  projects: [
    { name: 'setup', testMatch: 'auth.setup.ts' },
    {
      name: 'api',
      testMatch: 'api/**/*.spec.ts',
      testIgnore,
      grepInvert,
      dependencies: ['setup'],
      use: { storageState },
    },
    {
      name: 'chromium',
      testMatch: 'e2e/**/*.spec.ts',
      testIgnore,
      grepInvert,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState },
    },
    // Cross-browser depth is reserved for high-risk requirements (Stage 2).
    {
      name: 'firefox',
      testMatch: 'e2e/**/*.spec.ts',
      testIgnore,
      grep: /@risk-high/,
      grepInvert,
      dependencies: ['setup'],
      use: { ...devices['Desktop Firefox'], storageState },
    },
    {
      name: 'webkit',
      testMatch: 'e2e/**/*.spec.ts',
      testIgnore,
      grep: /@risk-high/,
      grepInvert,
      dependencies: ['setup'],
      use: { ...devices['Desktop Safari'], storageState },
    },
  ],
});
