import { expect, test } from '@playwright/test';

import { seedShop } from '../support/seed';
import { openNav, waitForSettled } from '../support/ui';

/**
 * Flow 2: products are created from the imported orders → an owner adds a unit cost → the order
 * shows its product cost (unit cost on the order date × quantity); orders of products without a cost
 * keep "Unknown cost" (never ₹0).
 */
test('products come from the orders; a unit cost gives the order its product cost', async ({
  page,
  context,
}) => {
  await seedShop(context, 'flow2', { workbook: false });

  await test.step('the orders import created one product per SKU, none with a cost', async () => {
    await page.goto('/products');
    await expect(page.getByRole('heading', { level: 1, name: 'Products & costs' })).toBeVisible();
    await waitForSettled(page);
    const table = page.getByRole('table', { name: 'Products of Shop One' });
    await expect(table.locator('tbody tr')).toHaveCount(3);
    for (const sku of ['SKU-A', 'SKU-B', 'SKU-C']) {
      const row = table.getByRole('row', { name: new RegExp(sku) });
      await expect(row.getByTestId('product-current-cost')).toContainText('Unknown');
      await expect(row.getByTestId('product-current-cost')).toContainText('No cost entered');
    }
    // SKU-A has E-1 and E-3 (E-7 was an error row, never imported).
    await expect(
      table.getByRole('row', { name: /SKU-A/ }).getByTestId('product-orders-without-cost'),
    ).toHaveText('2');
  });

  await test.step('add a unit cost to SKU-A', async () => {
    await page.getByRole('link', { name: 'SKU-A', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Product SKU-A' })).toBeVisible();
    await waitForSettled(page);
    await expect(page.getByTestId('no-costs')).toBeVisible();
    await page.getByRole('button', { name: 'Add cost' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add unit cost for SKU-A' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Effective from').fill('2026-09-01');
    await dialog.getByLabel('Unit cost (₹)').fill('100');
    await dialog.getByRole('button', { name: 'Save cost' }).click();
    await expect(dialog).toBeHidden();
    const history = page.getByTestId('cost-history');
    await expect(history.locator('tbody tr')).toHaveCount(1);
    await expect(history.locator('tbody tr').first()).toContainText('₹100.00');
    await expect(history.locator('tbody tr').first()).toContainText('Current');
    await expect(page.getByTestId('product-current-cost')).toContainText('₹100.00');
    await expect(page.getByTestId('product-orders-without-cost')).toContainText('0');
  });

  await test.step('the orders list shows the known cost and keeps the unknown ones', async () => {
    await openNav(page, 'Orders');
    await waitForSettled(page);
    const table = page.getByRole('table', { name: 'Orders of Shop One' });
    const cost = (sub: string) =>
      table
        .locator('tbody tr')
        .filter({ has: page.getByRole('link', { name: sub, exact: true }) })
        .getByTestId('order-product-cost');
    // E-1: 2 × ₹100.00 (cost from 1 Sep, order 1 Oct).
    await expect(cost('E-1')).toContainText('₹200.00');
    await expect(cost('E-1')).toContainText('2 × ₹100.00');
    // E-3: 1 × ₹100.00.
    await expect(cost('E-3')).toContainText('₹100.00');
    // SKU-B and SKU-C have no cost: unknown, never ₹0.
    for (const sub of ['E-2', 'E-4', 'E-5', 'E-6']) {
      await expect(cost(sub)).toContainText('Unknown cost');
      await expect(cost(sub)).not.toContainText('₹0.00');
    }
  });

  await test.step('the order detail shows the same product cost', async () => {
    await page.getByRole('link', { name: 'E-1', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Order E-1' })).toBeVisible();
    await waitForSettled(page);
    const cost = page.getByTestId('order-fields').getByTestId('order-product-cost');
    await expect(cost).toContainText('₹200.00');
    await expect(cost.getByRole('link', { name: 'View product and unit costs' })).toBeVisible();
  });
});
