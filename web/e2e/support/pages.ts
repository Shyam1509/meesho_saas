import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { Api } from './api';
import { seedShop } from './seed';
import { waitForSettled } from './ui';

/** Ids of the data every page of the a11y / layout specs shows. */
export interface PageIds {
  accountId: string;
  orderId: string;
  productId: string;
  ordersImportId: string;
  previewedImportId: string;
}

export interface PagesSeed {
  ids: PageIds;
  cookies: Awaited<ReturnType<BrowserContext['cookies']>>;
}

/**
 * One owner with the full fixture (orders + workbook + costs + expenses, plus a previewed import that
 * was never confirmed), seeded once per spec file and worker. Tests reuse the session cookie.
 */
export async function seedForPages(browser: Browser, label: string): Promise<PagesSeed> {
  const context = await browser.newContext();
  try {
    const seeded = await seedShop(context, label, {
      costs: true,
      expenses: true,
      previewedImport: true,
    });
    const api = new Api(context);
    return {
      ids: {
        accountId: seeded.accountId,
        orderId: await api.orderId(seeded.accountId, 'E-1'),
        productId: await api.productId(seeded.accountId, 'SKU-A'),
        ordersImportId: seeded.ordersImportId,
        previewedImportId: seeded.previewedImportId!,
      },
      cookies: await context.cookies(),
    };
  } finally {
    await context.close();
  }
}

export interface PageDef {
  /** File-name friendly id (screenshots, axe JSON). */
  key: string;
  path: (ids: PageIds) => string;
  /** The page's <h1>, waited for before checking. */
  h1: string | RegExp;
  signedOut?: boolean;
}

const OCT = 'from=2026-10-01&to=2026-10-31';

/** Every screen of the app (blueprint §3 screen list + details, sign-in, registration, not found). */
export const PAGES: PageDef[] = [
  { key: 'login', path: () => '/login', h1: 'Sign in', signedOut: true },
  { key: 'register', path: () => '/register', h1: 'Create an account', signedOut: true },
  { key: 'overview-workspace', path: () => `/overview?${OCT}`, h1: 'Overview' },
  { key: 'overview-account', path: () => `/overview?scope=account&${OCT}`, h1: 'Overview' },
  { key: 'orders', path: () => '/orders', h1: 'Orders' },
  {
    key: 'order-detail',
    path: (ids) => `/accounts/${ids.accountId}/orders/${ids.orderId}`,
    h1: 'Order E-1',
  },
  { key: 'settlements-entries', path: () => '/settlements', h1: 'Settlements & reconciliation' },
  {
    key: 'settlements-reconciliation',
    path: () => '/settlements?tab=reconciliation',
    h1: 'Settlements & reconciliation',
  },
  { key: 'products', path: () => '/products', h1: 'Products & costs' },
  { key: 'product-detail', path: (ids) => `/products/${ids.productId}`, h1: 'Product SKU-A' },
  { key: 'expenses', path: () => '/expenses', h1: 'Expenses' },
  { key: 'imports', path: () => '/imports', h1: 'Imports' },
  {
    key: 'import-detail',
    path: (ids) => `/imports/${ids.ordersImportId}`,
    h1: /orders-oct-2026\.csv/,
  },
  {
    key: 'import-detail-previewed',
    path: (ids) => `/imports/${ids.previewedImportId}`,
    h1: /orders-as-of-15-oct\.csv/,
  },
  { key: 'reports', path: () => '/reports', h1: 'Reports' },
  { key: 'seller-accounts', path: () => '/seller-accounts', h1: 'Seller accounts' },
  { key: 'settings', path: () => '/settings', h1: 'Workspace settings' },
  { key: 'not-found', path: () => '/no-such-page', h1: /not found/i },
];

export interface DialogDef {
  key: string;
  page: string;
  /** Opens the dialog (or form) on the loaded page and waits for it. */
  open: (page: Page) => Promise<void>;
  /** Only at this width (e.g. the phone menu). */
  onlyWidth?: number;
}

/** A dialog or a confirmation (`alertdialog`). */
export function anyDialog(page: Page) {
  return page.locator('[role="dialog"], [role="alertdialog"]');
}

async function dialogOpened(page: Page): Promise<void> {
  await expect(anyDialog(page)).toBeVisible();
  await waitForSettled(page);
}

/** Dialogs and inline forms, scanned open (some with their validation errors showing). */
export const DIALOGS: DialogDef[] = [
  {
    key: 'expenses-add-dialog-errors',
    page: 'expenses',
    open: async (page) => {
      await page.getByRole('button', { name: 'Add expense', exact: true }).click();
      await dialogOpened(page);
      await page.getByRole('dialog').getByRole('button', { name: 'Add expense' }).click();
      await expect(page.getByRole('dialog').locator('[aria-invalid="true"]').first()).toBeVisible();
    },
  },
  {
    key: 'product-add-cost-dialog',
    page: 'product-detail',
    open: async (page) => {
      await page.getByRole('button', { name: 'Add cost' }).click();
      await dialogOpened(page);
    },
  },
  {
    key: 'products-add-dialog',
    page: 'products',
    open: async (page) => {
      await page.getByRole('button', { name: 'Add product' }).click();
      await dialogOpened(page);
    },
  },
  {
    key: 'reconciliation-match-dialog',
    page: 'settlements-reconciliation',
    open: async (page) => {
      await page.getByRole('button', { name: /Match to order/ }).click();
      await dialogOpened(page);
      await page.getByRole('dialog').getByRole('button', { name: 'Search' }).click();
      await expect(page.getByRole('dialog').getByRole('radio').first()).toBeVisible();
      await waitForSettled(page);
    },
  },
  {
    key: 'import-discard-confirm',
    page: 'import-detail-previewed',
    open: async (page) => {
      await page.getByRole('button', { name: 'Discard' }).click();
      await dialogOpened(page);
    },
  },
  {
    key: 'seller-account-disable-confirm',
    page: 'seller-accounts',
    open: async (page) => {
      await page.getByRole('button', { name: /^Disable/ }).click();
      await dialogOpened(page);
    },
  },
  {
    key: 'seller-account-add-form-errors',
    page: 'seller-accounts',
    open: async (page) => {
      await page.getByRole('button', { name: 'Add account' }).click();
      await page.getByRole('button', { name: 'Save account' }).click();
      await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
    },
  },
  {
    key: 'phone-menu-open',
    page: 'orders',
    onlyWidth: 390,
    open: async (page) => {
      await page.getByRole('button', { name: /menu/i }).click();
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    },
  },
];

/** Signs the context in (unless the page is for signed-out visitors), opens the page, waits for data. */
export async function openPage(page: Page, seed: PagesSeed, def: PageDef): Promise<void> {
  if (!def.signedOut) {
    await page.context().addCookies(seed.cookies);
  }
  await page.goto(def.path(seed.ids));
  await expect(page.getByRole('heading', { level: 1, name: def.h1 })).toBeVisible();
  await waitForSettled(page);
}

export function pageDef(key: string): PageDef {
  const def = PAGES.find((p) => p.key === key);
  if (!def) throw new Error(`no page ${key}`);
  return def;
}
