import type { ExpenseDto } from '../expenses/dto/expense.dto';
import type { OrderSummaryDto } from '../orders/dto/order.dto';
import type { SettlementEntryDto } from '../settlements/dto/settlement.dto';
import type { CsvColumn } from './csv';

/**
 * Columns of the Milestone 7 CSV exports: every field of the matching list item, mapped by the list's own
 * row → DTO functions (so a CSV cell and the list show the same value), plus the source import file and,
 * for traceability, the date that places the row in the dashboard's other basis. Amounts are as reported
 * (DECIMAL text), product cost totals exact (4 dp). Timestamps are ISO-8601 UTC.
 */

export interface OrderExportRow extends OrderSummaryDto {
  firstPaymentDate: string | null;
  sourceImportId: string;
  sourceImportFile: string;
}

export const ORDER_COLUMNS: readonly CsvColumn<OrderExportRow>[] = [
  { header: 'Order ID', kind: 'number', value: (r) => r.id },
  { header: 'Sub Order No', kind: 'text', value: (r) => r.subOrderNo },
  { header: 'Order No', kind: 'text', value: (r) => r.orderNo },
  { header: 'Order Date', kind: 'text', value: (r) => r.orderDate },
  { header: 'Product Name', kind: 'text', value: (r) => r.productName },
  { header: 'SKU', kind: 'text', value: (r) => r.sku },
  { header: 'Size', kind: 'text', value: (r) => r.size },
  { header: 'Quantity', kind: 'number', value: (r) => r.quantity },
  { header: 'Customer State', kind: 'text', value: (r) => r.customerState },
  {
    header: 'Supplier Listed Price (as reported)',
    kind: 'number',
    value: (r) => r.supplierListedPrice,
  },
  {
    header: 'Supplier Discounted Price (as reported)',
    kind: 'number',
    value: (r) => r.supplierDiscountedPrice,
  },
  { header: 'Current Status', kind: 'text', value: (r) => r.currentStatus },
  {
    header: 'Status Observed At (UTC)',
    kind: 'text',
    value: (r) => r.currentStatusObservedAt,
  },
  {
    header: 'Settlement Match',
    kind: 'text',
    value: (r) => (r.settlement.entryCount > 0 ? 'matched' : 'unmatched'),
  },
  {
    header: 'Settlement Entries',
    kind: 'number',
    value: (r) => r.settlement.entryCount,
  },
  {
    header: 'Settlement Amount (as reported)',
    kind: 'number',
    value: (r) => r.settlement.amount,
  },
  {
    header: 'First Payment Date',
    kind: 'text',
    value: (r) => r.firstPaymentDate,
  },
  { header: 'Product ID', kind: 'number', value: (r) => r.productId },
  {
    header: 'Product Cost State',
    kind: 'text',
    value: (r) => r.productCost.state,
  },
  {
    header: 'Unit Cost',
    kind: 'number',
    value: (r) => r.productCost.unitCost,
  },
  {
    header: 'Cost Effective From',
    kind: 'text',
    value: (r) => r.productCost.effectiveFrom,
  },
  {
    header: 'Product Cost Total',
    kind: 'number',
    value: (r) => r.productCost.total,
  },
  {
    header: 'Source Import ID',
    kind: 'number',
    value: (r) => r.sourceImportId,
  },
  {
    header: 'Source Import File',
    kind: 'text',
    value: (r) => r.sourceImportFile,
  },
];

export interface SettlementExportRow extends SettlementEntryDto {
  matchedOrderDate: string | null;
}

export const SETTLEMENT_COLUMNS: readonly CsvColumn<SettlementExportRow>[] = [
  { header: 'Entry ID', kind: 'number', value: (r) => r.id },
  { header: 'Entry Type', kind: 'text', value: (r) => r.entryType },
  { header: 'Sheet', kind: 'text', value: (r) => r.sheetName },
  { header: 'Transaction ID', kind: 'text', value: (r) => r.transactionId },
  { header: 'Sub Order No', kind: 'text', value: (r) => r.subOrderNo },
  { header: 'Order Date (entry)', kind: 'text', value: (r) => r.orderDate },
  { header: 'Payment Date', kind: 'text', value: (r) => r.paymentDate },
  {
    header: 'Settlement Amount (as reported)',
    kind: 'number',
    value: (r) => r.settlementAmount,
  },
  { header: 'Sale Amount', kind: 'number', value: (r) => r.saleAmount },
  { header: 'Return Amount', kind: 'number', value: (r) => r.returnAmount },
  {
    header: 'Meesho Commission',
    kind: 'number',
    value: (r) => r.commissionAmount,
  },
  {
    header: 'Shipping Charge',
    kind: 'number',
    value: (r) => r.shippingCharge,
  },
  { header: 'TCS', kind: 'number', value: (r) => r.tcsAmount },
  { header: 'TDS', kind: 'number', value: (r) => r.tdsAmount },
  { header: 'Recovery', kind: 'number', value: (r) => r.recoveryAmount },
  {
    header: 'Compensation',
    kind: 'number',
    value: (r) => r.compensationAmount,
  },
  { header: 'Is Estimate', kind: 'text', value: (r) => r.isEstimate },
  {
    header: 'Superseded By Entry ID',
    kind: 'number',
    value: (r) => r.supersededByEntryId,
  },
  { header: 'Match State', kind: 'text', value: (r) => r.match.state },
  { header: 'Match Method', kind: 'text', value: (r) => r.match.method },
  {
    header: 'Matched Order ID',
    kind: 'number',
    value: (r) => r.match.orderId,
  },
  {
    header: 'Matched Order Sub Order No',
    kind: 'text',
    value: (r) => r.match.orderSubOrderNo,
  },
  {
    header: 'Matched Order Date',
    kind: 'text',
    value: (r) => r.matchedOrderDate,
  },
  {
    header: 'Matched At (UTC)',
    kind: 'text',
    value: (r) => r.match.matchedAt,
  },
  {
    header: 'Matched By',
    kind: 'text',
    value: (r) => r.match.matchedBy?.email ?? null,
  },
  {
    header: 'Auto Match Blocked',
    kind: 'text',
    value: (r) => r.match.autoMatchBlocked,
  },
  {
    header: 'Source Import ID',
    kind: 'number',
    value: (r) => r.importJob.id,
  },
  {
    header: 'Source Import File',
    kind: 'text',
    value: (r) => r.importJob.originalFilename,
  },
  { header: 'Created At (UTC)', kind: 'text', value: (r) => r.createdAt },
];

export interface ExpenseExportRow extends ExpenseDto {
  sellerAccountName: string | null;
}

export const EXPENSE_COLUMNS: readonly CsvColumn<ExpenseExportRow>[] = [
  { header: 'Expense ID', kind: 'number', value: (r) => r.id },
  { header: 'Expense Date', kind: 'text', value: (r) => r.expenseDate },
  { header: 'Scope', kind: 'text', value: (r) => r.scope },
  {
    header: 'Seller Account ID',
    kind: 'number',
    value: (r) => r.sellerAccountId,
  },
  {
    header: 'Seller Account',
    kind: 'text',
    value: (r) => r.sellerAccountName,
  },
  { header: 'Category', kind: 'text', value: (r) => r.category },
  { header: 'Category Label', kind: 'text', value: (r) => r.categoryLabel },
  { header: 'Description', kind: 'text', value: (r) => r.description },
  { header: 'Amount (INR)', kind: 'number', value: (r) => r.amount },
  { header: 'Created By', kind: 'text', value: (r) => r.createdBy.email },
  { header: 'Created At (UTC)', kind: 'text', value: (r) => r.createdAt },
  { header: 'Updated At (UTC)', kind: 'text', value: (r) => r.updatedAt },
];
