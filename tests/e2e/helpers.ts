import { execFileSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config';

const env = { ...process.env, DATABASE_PATH: E2E.dbPath, APP_URL: E2E.appUrl, NODE_ENV: 'development' };

/** Uses the real invitation script, exactly as an operator would. */
export function invite(email: string) {
  return execFileSync('npx', ['tsx', 'server/scripts/invite.ts', email], { env, encoding: 'utf8' });
}

export async function requestLink(page: Page, email: string) {
  await page.goto('/signin');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
}

/** Newest sign-in link for this email from the dev outbox. */
export async function linkFromOutbox(page: Page, email: string): Promise<string> {
  const response = await page.request.get('/api/dev/outbox');
  const { messages } = (await response.json()) as { messages: { to: string; link: string }[] };
  const message = messages.find((m) => m.to === email);
  expect(message, `sign-in email for ${email}`).toBeTruthy();
  return message!.link;
}

export async function signIn(page: Page, email: string) {
  invite(email);
  await requestLink(page, email);
  await page.goto(await linkFromOutbox(page, email));
  await page.getByRole('button', { name: 'Continue to Flico' }).click();
  await expect(page.getByRole('heading', { name: 'A better way to work.' })).toBeVisible();
}

/** Unique address per test so every test starts with an empty dashboard. */
export const uniqueEmail = (prefix: string) => `${prefix}.${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
