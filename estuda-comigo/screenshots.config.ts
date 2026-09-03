import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './agentes/qa-release',
  timeout: 30_000,
  use: {
    baseURL: process.env.QA_BASE_URL || 'http://localhost:3000',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
  ],
});