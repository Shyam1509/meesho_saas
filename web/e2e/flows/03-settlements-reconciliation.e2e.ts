import { expect, test, type Locator } from '@playwright/test';

import { XLSX_MIME } from '../support/api';
import { WORKBOOK_FILE, settlementWorkbook } from '../support/fixtures';
import { seedShop } from '../support/seed';
import { openNav, waitForSettled } from '../support/ui';

function dd(list: Locator, term: string): Locator {
  return list
    .locator('div')
    .filter({ has: list.page().locator('dt', { hasText: term }) })
    .locator('dd')
    .first();
}

/**
 * Flow 3: settlement workbook import (UI) → reconciliation overview → the owner matches the
 * unmatched entry (T8, sub order X-9) to order E-5 by hand → unmatches it again.
 *
 * After the import: matched T1 T2 T3 T4 T5 = 400 + 250 + 400 − 420 + 260 = ₹890.00; unmatched T8
 * ₹99.00; account-level CMP-1 −₹150.00; 6 orders, 4 with a settlement (E-1 E-2 E-3 E-6), 2 without
 * (E-4 E-5).
 */
test('settlement workbook import, reconciliation, manual match and unmatch', async ({
  page,
  context,
}) => {
  await seedShop(context, 'flow3', { workbook: false });

  await test.step('upload and confirm the settlement workbook', async () => {
    await page.goto('/imports');
    await waitForSettled(page);
    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: WORKBOOK_FILE,
        mimeType: XLSX_MIME,
        buffer: await settlementWorkbook(),
      });
    // No "Statuses as of" for a workbook.
    await expect(page.getByLabel('Statuses as of')).toHaveCount(0);
    await page.getByRole('button', { name: 'Upload and preview' }).click();
    await expect(page.getByRole('heading', { name: `Preview: ${WORKBOOK_FILE}` })).toBeVisible();
    const counts = page.getByTestId('row-counts');
    await expect(dd(counts, 'Total rows')).toHaveText('7');
    await expect(dd(counts, 'Rows with errors')).toHaveText('0');
    await page.getByRole('button', { name: 'Confirm import' }).click();
    await expect(page.getByRole('heading', { name: 'Import completed' })).toBeVisible();
  });

  const overview = page.getByTestId('overview');
  await test.step('the reconciliation overview counts the matches', async () => {
    await openNav(page, 'Settlements & reconciliation');
    await page.getByRole('tab', { name: 'Reconciliation' }).click();
    await waitForSettled(page);
    const cards = overview.getByTestId('settlement-cards');
    await expect(dd(cards, 'All entries')).toHaveText('7');
    await expect(dd(cards, 'Matched to an order')).toHaveText('5');
    await expect(cards).toContainText('₹890.00');
    await expect(dd(cards, 'Unmatched (need a look)')).toHaveText('1');
    await expect(cards).toContainText('₹99.00');
    await expect(cards).toContainText('-₹150.00');
    const orders = overview.getByTestId('order-cards');
    await expect(dd(orders, 'All orders')).toHaveText('6');
    await expect(dd(orders, 'With a matched settlement')).toHaveText('4');
    await expect(dd(orders, 'Without a matched settlement')).toHaveText('2');
  });

  await test.step('match the unmatched entry to E-5 by hand', async () => {
    const unmatched = page.getByTestId('unmatched');
    await expect(unmatched.locator('tbody tr')).toHaveCount(1);
    await expect(unmatched.locator('tbody tr').first()).toContainText('X-9');
    await unmatched.getByRole('button', { name: /Match to order/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Match settlement entry to an order' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Find the order').fill('E-5');
    await dialog.getByRole('button', { name: 'Search' }).click();
    await dialog.getByRole('radio', { name: /E-5/ }).check();
    await dialog.getByRole('button', { name: 'Match to E-5' }).click();
    await expect(dialog).toBeHidden();
    await waitForSettled(page);
    await expect(page.getByTestId('no-unmatched')).toBeVisible();
    await expect(dd(overview.getByTestId('settlement-cards'), 'Matched to an order')).toHaveText(
      '6',
    );
    await expect(
      dd(overview.getByTestId('order-cards'), 'Without a matched settlement'),
    ).toHaveText('1');
  });

  await test.step('unmatch it from the entries list', async () => {
    await page.getByRole('tab', { name: 'Entries' }).click();
    await waitForSettled(page);
    const row = page.getByTestId('entries-table').locator('tbody tr').filter({ hasText: 'T8' });
    await expect(row.locator('[data-column="match"]')).toContainText(/Matched/);
    await expect(row.locator('[data-column="match"]')).toContainText('Order E-5');
    await row.getByRole('button', { name: /Unmatch/ }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Unmatch this settlement entry?' });
    await confirm.getByRole('button', { name: 'Unmatch' }).click();
    await expect(confirm).toBeHidden();
    await waitForSettled(page);
    await expect(row.locator('[data-column="match"]')).toContainText(
      'Unmatched by hand: automatic matching skips it.',
    );
    await page.getByRole('tab', { name: 'Reconciliation' }).click();
    await waitForSettled(page);
    await expect(
      dd(overview.getByTestId('settlement-cards'), 'Unmatched (need a look)'),
    ).toHaveText('1');
  });
});
