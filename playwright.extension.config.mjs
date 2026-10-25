import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests/extension', workers: 1, timeout: 90_000,
  webServer: {command: 'npm run dev:web -- --host 127.0.0.1 --port 1427', url: 'http://127.0.0.1:1427', reuseExistingServer: false},
});
