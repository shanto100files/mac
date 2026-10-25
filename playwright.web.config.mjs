import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/web-production',
  use: {baseURL: 'http://127.0.0.1:5180', channel: 'chrome', headless: true},
  webServer: {
    command: 'npm run preview:web -- --host 127.0.0.1 --port 5180 --strictPort',
    url: 'http://127.0.0.1:5180', reuseExistingServer: false,
  },
});
