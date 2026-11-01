import type { BrowserContext } from '@playwright/test';

import { Api, CSV_MIME, XLSX_MIME } from './api';
import {
  ACCOUNT_EXPENSES,
  COSTS,
  OLDER_ORDERS_DATA_AS_OF,
  OLDER_ORDERS_FILE,
  ORDERS_DATA_AS_OF,
  ORDERS_FILE,
  WORKBOOK_FILE,
  WORKSPACE_EXPENSES,
  olderOrdersCsv,
  ordersCsv,
  settlementWorkbook,
} from './fixtures';

export interface SeedOptions {
  /** Import the settlement workbook too (default true). */
  workbook?: boolean;
  /** Add COSTS (default false). */
  costs?: boolean;
  /** Add ACCOUNT_EXPENSES and WORKSPACE_EXPENSES (default false). */
  expenses?: boolean;
  /** Upload the older orders report and leave it previewed, not confirmed (default false). */
  previewedImport?: boolean;
  workspaceName?: string;
}

export interface Seeded {
  email: string;
  workspaceId: string;
  accountId: string;
  ordersImportId: string;
  workbookImportId: string | null;
  previewedImportId: string | null;
}

/**
 * A fresh owner ("E2E <label>") with seller account "Shop One" and the fixture files imported
 * through the API; the browser context is signed in as that owner afterwards.
 */
export async function seedShop(
  context: BrowserContext,
  label: string,
  options: SeedOptions = {},
): Promise<Seeded> {
  const api = new Api(context);
  const owner = await api.register(label, options.workspaceName);
  const accountId = await api.createAccount(owner.workspaceId, 'Shop One');
  const orders = await api.importFile(
    accountId,
    { name: ORDERS_FILE, buffer: ordersCsv(), mimeType: CSV_MIME },
    ORDERS_DATA_AS_OF,
  );
  let workbookImportId: string | null = null;
  if (options.workbook ?? true) {
    workbookImportId = (
      await api.importFile(accountId, {
        name: WORKBOOK_FILE,
        buffer: await settlementWorkbook(),
        mimeType: XLSX_MIME,
      })
    ).id;
  }
  if (options.costs) {
    for (const cost of COSTS) {
      await api.addCost(
        await api.productId(accountId, cost.sku),
        cost.effectiveFrom,
        cost.unitCost,
      );
    }
  }
  if (options.expenses) {
    for (const expense of ACCOUNT_EXPENSES) {
      await api.addAccountExpense(accountId, expense);
    }
    for (const expense of WORKSPACE_EXPENSES) {
      await api.addWorkspaceExpense(owner.workspaceId, expense);
    }
  }
  let previewedImportId: string | null = null;
  if (options.previewedImport) {
    previewedImportId = (
      await api.upload(
        accountId,
        { name: OLDER_ORDERS_FILE, buffer: olderOrdersCsv(), mimeType: CSV_MIME },
        OLDER_ORDERS_DATA_AS_OF,
      )
    ).id;
  }
  return {
    email: owner.email,
    workspaceId: owner.workspaceId,
    accountId,
    ordersImportId: orders.id,
    workbookImportId,
    previewedImportId,
  };
}
