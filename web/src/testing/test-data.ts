// Shared data and helpers for specs only (excluded from the app build in tsconfig.app.json).

import { ApiFieldError } from '../app/core/api/api-error';
import { MeResponse, XSRF_COOKIE_NAME } from '../app/core/auth/auth.models';
import {
  ImportAction,
  ImportDetail,
  ImportRow,
  ImportStatus,
  ImportSummary,
  PagedResponse,
} from '../app/core/imports/import.models';
import { SellerAccount } from '../app/core/seller-accounts/seller-account.models';

/** Owner of "Asha Textiles" (id 10) and member of "Bharat Traders" (id 20). */
export const ME_TWO_WORKSPACES: MeResponse = {
  user: { id: '1', email: 'asha@example.com', displayName: 'Asha Rao' },
  workspaces: [
    { id: '10', name: 'Asha Textiles', role: 'owner' },
    { id: '20', name: 'Bharat Traders', role: 'member' },
  ],
};

/** Owner of one workspace, no display name. */
export const ME_OWNER: MeResponse = {
  user: { id: '1', email: 'asha@example.com', displayName: null },
  workspaces: [{ id: '10', name: 'Asha Textiles', role: 'owner' }],
};

/** Member (not owner) of one workspace. */
export const ME_MEMBER: MeResponse = {
  user: { id: '2', email: 'ravi@example.com', displayName: 'Ravi Shah' },
  workspaces: [{ id: '20', name: 'Bharat Traders', role: 'member' }],
};

export function sellerAccount(overrides: Partial<SellerAccount> = {}): SellerAccount {
  return {
    id: '100',
    workspaceId: '10',
    displayName: 'Main store',
    meeshoSupplierId: 'SUP_001',
    status: 'active',
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:00:00.000Z',
    ...overrides,
  };
}

/** What the server allows by status (a stale `importing` job is the exception: set it). */
const ACTIONS_BY_STATUS: Record<ImportStatus, ImportAction[]> = {
  previewed: ['confirm', 'cancel'],
  failed: ['retry', 'cancel'],
  importing: [],
  completed: [],
  cancelled: [],
};

/**
 * A previewed orders CSV import of account 100 (120 rows, 3 with errors). `allowedActions`
 * follows the status unless given.
 */
export function importSummary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    id: '500',
    sellerAccountId: '100',
    reportType: 'orders_csv',
    status: 'previewed',
    originalFilename: 'orders-oct.csv',
    fileSizeBytes: 20480,
    totalRows: 120,
    validRows: 117,
    errorRows: 3,
    insertedCount: null,
    updatedCount: null,
    unchangedCount: null,
    historyOnlyCount: null,
    reportPeriodStart: '2026-10-01',
    reportPeriodEnd: '2026-10-29',
    dataAsOf: '2026-10-29T18:29:59.999Z',
    createdAt: '2026-10-30T08:30:00.000Z',
    createdBy: { id: '1', displayName: 'Asha Rao', email: 'asha@example.com' },
    confirmedAt: null,
    completedAt: null,
    failureMessage: null,
    allowedActions: [...ACTIONS_BY_STATUS[overrides.status ?? 'previewed']],
    ...overrides,
  };
}

export function importRow(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    id: '9001',
    sheetName: null,
    rowNumber: 2,
    status: 'valid',
    action: 'insert',
    errors: [],
    values: {
      subOrderNo: 'SO-1001',
      status: 'Delivered',
      orderDate: '2026-10-05',
      quantity: '1',
      supplierListedPrice: '1249.5',
      sku: null,
    },
    ...overrides,
  };
}

/** {@link importSummary} with a preview: one CSV sheet, planned counts and two sample rows. */
export function importDetail(overrides: Partial<ImportDetail> = {}): ImportDetail {
  return {
    ...importSummary(overrides),
    preview: {
      sheets: [
        {
          name: 'orders-oct.csv',
          entryType: null,
          ignored: false,
          rows: 120,
          validRows: 117,
          errorRows: 3,
          recognisedColumns: ['Sub Order No', 'Reason for Credit Entry', 'Order Date', 'Quantity'],
          missingOptionalColumns: ['Packet Id'],
          ignoredColumns: ['Customer Name'],
        },
      ],
      planned: { insert: 100, update: 15, unchanged: 0, historyOnly: 2, statusEvents: 117 },
      sampleRows: [
        importRow(),
        importRow({
          id: '9002',
          rowNumber: 3,
          action: 'update',
          values: {
            subOrderNo: 'SO-1002',
            status: 'Shipped',
            orderDate: '2026-10-06',
            quantity: '2',
            supplierListedPrice: '0',
            sku: 'KURTA-M',
          },
        }),
      ],
    },
    ...overrides,
  };
}

/** A row with errors, as `GET /imports/:id/errors` returns it. */
export function errorRow(rowNumber: number, overrides: Partial<ImportRow> = {}): ImportRow {
  return importRow({
    id: `e${rowNumber}`,
    rowNumber,
    status: 'error',
    action: null,
    errors: [{ field: 'orderDate', reason: 'is not a date (use DD-MM-YYYY)' }],
    ...overrides,
  });
}

export function paged<T>(items: T[], page = 1, total = items.length, pageSize = 20): PagedResponse<T> {
  return { items, page, pageSize, total };
}

/** A `File` that reports `size` bytes (without allocating them). */
export function fakeFile(name: string, size = 64, type = ''): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

/** Puts `files` on a file input and fires `change`, as choosing them in the picker does. */
export function chooseFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
}

/** Fires a drag event carrying `files` (jsdom has no `DataTransfer`). */
export function dragEvent(type: string, files: File[] = []): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files, types: ['Files'], dropEffect: 'none' },
  });
  return event;
}

/** The API's error envelope. */
export function errorBody(code: string, message: string, details?: ApiFieldError[]) {
  return { error: { code, message, requestId: 'req-1', ...(details ? { details } : {}) } };
}

export function setXsrfCookie(value = 'xsrf-test-token'): void {
  document.cookie = `${XSRF_COOKIE_NAME}=${value}; path=/`;
}

export function clearXsrfCookie(): void {
  document.cookie = `${XSRF_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

/** Text content with whitespace collapsed. */
export function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Sets an input's value the way typing does (fires `input`). */
export function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
}
