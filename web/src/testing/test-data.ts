// Shared data and helpers for specs only (excluded from the app build in tsconfig.app.json).

import { ApiFieldError } from '../app/core/api/api-error';
import {
  Dashboard,
  DashboardAccountRow,
  TrendBucket,
} from '../app/core/dashboard/dashboard.models';
import { MeResponse, XSRF_COOKIE_NAME } from '../app/core/auth/auth.models';
import {
  ImportAction,
  ImportDetail,
  ImportRow,
  ImportStatus,
  ImportSummary,
  PagedResponse,
} from '../app/core/imports/import.models';
import { ImportRef } from '../app/core/api/refs';
import { OrderDetail, OrderSummary, StatusEvent } from '../app/core/orders/order.models';
import { CostEntry, ProductDetail, ProductSummary } from '../app/core/products/product.models';
import {
  Expense,
  ExpenseCategory,
  ExpenseListResponse,
} from '../app/core/expenses/expense.models';
import {
  ReconciliationOverview,
  RunSummary,
} from '../app/core/reconciliation/reconciliation.models';
import { SellerAccount } from '../app/core/seller-accounts/seller-account.models';
import {
  SettlementEntry,
  SettlementListResponse,
} from '../app/core/settlements/settlement.models';

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

/** The import a record came from. */
export function importRef(overrides: Partial<ImportRef> = {}): ImportRef {
  return {
    id: '500',
    originalFilename: 'orders-oct.csv',
    createdAt: '2026-10-30T08:30:00.000Z',
    ...overrides,
  };
}

/**
 * Order SO-1001 (id 9001) of account 100, delivered, with one matched entry of ₹1,180.40, and a
 * known product cost of ₹250.00 (1 × ₹250 from 1 Oct 2026, product 700).
 */
export function orderSummary(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: '9001',
    subOrderNo: 'SO-1001',
    orderNo: 'ORD-77',
    orderDate: '2026-10-05',
    productName: 'Cotton kurta',
    sku: 'KURTA-M',
    size: 'M',
    quantity: 1,
    customerState: 'Gujarat',
    supplierListedPrice: '1249.50',
    supplierDiscountedPrice: '1199.00',
    currentStatus: 'Delivered',
    currentStatusObservedAt: '2026-10-29T18:29:59.999Z',
    settlement: { entryCount: 1, amount: '1180.40' },
    productId: '700',
    productCost: {
      state: 'known',
      unitCost: '250.0000',
      effectiveFrom: '2026-10-01',
      total: '250.0000',
    },
    ...overrides,
  };
}

export function statusEvent(overrides: Partial<StatusEvent> = {}): StatusEvent {
  return {
    id: '70',
    status: 'Shipped',
    observedAt: '2026-10-10T18:29:59.999Z',
    importJob: importRef({ id: '480', originalFilename: 'orders-early-oct.csv' }),
    ...overrides,
  };
}

/** A matched (auto) order payment of ₹1,180.40 for SO-1001 / order 9001. */
export function settlementEntry(overrides: Partial<SettlementEntry> = {}): SettlementEntry {
  return {
    id: '3001',
    entryType: 'order_payment',
    sheetName: 'Order Payments',
    transactionId: 'TXN-1',
    subOrderNo: 'SO-1001',
    orderDate: '2026-10-05',
    paymentDate: '2026-10-20',
    settlementAmount: '1180.40',
    saleAmount: '1199.00',
    returnAmount: null,
    commissionAmount: '-12.60',
    shippingCharge: '0',
    tcsAmount: '-5.00',
    tdsAmount: '-1.00',
    recoveryAmount: null,
    compensationAmount: null,
    isEstimate: false,
    supersededByEntryId: null,
    importJob: importRef({ id: '510', originalFilename: 'settlement-oct.xlsx' }),
    createdAt: '2026-10-30T09:00:00.000Z',
    match: {
      state: 'matched',
      method: 'auto',
      orderId: '9001',
      orderSubOrderNo: 'SO-1001',
      matchedAt: '2026-10-30T09:00:01.000Z',
      matchedBy: null,
      autoMatchBlocked: false,
    },
    ...overrides,
  };
}

/** An entry with a sub order no. that no order has. */
export function unmatchedEntry(overrides: Partial<SettlementEntry> = {}): SettlementEntry {
  return settlementEntry({
    id: '3002',
    transactionId: 'TXN-2',
    subOrderNo: 'SO-9999',
    settlementAmount: '450.00',
    match: {
      state: 'unmatched',
      method: null,
      orderId: null,
      orderSubOrderNo: null,
      matchedAt: null,
      matchedBy: null,
      autoMatchBlocked: false,
    },
    ...overrides,
  });
}

/** {@link orderSummary} with fields, two status events (oldest first) and its matched entry. */
export function orderDetail(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    ...orderSummary(overrides),
    catalogId: 'CAT-5',
    packetId: null,
    createdAt: '2026-10-11T08:00:00.000Z',
    updatedAt: '2026-10-30T08:30:00.000Z',
    firstImport: importRef({ id: '480', originalFilename: 'orders-early-oct.csv' }),
    lastImport: importRef(),
    statusHistory: [
      statusEvent(),
      statusEvent({
        id: '71',
        status: 'Delivered',
        observedAt: '2026-10-29T18:29:59.999Z',
        importJob: importRef(),
      }),
    ],
    settlements: [settlementEntry()],
    ...overrides,
  };
}

export function settlementList(
  items: SettlementEntry[],
  totals: SettlementListResponse['totals'] = { settlementAmount: '1180.40', count: items.length },
  page = 1,
  total = items.length,
  pageSize = 25,
): SettlementListResponse {
  return { items, page, pageSize, total, totals };
}

export function runSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: '40',
    triggerType: 'import',
    status: 'completed',
    importJobId: '510',
    triggeredBy: null,
    startedAt: '2026-10-30T09:00:00.000Z',
    finishedAt: '2026-10-30T09:00:01.000Z',
    matchedCount: 12,
    unmatchedSettlementCount: 2,
    unmatchedOrderCount: 5,
    failureMessage: null,
    ...overrides,
  };
}

export function reconciliationOverview(
  overrides: Partial<ReconciliationOverview> = {},
): ReconciliationOverview {
  return {
    lastRun: runSummary(),
    settlements: {
      total: 20,
      matched: 12,
      unmatched: 2,
      accountLevel: 6,
      matchedAmount: '14250.75',
      unmatchedAmount: '900.00',
      accountLevelAmount: '-320.50',
    },
    orders: { total: 17, withSettlement: 12, withoutSettlement: 5 },
    withoutSettlementByStatus: [
      { status: 'Shipped', count: 3 },
      { status: 'Cancelled', count: 2 },
    ],
    ...overrides,
  };
}

/** Product KURTA-M (id 700) of account 100: 12 orders, 2 without a cost, ₹250 since 1 Oct 2026. */
export function productSummary(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: '700',
    sellerAccountId: '100',
    sku: 'KURTA-M',
    name: 'Cotton kurta',
    catalogId: 'CAT-5',
    status: 'active',
    orderCount: 12,
    ordersWithoutCost: 2,
    currentCost: { unitCost: '250.0000', effectiveFrom: '2026-10-01' },
    costCount: 2,
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:00:00.000Z',
    ...overrides,
  };
}

export function costEntry(overrides: Partial<CostEntry> = {}): CostEntry {
  return {
    id: '801',
    unitCost: '250.0000',
    effectiveFrom: '2026-10-01',
    note: 'October price',
    createdBy: { id: '1', displayName: 'Asha Rao', email: 'asha@example.com' },
    createdAt: '2026-10-30T09:00:00.000Z',
    ...overrides,
  };
}

/**
 * {@link productSummary} in workspace 10 with two costs, newest first: ₹250 from 1 Oct, ₹230.5
 * from 1 Sep.
 */
export function productDetail(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    ...productSummary(overrides),
    workspaceId: '10',
    costHistory: [
      costEntry(),
      costEntry({ id: '800', unitCost: '230.5000', effectiveFrom: '2026-09-01', note: null }),
    ],
    ...overrides,
  };
}

/** The API's categories (a subset, with `other` needing a description). */
export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  {
    key: 'packaging',
    label: 'Packaging & labels',
    help: 'Boxes, poly bags, tape and labels you buy.',
    descriptionRequired: false,
  },
  {
    key: 'staff',
    label: 'Salaries & staff',
    help: 'Wages of people who pack and ship.',
    descriptionRequired: false,
  },
  {
    key: 'other',
    label: 'Other (description required)',
    help: 'Anything else; describe it.',
    descriptionRequired: true,
  },
];

/** A ₹1,200.50 packaging expense of account 100 in workspace 10, on 5 Oct 2026. */
export function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: '900',
    workspaceId: '10',
    sellerAccountId: '100',
    scope: 'account',
    expenseDate: '2026-10-05',
    category: 'packaging',
    categoryLabel: 'Packaging & labels',
    description: 'Poly bags',
    amount: '1200.50',
    createdBy: { id: '1', displayName: 'Asha Rao', email: 'asha@example.com' },
    createdAt: '2026-10-05T09:00:00.000Z',
    updatedAt: '2026-10-05T09:00:00.000Z',
    ...overrides,
  };
}

export function expenseList(
  items: Expense[],
  totals: ExpenseListResponse['totals'] = { amount: '1200.50', count: items.length },
  page = 1,
  total = items.length,
  pageSize = 25,
): ExpenseListResponse {
  return { items, page, pageSize, total, totals };
}

/** A trend bucket without rows: 0 orders, every sum missing. */
export function trendBucket(overrides: Partial<TrendBucket> = {}): TrendBucket {
  return {
    bucketStart: '2026-10-01',
    orders: 0,
    orderValueDiscounted: null,
    settlementAmount: null,
    productCostKnown: null,
    expenses: null,
    ...overrides,
  };
}

/**
 * Account 100's dashboard for October 2026 by order date, hand-calculated: settlement 1180.40 −
 * known cost 600.00 − expenses 250.00 = contribution 330.40. The trend has a gap (2 Oct, no rows)
 * and a true zero settlement (4 Oct).
 */
export function accountDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    scope: { kind: 'account', id: '100', name: 'Main store' },
    filters: {
      from: '2026-10-01',
      to: '2026-10-31',
      basis: 'order_date',
      statuses: [],
      granularity: 'day',
    },
    orders: {
      count: 3,
      units: 4,
      statusCounts: [
        { status: 'Delivered', count: 2 },
        { status: 'RTO Complete', count: 1 },
      ],
      orderValueDiscounted: '1497.00',
      orderValueListed: '1797.00',
      pricesMissing: 0,
    },
    settlements: {
      amount: '1180.40',
      count: 4,
      undatedEntries: 0,
      byType: [
        { entryType: 'order_payment', amount: '1300.40', count: 3 },
        { entryType: 'ads_cost', amount: '-120.00', count: 1 },
      ],
      components: {
        sale: '1497.00',
        return: '0.00',
        commission: '-180.30',
        shipping: '-36.30',
        tcs: '-7.48',
        tds: '-1.50',
        recovery: null,
        compensation: null,
      },
    },
    productCost: {
      known: '600.00',
      knownExact: '600.0000',
      ordersKnown: 3,
      ordersCostUnknown: 0,
      ordersNoProduct: 0,
      cancelledOrReturnedOrders: 0,
      cancelledOrReturnedCost: null,
    },
    expenses: { amount: '250.00', count: 1, accountAmount: '250.00', workspaceAmount: null },
    contribution: {
      amount: '330.40',
      complete: true,
      flags: {
        costUnknown: 0,
        ordersWithoutSettlement: 0,
        unmatchedSettlements: 0,
        pricesMissing: 0,
        cancelledOrReturned: 0,
      },
      formula: 'settlement amount − known product cost − expenses',
    },
    trend: [
      trendBucket({
        bucketStart: '2026-10-01',
        orders: 1,
        orderValueDiscounted: '499.00',
        settlementAmount: '400.00',
        productCostKnown: '200.00',
      }),
      trendBucket({ bucketStart: '2026-10-02' }),
      trendBucket({
        bucketStart: '2026-10-03',
        orders: 2,
        orderValueDiscounted: '998.00',
        settlementAmount: '780.40',
        productCostKnown: '400.00',
        expenses: '250.00',
      }),
      trendBucket({ bucketStart: '2026-10-04', settlementAmount: '0.00' }),
    ],
    generatedAt: '2026-11-01T04:30:00.000Z',
    ...overrides,
  };
}

export function accountRow(overrides: Partial<DashboardAccountRow> = {}): DashboardAccountRow {
  return {
    id: '100',
    displayName: 'Main store',
    status: 'active',
    orders: 3,
    orderValueDiscounted: '1497.00',
    settlementAmount: '1180.40',
    productCostKnown: '600.00',
    expenses: '250.00',
    contribution: '330.40',
    complete: true,
    cancelledOrReturnedOrders: 0,
    ...overrides,
  };
}

/**
 * Workspace 10's dashboard, hand-calculated. Accounts: Main store (100), Outlet (101: no known
 * cost, incomplete), Old shop (102, disabled). Total of accounts: 5 orders, order value 2297.50,
 * settlement 1130.15, cost 600.00, expenses 350.00, contribution 180.15. Workspace-wide expenses
 * 75.00, so the workspace: expenses 425.00, contribution 105.15, incomplete. Main store's RTO
 * Complete order counts as cancelled/returned: its known cost 200.00 (of the 600.00) is still
 * deducted, so Main store is incomplete too.
 */
export function workspaceDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  const base = accountDashboard();
  return {
    ...base,
    scope: { kind: 'workspace', id: '10', name: 'Asha Textiles' },
    orders: { ...base.orders, count: 5, units: 6, orderValueDiscounted: '2297.50' },
    settlements: { ...base.settlements, amount: '1130.15', count: 5 },
    productCost: {
      ...base.productCost,
      ordersKnown: 3,
      ordersCostUnknown: 2,
      cancelledOrReturnedOrders: 1,
      cancelledOrReturnedCost: '200.00',
    },
    expenses: { amount: '425.00', count: 3, accountAmount: '350.00', workspaceAmount: '75.00' },
    contribution: {
      amount: '105.15',
      complete: false,
      flags: {
        costUnknown: 2,
        ordersWithoutSettlement: 1,
        unmatchedSettlements: 3,
        pricesMissing: 0,
        cancelledOrReturned: 1,
      },
      formula: 'settlement amount − known product cost − expenses',
    },
    accounts: [
      accountRow({ complete: false, cancelledOrReturnedOrders: 1 }),
      accountRow({
        id: '101',
        displayName: 'Outlet',
        orders: 2,
        orderValueDiscounted: '800.50',
        settlementAmount: '-50.25',
        productCostKnown: null,
        expenses: null,
        contribution: '-50.25',
        complete: false,
      }),
      accountRow({
        id: '102',
        displayName: 'Old shop',
        status: 'disabled',
        orders: 0,
        orderValueDiscounted: null,
        settlementAmount: null,
        productCostKnown: null,
        expenses: '100.00',
        contribution: '-100.00',
      }),
    ],
    ...overrides,
  };
}
