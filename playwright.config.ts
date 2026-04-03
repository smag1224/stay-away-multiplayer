import { defineConfig } from '@playwright/test';

const PORT = 8788;
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,       // full games can take 2-3 min with many bots
  expect: { timeout: 10_000 },
  workers: 1,             // run sequentially — server is shared
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE,
    headless: true,
  },

  webServer: {
    // Build frontend then start the full server (API + static files)
    command: `npm run build && npx cross-env PORT=${PORT} FAST_BOT=1 node --experimental-strip-types server/server.ts`,
    url: BASE,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
