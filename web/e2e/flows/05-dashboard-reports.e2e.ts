import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { DOWNLOADS_DIR } from '../support/env';
import { DASHBOARD_OCTOBER as D } from '../support/fixtures';
import { seedShop } from '../support/seed';
import { kpi, openNav, waitForSettled } from '../support/ui';

/** Minimal RFC 4180 reader (CRLF rows, quoted fields with doubled quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
    } else {
      field += c;
    }
  }
  return rows;
}

const ORDERS_CSV_HEADER = [
  'Order ID',
  'Sub Order No',
  'Order No',
  'Order Date',
  'Product Name',
  'SKU',
  'Size',
  'Quantity',
  'Customer State',
  'Supplier Listed Price (as reported)',
  'Supplier Discounted Price (as reported)',
  'Current Status',
  'Status Observed At (UTC)',
  'Settlement Match',
  'Settlement Entries',
  'Settlement Amount (as reported)',
  'First Payment Date',
  'Product ID',
  'Product Cost State',
  'Unit Cost',
  'Cost Effective From',
  'Product Cost Total',
  'Source Import ID',
  'Source Import File',
];

/** Applies a custom October range through the filter bar. */
async function chooseOctober(page: Page): Promise<void> {
  await page.getByLabel('Date range').selectOption({ label: 'Custom range' });
  await page.getByLabel('Custom dates from').fill(D.from);
  await page.getByLabel('Custom dates to').fill(D.to);
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await waitForSettled(page);
}

async function chooseBasis(page: Page, label: 'By order date' | 'By payment date'): Promise<void> {
  await page.getByLabel(label).check();
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await waitForSettled(page);
}

/**
 * Flow 5: the dashboard shows the hand-calculated October numbers (support/fixtures.ts,
 * DASHBOARD_OCTOBER) for the whole workspace and for the seller account, by order date and by
 * payment date → a drill-down link opens the matching orders → the orders CSV for the same range
 * holds exactly those orders.
 */
test('dashboard numbers in both bases, a drill-down link and the orders CSV', async ({
  page,
  context,
}) => {
  await seedShop(context, 'flow5', { costs: true, expenses: true });

  await page.goto('/overview');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await waitForSettled(page);
  await chooseOctober(page);

  await test.step('whole workspace, by order date', async () => {
    const a = D.account.order_date;
    await expect(kpi(page, 'kpi-orders')).toContainText(a.orders);
    await expect(page.getByTestId('kpi-units')).toHaveText(a.units);
    await expect(kpi(page, 'kpi-order-value')).toContainText(a.orderValue);
    await expect(page.getByTestId('kpi-listed')).toContainText(a.listed);
    await expect(page.getByTestId('kpi-prices-missing')).toContainText(
      '1 order without a reported price',
    );
    await expect(kpi(page, 'kpi-settlement')).toContainText(a.settlement);
    await expect(kpi(page, 'kpi-product-cost')).toContainText(a.productCost);
    await expect(kpi(page, 'kpi-expenses')).toContainText(D.workspace.order_date.expenses);
    await expect(page.getByTestId('kpi-expenses-split')).toContainText('₹1,100.00');
    await expect(page.getByTestId('kpi-expenses-split')).toContainText('₹300.00');
    await expect(kpi(page, 'kpi-contribution')).toContainText(D.workspace.order_date.contribution);
    await expect(page.getByTestId('kpi-contribution')).toHaveAttribute('data-complete', 'false');
    const comparison = page.getByTestId('comparison-table');
    await expect(comparison.getByRole('row', { name: /Shop One/ })).toContainText(a.contribution);
  });

  await test.step('whole workspace, by payment date', async () => {
    await chooseBasis(page, 'By payment date');
    const a = D.account.payment_date;
    await expect(kpi(page, 'kpi-orders')).toContainText(a.orders);
    await expect(kpi(page, 'kpi-settlement')).toContainText(a.settlement);
    await expect(kpi(page, 'kpi-product-cost')).toContainText(a.productCost);
    await expect(kpi(page, 'kpi-expenses')).toContainText(D.workspace.payment_date.expenses);
    await expect(kpi(page, 'kpi-contribution')).toContainText(
      D.workspace.payment_date.contribution,
    );
  });

  await test.step('one seller account, by payment date', async () => {
    await page.getByLabel('One seller account').check();
    await waitForSettled(page);
    const a = D.account.payment_date;
    await expect(kpi(page, 'kpi-orders')).toContainText(a.orders);
    await expect(page.getByTestId('kpi-units')).toHaveText(a.units);
    await expect(kpi(page, 'kpi-order-value')).toContainText(a.orderValue);
    await expect(page.getByTestId('kpi-listed')).toContainText(a.listed);
    await expect(page.getByTestId('kpi-prices-missing')).toHaveCount(0);
    await expect(kpi(page, 'kpi-settlement')).toContainText(a.settlement);
    await expect(page.getByTestId('kpi-settlement')).toContainText(a.settlementEntries);
    await expect(kpi(page, 'kpi-product-cost')).toContainText(a.productCost);
    await expect(kpi(page, 'kpi-expenses')).toContainText(a.expenses);
    await expect(kpi(page, 'kpi-contribution')).toContainText(a.contribution);
    const incomplete = page.getByTestId('incomplete');
    await expect(incomplete.locator('[data-flag="costUnknown"]')).toContainText(
      '1 order without a known product cost',
    );
    await expect(incomplete.locator('[data-flag="unmatchedSettlements"]')).toContainText(
      '1 settlement entry',
    );
    await expect(incomplete.locator('[data-flag="ordersWithoutSettlement"]')).toHaveCount(0);
    await expect(incomplete.locator('[data-flag="cancelledOrReturned"]')).toContainText('₹100.00');
  });

  await test.step('one seller account, by order date', async () => {
    await chooseBasis(page, 'By order date');
    const a = D.account.order_date;
    await expect(kpi(page, 'kpi-orders')).toContainText(a.orders);
    await expect(page.getByTestId('kpi-units')).toHaveText(a.units);
    await expect(kpi(page, 'kpi-order-value')).toContainText(a.orderValue);
    await expect(page.getByTestId('kpi-listed')).toContainText(a.listed);
    await expect(kpi(page, 'kpi-settlement')).toContainText(a.settlement);
    await expect(page.getByTestId('kpi-settlement')).toContainText(a.settlementEntries);
    await expect(kpi(page, 'kpi-product-cost')).toContainText(a.productCost);
    await expect(page.getByTestId('kpi-without-cost')).toContainText('1 order without a cost');
    await expect(kpi(page, 'kpi-expenses')).toContainText(a.expenses);
    await expect(kpi(page, 'kpi-contribution')).toContainText(a.contribution);
    const incomplete = page.getByTestId('incomplete');
    await expect(incomplete.locator('[data-flag="ordersWithoutSettlement"]')).toContainText(
      '2 orders',
    );
    await expect(incomplete.locator('[data-flag="pricesMissing"]')).toContainText('1 order');
    const statuses = page.getByTestId('status-table');
    await expect(statuses.locator('[data-status="DELIVERED"]')).toContainText('3');
    await expect(statuses.locator('[data-status="RTO"]')).toContainText('1');
    await expect(statuses.locator('[data-status="SHIPPED"]')).toContainText('1');
  });

  await test.step('the Orders number opens the same 5 orders', async () => {
    await kpi(page, 'kpi-orders').getByRole('link').click();
    await expect(page).toHaveURL(/\/orders\?/);
    await expect(page).toHaveURL(/from=2026-10-01/);
    await expect(page).toHaveURL(/to=2026-10-31/);
    await waitForSettled(page);
    const table = page.getByRole('table', { name: 'Orders of Shop One' });
    await expect(table.locator('tbody tr')).toHaveCount(5);
    for (const sub of ['E-1', 'E-2', 'E-3', 'E-4', 'E-5']) {
      await expect(table.getByRole('link', { name: sub, exact: true })).toBeVisible();
    }
  });

  await test.step('the orders CSV for October holds exactly those orders', async () => {
    await openNav(page, 'Reports');
    await waitForSettled(page);
    const card = page.getByTestId('export-orders');
    await card.getByLabel('Order date from').fill(D.from);
    await card.getByLabel('Order date to').fill(D.to);
    const downloadPromise = page.waitForEvent('download');
    await card.getByRole('button', { name: 'Download CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/orders-2026-10-01_2026-10-31\.csv$/);
    const file = path.join(DOWNLOADS_DIR, `flow5-${download.suggestedFilename()}`);
    await download.saveAs(file);
    const bytes = readFileSync(file);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = parseCsv(bytes.toString('utf8').slice(1));
    expect(rows[0]).toEqual(ORDERS_CSV_HEADER);
    const col = (name: string) => ORDERS_CSV_HEADER.indexOf(name);
    const data = rows.slice(1).map((r) => ({
      sub: r[col('Sub Order No')],
      date: r[col('Order Date')],
      qty: r[col('Quantity')],
      disc: r[col('Supplier Discounted Price (as reported)')],
      status: r[col('Current Status')],
      match: r[col('Settlement Match')],
      settled: r[col('Settlement Amount (as reported)')],
      costState: r[col('Product Cost State')],
      cost: r[col('Product Cost Total')],
    }));
    // Default order: newest order date first. Hand-calculated (see support/fixtures.ts).
    expect(data).toEqual([
      {
        sub: 'E-5',
        date: '2026-10-20',
        qty: '1',
        disc: '280.00',
        status: 'DELIVERED',
        match: 'unmatched',
        settled: '',
        costState: 'known',
        cost: '150.0000',
      },
      {
        sub: 'E-4',
        date: '2026-10-10',
        qty: '3',
        disc: '',
        status: 'SHIPPED',
        match: 'unmatched',
        settled: '',
        costState: 'unknown',
        cost: '',
      },
      {
        sub: 'E-3',
        date: '2026-10-05',
        qty: '1',
        disc: '450.00',
        status: 'RTO',
        match: 'matched',
        settled: '-20.00',
        costState: 'known',
        cost: '100.0000',
      },
      {
        sub: 'E-2',
        date: '2026-10-03',
        qty: '1',
        disc: '280.00',
        status: 'DELIVERED',
        match: 'matched',
        settled: '250.00',
        costState: 'known',
        cost: '150.0000',
      },
      {
        sub: 'E-1',
        date: '2026-10-01',
        qty: '2',
        disc: '450.00',
        status: 'DELIVERED',
        match: 'matched',
        settled: '400.00',
        costState: 'known',
        cost: '200.0000',
      },
    ]);
    await expect(card.getByTestId('download-status')).toContainText('Downloaded');
  });
});
