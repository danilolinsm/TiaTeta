// Config mínima para a captura de screenshots do preflight.sh.
// Ajuste "baseURL" e as rotas em "telas" para o app real no dia 1.
// Documentação: https://playwright.dev/docs/test-configuration

import { defineConfig, devices } from '@playwright/test';

const telas = [
  { nome: 'home', rota: '/' },
  { nome: 'lista-questoes', rota: '/questoes/matematica' },
  { nome: 'onboarding', rota: '/onboarding' },
];

export default defineConfig({
  testDir: './agentes/qa-release',
  timeout: 30_000,
  use: {
    baseURL: process.env.QA_BASE_URL || 'http://localhost:5173',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
  ],
});

// telas exportado para o teste de captura consumir — ver
// agentes/qa-release/screenshots.spec.ts (crie no dia 1 junto do app real)
export { telas };
