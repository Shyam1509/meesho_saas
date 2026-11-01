import { expect, test, type Page } from '@playwright/test';

import { endSessionsOf } from '../support/db';
import { seedShop } from '../support/seed';
import { signInWithForm, waitForSettled } from '../support/ui';

/**
 * Flow 7: the session ends mid-use (its row is deleted server-side, as an idle timeout or a revoke
 * would) → the next request is a 401 → the sign-in page → after signing in, back on the same URL.
 */
async function expireMidFlow(page: Page, email: string): Promise<void> {
  await page.goto('/orders');
  await waitForSettled(page);
  await page.getByLabel('Search').fill('E-1');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await waitForSettled(page);
  await expect(page).toHaveURL(/q=E-1/);
  expect(await endSessionsOf(email)).toBeGreaterThan(0);
  // Any request now gets a 401: sort the list.
  await page.getByRole('button', { name: /Sub order no\./ }).click();
  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
}

test('session expiry mid-flow: sign in again and land back on the same page', async ({
  page,
  context,
}) => {
  const seeded = await seedShop(context, 'flow7', { workbook: false });
  await expireMidFlow(page, seeded.email);
  const returnUrl = new URL(page.url()).searchParams.get('returnUrl') ?? '';
  expect(returnUrl).toMatch(/^\/orders\?/);
  expect(returnUrl).toContain('q=E-1');

  await signInWithForm(page, seeded.email);
  await expect(page).toHaveURL(/\/orders\?/);
  await expect(page).toHaveURL(/q=E-1/);
  await waitForSettled(page);
  await expect(
    page.getByRole('table', { name: 'Orders of Shop One' }).locator('tbody tr'),
  ).toHaveCount(1);
});

test('session expiry mid-flow: the sign-in page says the session ended', async ({
  page,
  context,
}) => {
  const seeded = await seedShop(context, 'flow7b', { workbook: false });
  await expireMidFlow(page, seeded.email);
  await expect(page.getByText(/session (has )?(ended|expired)/i)).toBeVisible();
});
