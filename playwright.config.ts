import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser',
 use:{baseURL:'http://127.0.0.1:1427',channel:'chrome',headless:true},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 1427',url:'http://127.0.0.1:1427',reuseExistingServer:!process.env.CI},
});
