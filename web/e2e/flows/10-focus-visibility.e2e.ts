import { expect, test, type Page } from '@playwright/test';

import { type PagesSeed, anyDialog, openPage, pageDef, seedForPages } from '../support/pages';
import { waitForSettled } from '../support/ui';

/**
 * Focus visibility (WCAG 2.4.11 Focus Not Obscured) and focus order on small screens:
 * (a) a short landscape phone (640 × 360): Tab through every control of each form dialog; the focused
 *     control must be fully inside the dialog's visible scrolling area and not under the sticky
 *     action bar;
 * (b) the phone menu open at 390 px: Tab from the last menu item must not reach the page behind it
 *     (<main> is inert while the menu covers it);
 * (d) following a link to the page already shown, from the phone menu, leaves focus on something
 *     visible (not on <body>).
 */
let seed: PagesSeed;
test.beforeAll(async ({ browser }) => {
  seed = await seedForPages(browser, 'focus');
});

interface Obscured {
  ok: boolean;
  what: string;
}

/**
 * Whether the focused element is fully visible inside the open dialog: within every scrolling
 * ancestor inside the dialog (and the dialog itself), and, unless it is part of a sticky bar, above
 * the top edge of any sticky bar at the bottom of the scrolling area.
 */
async function focusedVisibleInDialog(page: Page): Promise<Obscured> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
    const name = (e: Element | null) =>
      e
        ? `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''} "${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`
        : 'nothing';
    if (!el || !dialog || !dialog.contains(el)) {
      return { ok: false, what: `focus left the dialog (${name(el)})` };
    }
    const r = el.getBoundingClientRect();
    const tol = 1;
    const containers: HTMLElement[] = [dialog];
    for (let p = el.parentElement; p && p !== dialog; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if (oy === 'auto' || oy === 'scroll' || oy === 'hidden') containers.push(p);
    }
    for (const c of containers) {
      const cr = c.getBoundingClientRect();
      if (r.top < cr.top - tol || r.bottom > cr.bottom + tol) {
        return {
          ok: false,
          what: `${name(el)} [${Math.round(r.top)}–${Math.round(r.bottom)}] outside its scroll area [${Math.round(cr.top)}–${Math.round(cr.bottom)}]`,
        };
      }
    }
    const stickies = [...dialog.querySelectorAll<HTMLElement>('*')].filter(
      (s) => getComputedStyle(s).position === 'sticky' && !s.contains(el),
    );
    for (const s of stickies) {
      const sr = s.getBoundingClientRect();
      const overlaps = r.bottom > sr.top + tol && r.top < sr.bottom - tol;
      if (overlaps) {
        return {
          ok: false,
          what: `${name(el)} [${Math.round(r.top)}–${Math.round(r.bottom)}] is under the sticky bar [${Math.round(sr.top)}–${Math.round(sr.bottom)}]`,
        };
      }
    }
    return { ok: true, what: name(el) };
  });
}

/**
 * {@link focusedVisibleInDialog} once scrolling has settled: re-checked for up to a second, so a
 * smooth or deferred scroll-into-view counts once it finishes.
 */
async function settledCheck(page: Page): Promise<Obscured> {
  let check = await focusedVisibleInDialog(page);
  for (let i = 0; i < 10 && !check.ok; i += 1) {
    await page.waitForTimeout(100);
    check = await focusedVisibleInDialog(page);
  }
  return check;
}

/** Tabs once around the whole dialog, checking each focus stop. */
async function tabThroughDialog(page: Page): Promise<string[]> {
  const stops = await anyDialog(page).evaluate(
    (d) =>
      d.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ).length,
  );
  const problems: string[] = [];
  const first = await settledCheck(page);
  if (!first.ok) problems.push(`on open: ${first.what}`);
  for (let i = 0; i < stops + 1; i += 1) {
    await page.keyboard.press('Tab');
    const check = await settledCheck(page);
    if (!check.ok) problems.push(`Tab ${i + 1}: ${check.what}`);
  }
  return problems;
}

const FORM_DIALOGS: { key: string; page: string; open: (page: Page) => Promise<void> }[] = [
  {
    key: 'expense dialog (with errors)',
    page: 'expenses',
    open: async (page) => {
      await page.getByRole('button', { name: 'Add expense', exact: true }).click();
      await expect(anyDialog(page)).toBeVisible();
      await anyDialog(page).getByLabel('Date').fill('');
      await anyDialog(page).getByRole('button', { name: 'Add expense' }).click();
      await expect(anyDialog(page).locator('[aria-invalid="true"]').first()).toBeVisible();
      await anyDialog(page).getByLabel('Date').focus();
    },
  },
  {
    key: 'unit cost dialog',
    page: 'product-detail',
    open: async (page) => {
      await page.getByRole('button', { name: 'Add cost' }).click();
      await expect(anyDialog(page)).toBeVisible();
    },
  },
  {
    key: 'add product dialog',
    page: 'products',
    open: async (page) => {
      await page.getByRole('button', { name: 'Add product' }).click();
      await expect(anyDialog(page)).toBeVisible();
    },
  },
  {
    key: 'match order dialog (with results)',
    page: 'settlements-reconciliation',
    open: async (page) => {
      await page.getByRole('button', { name: /Match to order/ }).click();
      await expect(anyDialog(page)).toBeVisible();
      await anyDialog(page).getByRole('button', { name: 'Search' }).click();
      await expect(anyDialog(page).getByRole('radio').first()).toBeVisible();
      await anyDialog(page).getByLabel('Find the order').focus();
    },
  },
];

test.describe('short landscape screen (640 × 360)', () => {
  test.use({ viewport: { width: 640, height: 360 } });

  for (const dialog of FORM_DIALOGS) {
    test(`focus stays visible while tabbing: ${dialog.key}`, async ({ page }) => {
      await openPage(page, seed, pageDef(dialog.page));
      await dialog.open(page);
      await waitForSettled(page);
      const problems = await tabThroughDialog(page);
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});

test.describe('phone menu (390 × 844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Tab from the last menu item does not reach the page behind the open menu', async ({
    page,
  }) => {
    await openPage(page, seed, pageDef('orders'));
    await page.getByRole('button', { name: /menu/i }).click();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    await nav.getByRole('link').last().focus();
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('Tab');
      const inMain = await page.evaluate(
        () => !!document.activeElement?.closest('main') && document.activeElement !== document.body,
      );
      expect(inMain, `Tab ${i + 1} landed inside <main> behind the open menu`).toBe(false);
    }
  });

  test('a menu link to the page already shown leaves focus on something visible', async ({
    page,
  }) => {
    await openPage(page, seed, pageDef('orders'));
    await page.getByRole('button', { name: /menu/i }).click();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Orders', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(nav).toBeHidden();
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return 'body';
      const r = el.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      return visible ? `ok ${el.tagName.toLowerCase()}` : `hidden ${el.tagName.toLowerCase()}`;
    });
    expect(focused).toMatch(/^ok /);
  });
});
