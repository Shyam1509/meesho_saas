import { expect, test } from '@playwright/test';

import { Api } from '../support/api';
import { addWorkspaceMember } from '../support/db';
import { seedShop } from '../support/seed';
import { signInWithForm, waitForSettled } from '../support/ui';

/**
 * Flow 6: a plain member (added straight into meesho_test: there is no invitation flow yet) signs in,
 * switches to the owner's workspace and sees everything read-only: no owner action is offered.
 */
test('a member sees the workspace read-only', async ({ page, browser }) => {
  // The owner and the data, in a context of their own.
  const ownerContext = await browser.newContext();
  const seeded = await seedShop(ownerContext, 'flow6-owner', {
    costs: true,
    expenses: true,
    workspaceName: 'Owner workspace',
  });
  const productId = await new Api(ownerContext).productId(seeded.accountId, 'SKU-A');
  await ownerContext.close();

  // The member registers (getting a workspace of their own) and is added to the owner's.
  const memberContext = await browser.newContext();
  const member = await new Api(memberContext).register('flow6-member', 'Member own workspace');
  await memberContext.close();
  await addWorkspaceMember(seeded.workspaceId, member.email);

  await test.step('sign in and switch to the owner workspace', async () => {
    await page.goto('/login');
    await signInWithForm(page, member.email);
    await expect(page).toHaveURL(/\/overview/);
    const switcher = page.getByLabel('Workspace', { exact: true });
    await switcher.selectOption({ label: 'Owner workspace' });
    await expect(page.getByText(/Your role:\s*Member/)).toHaveCount(1);
  });

  await test.step('seller accounts: no add / edit / disable', async () => {
    await page.goto('/seller-accounts');
    await waitForSettled(page);
    await expect(page.getByRole('row', { name: /Shop One/ })).toBeVisible();
    await expect(page.getByText(/Only owners can add, edit, disable or re-enable/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add account' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Disable/ })).toHaveCount(0);
  });

  await test.step('expenses: listed, but no add / edit / delete', async () => {
    await page.goto('/expenses');
    await waitForSettled(page);
    await expect(page.getByTestId('member-note')).toBeVisible();
    await expect(page.getByTestId('expenses-table').locator('tbody tr')).toHaveCount(3);
    await expect(page.getByRole('button', { name: /^Add/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
  });

  await test.step('product: costs listed, but no add / delete', async () => {
    await page.goto(`/products/${productId}`);
    await waitForSettled(page);
    await expect(page.getByTestId('cost-history').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('member-note')).toContainText(
      'Only owners can add or delete unit costs',
    );
    await expect(page.getByRole('button', { name: 'Add cost' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
  });

  await test.step('settlements: no manual match / unmatch', async () => {
    await page.goto('/settlements?tab=reconciliation');
    await waitForSettled(page);
    await expect(page.getByTestId('unmatched').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Match to order/ })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Entries' }).click();
    await waitForSettled(page);
    await expect(page.getByTestId('entries-table').locator('tbody tr')).toHaveCount(7);
    await expect(page.getByRole('button', { name: /^Unmatch/ })).toHaveCount(0);
  });

  await test.step('workspace settings: no rename', async () => {
    await page.goto('/settings');
    await waitForSettled(page);
    await expect(page.getByText('Only owners can rename this workspace.')).toBeVisible();
    await expect(page.getByLabel('Rename workspace')).toHaveCount(0);
  });
});
