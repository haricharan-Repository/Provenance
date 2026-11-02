import { defineConfig } from '@playwright/test';

// Used by `playwright merge-reports` after the shards finish.
// REPORT_NAME separates the blocking lane from the quarantine lane.
const name = process.env.REPORT_NAME ?? 'results';

export default defineConfig({
  testDir: './tests',
  reporter: [
    ['json', { outputFile: `reports/${name}.json` }],
    ['junit', { outputFile: `reports/${name}.xml` }],
    ['html', { open: 'never', outputFolder: `playwright-report/${name}` }],
  ],
});
