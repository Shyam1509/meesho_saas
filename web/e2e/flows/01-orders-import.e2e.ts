import { expect, test, type Locator, type Page } from '@playwright/test';

import { Api, CSV_MIME } from '../support/api';
import { PASSWORD, newEmail } from '../support/env';
import {
  ERROR_ROW_NUMBER,
  OLDER_ORDERS_DATA_AS_OF,
  OLDER_ORDERS_FILE,
  ORDERS_DATA_AS_OF,
  ORDERS_FILE,
  olderOrdersCsv,
  ordersCsv,
} from '../support/fixtures';
import { openNav, waitForSettled } from '../support/ui';

/** The value (`dd`) next to a term (`dt`) inside a description list. */
function dd(list: Locator, term: string): Locator {
  return list
    .locator('div')
    .filter({ has: list.page().locator('dt', { hasText: term }) })
    .locator('dd');
}

async function heading1(page: Page, name: string | RegExp) {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/**
 * Flow 1 (also the @smoke flow, run on desktop and at 390 × 844): register → seller account →
 * orders CSV upload with "Statuses as of" → preview with an error row → skip + confirm → orders
 * list → order detail with its status history.
 */
test('register, add a seller account, import an orders report with an error row, open an order @smoke', async ({
  page,
  context,
}) => {
  const email = newEmail('flow1');

  await test.step('register', async () => {
    await page.goto('/register');
    await heading1(page, 'Create an account');
    await page.getByLabel(/Your name/).fill('Flow One');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByLabel(/Workspace name/).fill('Flow one workspace');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/overview/);
    await heading1(page, 'Overview');
  });

  await test.step('add a seller account', async () => {
    await openNav(page, 'Seller accounts');
    await heading1(page, 'Seller accounts');
    await waitForSettled(page);
    await page.getByRole('button', { name: 'Add account' }).click();
    await page.getByLabel('Display name').fill('Shop One');
    await page.getByRole('button', { name: 'Save account' }).click();
    await expect(page.getByRole('row', { name: /Shop One/ })).toBeVisible();
  });

  await test.step('upload the orders report and check the preview', async () => {
    await openNav(page, 'Imports');
    await heading1(page, 'Imports');
    await waitForSettled(page);
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: ORDERS_FILE, mimeType: CSV_MIME, buffer: ordersCsv() });
    // The "Statuses as of" day is asked for CSV reports only.
    await page.getByLabel('Statuses as of').fill(ORDERS_DATA_AS_OF);
    await page.getByRole('button', { name: 'Upload and preview' }).click();

    await expect(page.getByRole('heading', { name: `Preview: ${ORDERS_FILE}` })).toBeVisible();
    const counts = page.getByTestId('row-counts');
    await expect(dd(counts, 'Total rows')).toHaveText('7');
    await expect(dd(counts, 'Valid rows')).toHaveText('6');
    await expect(dd(counts, 'Rows with errors')).toHaveText('1');
    const planned = page.getByTestId('planned-counts');
    await expect(dd(planned, 'New records')).toHaveText('6');

    const errors = page.getByRole('table', { name: 'Rows with errors' });
    await expect(errors.locator('tbody tr')).toHaveCount(1);
    const errorRow = errors.locator('tbody tr').first();
    await expect(errorRow.getByRole('rowheader')).toHaveText(String(ERROR_ROW_NUMBER));
    await expect(errorRow).toContainText(/quantity/i);
  });

  await test.step('confirming needs the error rows to be skipped explicitly', async () => {
    await page.getByRole('button', { name: 'Confirm import' }).click();
    const skip = page.getByRole('checkbox', { name: 'Skip the 1 row with errors' });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute('aria-invalid', 'true');
    await skip.check();
    await page.getByRole('button', { name: 'Confirm import' }).click();
    const result = page.getByRole('heading', { name: 'Imported, 1 row skipped' });
    await expect(result).toBeVisible();
    const resultCounts = page.getByTestId('result-counts');
    await expect(dd(resultCounts, 'Inserted')).toHaveText('6');
    await expect(dd(resultCounts, 'Skipped (errors)')).toHaveText('1');
  });

  // An OLDER report (15 Oct, E-1 still SHIPPED) only adds history: arranged through the API.
  await new Api(context).importFile(
    await accountIdFromApi(new Api(context)),
    { name: OLDER_ORDERS_FILE, buffer: olderOrdersCsv(), mimeType: CSV_MIME },
    OLDER_ORDERS_DATA_AS_OF,
  );

  await test.step('the orders list shows the 6 imported orders', async () => {
    await openNav(page, 'Orders');
    await heading1(page, 'Orders');
    await waitForSettled(page);
    const table = page.getByRole('table', { name: 'Orders of Shop One' });
    await expect(table.locator('tbody tr')).toHaveCount(6);
    await expect(table.getByRole('link', { name: 'E-7' })).toHaveCount(0);
  });

  await test.step('the order detail shows the status history, oldest first', async () => {
    await page.getByRole('link', { name: 'E-1', exact: true }).click();
    await heading1(page, 'Order E-1');
    await waitForSettled(page);
    const history = page.getByTestId('status-history').getByRole('listitem');
    await expect(history).toHaveCount(2);
    await expect(history.nth(0)).toContainText('SHIPPED');
    await expect(history.nth(0)).toContainText(OLDER_ORDERS_FILE);
    await expect(history.nth(1)).toContainText('DELIVERED');
    await expect(history.nth(1)).toContainText('(current)');
    await expect(history.nth(1)).toContainText(ORDERS_FILE);
  });
});

async function accountIdFromApi(api: Api): Promise<string> {
  const me = await api.get<{ workspaces: { id: string }[] }>('/auth/me');
  const accounts = await api.get<
    { id: string; displayName: string }[] | { items: { id: string; displayName: string }[] }
  >(`/workspaces/${me.workspaces[0]!.id}/accounts`);
  const list = Array.isArray(accounts) ? accounts : accounts.items;
  return list.find((a) => a.displayName === 'Shop One')!.id;
}
