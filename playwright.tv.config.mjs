import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/tv-browser',workers:1,timeout:45_000,use:{headless:true,viewport:{width:1920,height:1080},trace:'retain-on-failure',screenshot:'only-on-failure'},reporter:'list'});
