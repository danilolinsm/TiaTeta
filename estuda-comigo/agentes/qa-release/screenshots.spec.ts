import { test } from '@playwright/test';
import fs from 'fs';

const EMAIL = process.env.QA_TEST_EMAIL;
const SENHA = process.env.QA_TEST_PASSWORD;

test.beforeAll(() => {
  if (!EMAIL || !SENHA) {
    throw new Error('QA_TEST_EMAIL e QA_TEST_PASSWORD precisam estar definidos — veja .env.example');
  }
  fs.mkdirSync('screenshots', { recursive: true });
});

test('captura as telas principais do app logado', async ({ page }, testInfo) => {
  const shot = async (nome: string) => {
    await page.screenshot({
      path: `screenshots/${testInfo.project.name}-${nome}.png`,
      fullPage: true,
    });
  };

  await page.goto('/');

  await page.locator('#auth-email').waitFor({ state: 'visible' });
  await shot('auth');
  await page.locator('#auth-email').fill(EMAIL!);
  await page.locator('#auth-password').fill(SENHA!);
  await page.locator('#auth-submit').click();

  const btnParent = page.locator('[data-role="parent"]');
  if (await btnParent.isVisible({ timeout: 5000 }).catch(() => false)) {
    await shot('escolha-papel');
    await btnParent.click();
  }

  await page.locator('[data-tab="filhos"]').waitFor({ state: 'visible', timeout: 10000 });
  await shot('filhos');

  await page.locator('[data-tab="estudar"]').click();
  await page.locator('#hub-new-roteiro').waitFor({ state: 'visible', timeout: 10000 });
  await shot('estudar-hub');

  await page.locator('#hub-new-roteiro').click();
  await page.locator('#subject-input').waitFor({ state: 'visible' });
  await shot('novo-roteiro-form');
  await page.locator('#back-to-hub').click();

  await page.locator('[data-tab="historico"]').click();
  await page.locator('[data-tab="historico"].active').waitFor({ state: 'visible', timeout: 10000 });
  await shot('historico');
});