import { createRequire } from 'node:module';
import path from 'node:path';

import { API_ROOT } from './env';

/**
 * Synthetic Meesho files built in code (no real Meesho export exists yet), with the header names the
 * API's import profiles recognise (api/src/imports/profiles/meesho-profiles.ts, the same headers as
 * api/test/dashboard-reports.e2e-spec.ts). Every expected number in the specs is worked out by hand
 * from these rows: see DASHBOARD_OCTOBER below.
 *
 * Orders report "Shop One", statuses as of 31 Oct 2026          qty  listed  disc   SKU
 *   E-1  01-10-2026  DELIVERED                                   2    500    450   SKU-A
 *   E-2  03-10-2026  DELIVERED                                   1    300    280   SKU-B
 *   E-3  05-10-2026  RTO (cancelled / returned keyword)          1    500    450   SKU-A
 *   E-4  10-10-2026  SHIPPED                                     3    100     —    SKU-C  (no discounted price)
 *   E-5  20-10-2026  DELIVERED                                   1    300    280   SKU-B
 *   E-6  28-09-2026  DELIVERED                                   1    300    280   SKU-B  (September order)
 *   E-7  15-10-2026  quantity 0 → the one ERROR row (file row 8, counting the header)
 *
 * Settlement workbook                     sub order  order date   payment     amount
 *   Order Payments  T1                    E-1        2026-10-01   2026-10-08   400.00
 *                   T2                    E-2        2026-10-03   2026-10-10   250.00
 *                   T3                    E-3        2026-10-05   2026-10-12   400.00
 *                   T4                    E-3        2026-10-05   2026-10-20  −420.00
 *                   T5                    E-6        2026-09-28   2026-10-06   260.00
 *                   T8                    X-9 (no such order: UNMATCHED)    2026-10-15   2026-10-18    99.00
 *   Ads Cost        CMP-1 (account level, no sub order)           2026-10-14  −150.00
 *
 * After both imports (auto-matching): matched T1 T2 T3 T4 T5 (890.00), unmatched T8 (99.00),
 * account-level CMP-1 (−150.00); orders with a settlement E-1 E-2 E-3 E-6, without E-4 E-5.
 */

export type Cell = string | number | null;

export const ORDER_HEADER = [
  'Sub Order No',
  'Order Date',
  'Reason for Credit Entry',
  'Quantity',
  'SKU',
  'Product Name',
  'Supplier Listed Price (Incl. GST + Commission)',
  'Supplier Discounted Price (Incl GST and Commission)',
  'Customer State',
];

export const ORDER_ROWS: Cell[][] = [
  ['E-1', '01-10-2026', 'DELIVERED', '2', 'SKU-A', 'Kurti red', '500', '450', 'Gujarat'],
  ['E-2', '03-10-2026', 'DELIVERED', '1', 'SKU-B', 'Saree blue', '300', '280', 'Gujarat'],
  ['E-3', '05-10-2026', 'RTO', '1', 'SKU-A', 'Kurti red', '500', '450', 'Maharashtra'],
  ['E-4', '10-10-2026', 'SHIPPED', '3', 'SKU-C', 'Dupatta', '100', null, 'Gujarat'],
  ['E-5', '20-10-2026', 'DELIVERED', '1', 'SKU-B', 'Saree blue', '300', '280', 'Gujarat'],
  ['E-6', '28-09-2026', 'DELIVERED', '1', 'SKU-B', 'Saree blue', '300', '280', 'Gujarat'],
  ['E-7', '15-10-2026', 'DELIVERED', '0', 'SKU-A', 'Kurti red', '500', '450', 'Gujarat'],
];

/** "Statuses as of" for {@link ordersCsv}. */
export const ORDERS_DATA_AS_OF = '2026-10-31';
export const ORDERS_FILE = 'orders-oct-2026.csv';
/** The file row of the error row (the header is row 1). */
export const ERROR_ROW_NUMBER = 8;

/** RFC 4180 CSV text with CRLF line ends. */
export function csv(rows: Cell[][]): string {
  const field = (value: Cell): string => {
    if (value === null) return '';
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(field).join(',')).join('\r\n') + '\r\n';
}

/** The main orders report (7 rows: 6 valid, 1 error). */
export function ordersCsv(): Buffer {
  return Buffer.from(csv([ORDER_HEADER, ...ORDER_ROWS]), 'utf8');
}

/**
 * An OLDER report (statuses as of 15 Oct) where E-1 was still SHIPPED: imported after the main one it
 * only adds history (E-1's status history becomes SHIPPED → DELIVERED).
 */
export const OLDER_ORDERS_DATA_AS_OF = '2026-10-15';
export const OLDER_ORDERS_FILE = 'orders-as-of-15-oct.csv';
export function olderOrdersCsv(): Buffer {
  return Buffer.from(
    csv([
      ORDER_HEADER,
      ['E-1', '01-10-2026', 'SHIPPED', '2', 'SKU-A', 'Kurti red', '500', '450', 'Gujarat'],
    ]),
    'utf8',
  );
}

export const WORKBOOK_FILE = 'settlement-oct-2026.xlsx';

const PAYMENT_ROWS: Cell[][] = [
  ['Sub Order No', 'Transaction ID', 'Order Date', 'Payment Date', 'Final Settlement Amount'],
  ['E-1', 'T1', '2026-10-01', '2026-10-08', 400],
  ['E-2', 'T2', '2026-10-03', '2026-10-10', 250],
  ['E-3', 'T3', '2026-10-05', '2026-10-12', 400],
  ['E-3', 'T4', '2026-10-05', '2026-10-20', -420],
  ['E-6', 'T5', '2026-09-28', '2026-10-06', 260],
  ['X-9', 'T8', '2026-10-15', '2026-10-18', 99],
];
const ADS_ROWS: Cell[][] = [
  ['Campaign ID', 'Deduction Date', 'Total Ads Cost'],
  ['CMP-1', '2026-10-14', -150],
];

interface ExcelWorkbook {
  addWorksheet(name: string): { getCell(row: number, col: number): { value: unknown } };
  xlsx: { writeBuffer(): Promise<ArrayBuffer> };
}

/** The settlement workbook (.xlsx written by exceljs from api/node_modules: no extra dependency). */
export async function settlementWorkbook(): Promise<Buffer> {
  const apiRequire = createRequire(path.join(API_ROOT, 'package.json'));
  const ExcelJS = apiRequire('exceljs') as { Workbook: new () => ExcelWorkbook };
  const book = new ExcelJS.Workbook();
  for (const [name, rows] of [
    ['Order Payments', PAYMENT_ROWS],
    ['Ads Cost', ADS_ROWS],
  ] as const) {
    const sheet = book.addWorksheet(name);
    rows.forEach((cells, r) =>
      cells.forEach((value, c) => {
        if (value !== null) sheet.getCell(r + 1, c + 1).value = value;
      }),
    );
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** Unit costs the dashboard fixture adds (owner): SKU-C never gets one. */
export const COSTS = [
  { sku: 'SKU-A', effectiveFrom: '2026-09-01', unitCost: '100' },
  { sku: 'SKU-B', effectiveFrom: '2026-10-02', unitCost: '150' },
];

/** Expenses the dashboard fixture adds (owner). */
export const ACCOUNT_EXPENSES = [
  { expenseDate: '2026-10-05', category: 'packaging', amount: '100.00' },
  { expenseDate: '2026-10-25', category: 'staff', amount: '1000.00' },
  { expenseDate: '2026-09-30', category: 'packaging', amount: '50.00' },
];
export const WORKSPACE_EXPENSES = [
  { expenseDate: '2026-10-10', category: 'rent_utilities', amount: '300.00' },
];

/**
 * Hand-calculated dashboard for October 2026 (2026-10-01..31) with the orders report, the workbook,
 * COSTS and the expenses above.
 *
 * Product cost on the order date: E-1 2 × 100 = 200.00; E-2 (03-10, SKU-B from 02-10) 150.00;
 * E-3 100.00; E-5 150.00; E-4 unknown (SKU-C has no cost); E-6 (28-09, before SKU-B's first cost)
 * unknown.
 *
 *                              ACCOUNT order basis | ACCOUNT payment basis | WORKSPACE order | WORKSPACE payment
 * orders in scope             E-1..E-5            | E-1 E-2 E-3 E-6 (first payment in Oct)
 * orders / units                5 / 8              |  4 / 5               |  5 / 8          |  4 / 5
 * order value disc / listed  1460.00 / 1700.00    | 1460.00 / 1600.00    |  same as account
 * prices missing                1 (E-4)            |  0
 * settlement amount / count   579.00 / 6           | 839.00 / 7           |  same as account
 *   order basis: T1 400 + T2 250 + T3 400 + T4 −420 (orders in scope) + T8 99 (own order date)
 *                + CMP-1 −150 (payment date) = 579.00; T5 belongs to E-6 (September) → out.
 *   payment basis: all 7 entries are paid in October = 839.00.
 * product cost known          600.00 (4 known, 1 unknown) | 450.00 (3 known, 1 unknown: E-6)
 * expenses                    1100.00 (100 + 1000; the 30-09 one is out) | 1100.00 | 1400.00 (+300 workspace-wide)
 * estimated contribution      579 − 600 − 1100 = −1121.00 | 839 − 450 − 1100 = −711.00 |
 *                             579 − 600 − 1400 = −1421.00 | 839 − 450 − 1400 = −1011.00
 * flags                       cost unknown 1, without settlement 2 (E-4 E-5), unmatched 1 (T8),
 *                             prices missing 1, cancelled/returned 1 (E-3 RTO, cost 100.00)
 *                             | payment: cost unknown 1, without settlement 0, unmatched 1,
 *                               prices missing 0, cancelled/returned 1
 * status counts               DELIVERED 3, RTO 1, SHIPPED 1 | DELIVERED 3, RTO 1
 */
export const DASHBOARD_OCTOBER = {
  from: '2026-10-01',
  to: '2026-10-31',
  account: {
    order_date: {
      orders: '5',
      units: '8 units',
      orderValue: '₹1,460.00',
      listed: '₹1,700.00',
      settlement: '₹579.00',
      settlementEntries: '6 entries',
      productCost: '₹600.00',
      expenses: '₹1,100.00',
      contribution: '-₹1,121.00',
    },
    payment_date: {
      orders: '4',
      units: '5 units',
      orderValue: '₹1,460.00',
      listed: '₹1,600.00',
      settlement: '₹839.00',
      settlementEntries: '7 entries',
      productCost: '₹450.00',
      expenses: '₹1,100.00',
      contribution: '-₹711.00',
    },
  },
  workspace: {
    order_date: { expenses: '₹1,400.00', contribution: '-₹1,421.00' },
    payment_date: { expenses: '₹1,400.00', contribution: '-₹1,011.00' },
  },
} as const;
