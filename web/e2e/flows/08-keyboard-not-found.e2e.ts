import { expect, test, type Page } from '@playwright/test';

import { Api } from '../support/api';
import { PASSWORD } from '../support/env';
import { waitForSettled } from '../support/ui';

/** Presses Tab until `matches` holds for the focused element (at most `max` presses). */
async function tabTo(
  page: Page,
  matches: (el: Element) => boolean,
  { max = 60, key = 'Tab' }: { max?: number; key?: 'Tab' | 'Shift+Tab' } = {},
): Promise<void> {
  const source = matches.toString();
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press(key);
    const hit = await page.evaluate((fn) => {
      const el = document.activeElement;
      return el ? (new Function(`return (${fn})`)() as (e: Element) => boolean)(el) : false;
    }, source);
    if (hit) return;
  }
  throw new Error(`Tab never reached the element (${source})`);
}

const byText = (text: string) =>
  new Function(
    'el',
    `return (el.textContent || '').trim().startsWith(${JSON.stringify(text)})`,
  ) as (el: Element) => boolean;

/** Flow 8a: an unknown URL shows a Not found page inside the app shell, with a way back. */
test('an unknown route shows a Not found page inside the shell', async ({ page, context }) => {
  await new Api(context).register('flow8a');
  await page.goto('/no-such-page/really');
  await expect(page).toHaveURL(/\/no-such-page\/really$/);
  await expect(page.getByRole('heading', { level: 1, name: /not found/i })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeAttached();
  const back = page.getByRole('main').getByRole('link', { name: /overview|home|dashboard/i });
  await expect(back.first()).toBeVisible();
  await back.first().click();
  await expect(page).toHaveURL(/\/overview/);
});

/**
 * Flow 8b: keyboard only (Tab / Shift+Tab / Enter / Escape / typing): sign in, use the skip link,
 * open Expenses from the navigation, add an expense in the dialog, and close the dialog with Escape
 * (focus goes back to the button that opened it).
 */
test('keyboard-only walkthrough: sign in, skip link, add an expense, Escape closes the dialog', async ({
  page,
  browser,
}) => {
  const setup = await browser.newContext();
  const api = new Api(setup);
  const owner = await api.register('flow8b');
  await api.createAccount(owner.workspaceId, 'Shop One');
  await setup.close();

  await test.step('sign in with the keyboard', async () => {
    await page.goto('/login');
    await tabTo(page, (el) => el.id === 'login-email');
    await page.keyboard.type(owner.email);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/overview/);
    await waitForSettled(page);
  });

  await test.step('the first Tab reaches the skip link; Enter moves focus to the main content', async () => {
    // A fresh load: focus starts at the top of the document.
    await page.reload();
    await waitForSettled(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  await test.step('open Expenses from the navigation', async () => {
    // From the main content, Shift+Tab walks back into the navigation.
    await tabTo(page, (el) => el.tagName === 'A' && (el.textContent ?? '').trim() === 'Expenses', {
      key: 'Shift+Tab',
    });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/expenses/);
    await expect(page.getByRole('heading', { level: 1, name: 'Expenses' })).toBeVisible();
    await waitForSettled(page);
  });

  await test.step('add an expense with the keyboard', async () => {
    await tabTo(page, byText('Add expense'));
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /expense/i });
    await expect(dialog).toBeVisible();
    const date = dialog.getByLabel('Date');
    await expect(date).toBeFocused();
    // en-IN date field: day, month, year (typing replaces the pre-filled day).
    await page.keyboard.type('05102026');
    await expect(date).toHaveValue('2026-10-05');
    // Tab leaves the date field (Chrome may first step through its day / month / year parts).
    await tabTo(page, (el) => el.tagName === 'SELECT', { max: 4 });
    await expect(dialog.getByLabel('Category')).toBeFocused();
    await page.keyboard.type('Pack');
    await expect(dialog.getByLabel('Category')).toHaveValue('packaging');
    await page.keyboard.press('Tab');
    await expect(dialog.getByLabel(/Description/)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByLabel('Amount (₹)')).toBeFocused();
    await page.keyboard.type('250');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await waitForSettled(page);
    await expect(page.getByTestId('expenses-total')).toContainText('₹250.00');
  });

  await test.step('Escape closes the dialog and focus returns to its button', async () => {
    const add = page.getByRole('button', { name: 'Add expense', exact: true });
    await add.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /expense/i });
    await expect(dialog).toBeVisible();
    // Tab stays inside the open dialog.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(add).toBeFocused();
  });
});

/**
 * Flow 8c: after a route change focus moves to the new page's <h1>, which names the page; the live
 * region stays quiet then (it announces only when a page has no <h1> and focus falls back to <main>).
 */
test('a route change moves focus to the page heading and announces the page', async ({
  page,
  context,
}) => {
  await new Api(context).register('flow8c');
  await page.goto('/overview');
  await waitForSettled(page);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Orders' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.matches('h1, main') ?? false))
    .toBe(true);
  // Orders has an <h1>: focus goes to it (and is read out), and the live region stays quiet so the
  // page is named once. (A page without an <h1> would get focus on <main> plus a live announcement.)
  await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeFocused();
  await expect(page.locator('[data-live-announcer]').filter({ hasText: /Orders/ })).toHaveCount(0);
});
