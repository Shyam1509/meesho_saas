import { expect, test } from '@playwright/test';

import { Api } from '../support/api';
import { waitForSettled } from '../support/ui';

/**
 * Flow 4: expenses — the add dialog validates (and focuses the first invalid field), an account
 * expense and a workspace-wide expense are added, and the totals add up:
 *   account:   1250.50 (Other, "Courier bags") + 249.50 (Packaging) = ₹1,500.00 (2 expenses)
 *   workspace: 300.00 (Rent & utilities) = ₹300.00; with the account's = ₹1,800.00 (3 expenses)
 */
test('add account and workspace-wide expenses with validation; totals add up', async ({
  page,
  context,
}) => {
  const api = new Api(context);
  const owner = await api.register('flow4');
  await api.createAccount(owner.workspaceId, 'Shop One');

  await page.goto('/expenses');
  await expect(page.getByRole('heading', { level: 1, name: 'Expenses' })).toBeVisible();
  await waitForSettled(page);
  await expect(page.getByTestId('no-expenses')).toBeVisible();

  await test.step('an empty form shows every error and focuses the first invalid field', async () => {
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /expense/i });
    await expect(dialog).toBeVisible();
    // The date may be pre-filled (today): clear it so every field is empty.
    await dialog.getByLabel('Date').fill('');
    await dialog.getByRole('button', { name: 'Add expense' }).click();
    const date = dialog.getByLabel('Date');
    await expect(date).toBeFocused();
    await expect(date).toHaveAttribute('aria-invalid', 'true');
    await expect(date).toHaveAccessibleDescription(/Enter the date of the expense/);
    await expect(dialog.getByLabel('Category')).toHaveAccessibleDescription(/Choose a category/);
    await expect(dialog.getByLabel('Amount (₹)')).toHaveAccessibleDescription(/Enter the amount/);
  });

  await test.step('"Other" needs a description; the amount must be a plain number', async () => {
    const dialog = page.getByRole('dialog', { name: /expense/i });
    await dialog.getByLabel('Date').fill('2026-10-05');
    await dialog.getByLabel('Category').selectOption({ label: 'Other (description required)' });
    await dialog.getByLabel('Amount (₹)').fill('12,50');
    await dialog.getByRole('button', { name: 'Add expense' }).click();
    const description = dialog.getByLabel(/Description/);
    await expect(description).toBeFocused();
    await expect(description).toHaveAccessibleDescription(/needs a description/);
    await expect(dialog.getByLabel('Amount (₹)')).toHaveAccessibleDescription(/up to 2 decimals/);
    await description.fill('Courier bags');
    await dialog.getByLabel('Amount (₹)').fill('1250.50');
    await dialog.getByRole('button', { name: 'Add expense' }).click();
    await expect(dialog).toBeHidden();
  });

  const total = page.getByTestId('expenses-total');
  await test.step('a second account expense; the total covers both', async () => {
    await waitForSettled(page);
    await expect(total).toContainText('₹1,250.50');
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /expense/i });
    await dialog.getByLabel('Date').fill('2026-10-06');
    await dialog.getByLabel('Category').selectOption({ label: 'Packaging & labels' });
    await dialog.getByLabel('Amount (₹)').fill('249.50');
    await dialog.getByRole('button', { name: 'Add expense' }).click();
    await expect(dialog).toBeHidden();
    await waitForSettled(page);
    await expect(page.getByTestId('expenses-table').locator('tbody tr')).toHaveCount(2);
    await expect(total).toContainText('Total of 2 expenses');
    await expect(total).toContainText('₹1,500.00');
  });

  await test.step('a workspace-wide expense, alone and with the account expenses', async () => {
    await page.getByLabel('The whole workspace').check();
    await waitForSettled(page);
    await page.getByRole('button', { name: 'Add workspace-wide expense' }).click();
    const dialog = page.getByRole('dialog', { name: /expense/i });
    await dialog.getByLabel('Date').fill('2026-10-10');
    await dialog.getByLabel('Category').selectOption({ label: 'Rent & utilities' });
    await dialog.getByLabel('Amount (₹)').fill('300');
    await dialog.getByRole('button', { name: 'Add expense' }).click();
    await expect(dialog).toBeHidden();
    await waitForSettled(page);
    await expect(total).toContainText('Total of 1 expense');
    await expect(total).toContainText('₹300.00');
    await page.getByLabel('Include seller-account expenses').check();
    await waitForSettled(page);
    await expect(total).toContainText('Total of 3 expenses');
    await expect(total).toContainText('₹1,800.00');
  });
});
