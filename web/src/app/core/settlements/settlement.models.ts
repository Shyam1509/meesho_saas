import { PageQuery, PagedResponse } from '../api/paged-response';
import { ImportRef, UserRef } from '../api/refs';

/** Ledger entry types (one per recognised settlement sheet); the API may add more. */
export type SettlementEntryType =
  | 'order_payment'
  | 'ads_cost'
  | 'referral_payment'
  | 'compensation'
  | 'recovery'
  | 'other';

export const SETTLEMENT_ENTRY_TYPES: readonly SettlementEntryType[] = [
  'order_payment',
  'ads_cost',
  'referral_payment',
  'compensation',
  'recovery',
  'other',
];

/**
 * `matched`: linked to an order. `unmatched`: has a sub order no. but no order is linked (an
 * exception to look at). `account_level`: has no sub order no. (ads, referral, …), so it belongs
 * to the account, never to an order.
 */
export type MatchState = 'matched' | 'unmatched' | 'account_level';

export const MATCH_STATES: readonly MatchState[] = ['matched', 'unmatched', 'account_level'];

export type MatchMethod = 'auto' | 'manual';

export interface SettlementMatch {
  state: MatchState;
  method: MatchMethod | null;
  orderId: string | null;
  orderSubOrderNo: string | null;
  matchedAt: string | null;
  matchedBy: UserRef | null;
  /** Set by a manual unmatch: automatic matching skips the entry until it is matched by hand. */
  autoMatchBlocked: boolean;
}

/**
 * One settlement ledger row, amounts AS REPORTED by Meesho (decimal strings; `null` = the sheet
 * had no value, never 0). TCS and TDS are separate columns, never netted into anything.
 */
export interface SettlementEntry {
  id: string;
  entryType: string;
  sheetName: string | null;
  transactionId: string | null;
  subOrderNo: string | null;
  orderDate: string | null;
  paymentDate: string | null;
  settlementAmount: string | null;
  saleAmount: string | null;
  returnAmount: string | null;
  commissionAmount: string | null;
  shippingCharge: string | null;
  tcsAmount: string | null;
  tdsAmount: string | null;
  recoveryAmount: string | null;
  compensationAmount: string | null;
  isEstimate: boolean;
  supersededByEntryId: string | null;
  importJob: ImportRef;
  createdAt: string;
  match: SettlementMatch;
}

/** Over ALL rows the filters select (not just the page); superseded rows are never summed. */
export interface SettlementTotals {
  /** SUM of `settlementAmount` as reported; `null` when there are no rows. */
  settlementAmount: string | null;
  count: number;
}

/** `GET /accounts/:accountId/settlements`. */
export interface SettlementListResponse extends PagedResponse<SettlementEntry> {
  totals: SettlementTotals;
}

/** `-` prefix = descending. The API's default is `-paymentDate`. */
export type SettlementSort =
  | 'paymentDate'
  | '-paymentDate'
  | 'settlementAmount'
  | '-settlementAmount'
  | 'orderDate'
  | '-orderDate'
  | 'createdAt'
  | '-createdAt';

export const SETTLEMENT_SORTS: readonly SettlementSort[] = [
  'paymentDate',
  '-paymentDate',
  'settlementAmount',
  '-settlementAmount',
  'orderDate',
  '-orderDate',
  'createdAt',
  '-createdAt',
];

export const DEFAULT_SETTLEMENT_SORT: SettlementSort = '-paymentDate';

/** Query of `GET /accounts/:accountId/settlements`. Only the given values are sent. */
export interface SettlementListQuery extends PageQuery {
  sort?: SettlementSort;
  /** Sent as a repeated `entryType` parameter. */
  entryType?: readonly string[];
  /** Payment date from, `YYYY-MM-DD` (inclusive). */
  from?: string;
  /** Payment date to, `YYYY-MM-DD` (inclusive). */
  to?: string;
  /** Prefix of the sub order no. or transaction id. */
  q?: string;
  match?: MatchState;
  /** Sent only when true (the API's default is false). */
  includeSuperseded?: boolean;
}

/** Query of `GET /accounts/:accountId/reconciliation/unmatched-settlements`. */
export interface UnmatchedSettlementsQuery extends PageQuery {
  sort?: SettlementSort;
}

/** The API's default page size for these lists. */
export const SETTLEMENT_PAGE_SIZE = 25;

/** Shown wherever settlement amounts are. */
export const AS_REPORTED_NOTE =
  'Amounts are as reported by Meesho — not profit. TCS and TDS are shown separately and are not tax advice.';

const ENTRY_TYPE_LABELS: Record<SettlementEntryType, string> = {
  order_payment: 'Order payment',
  ads_cost: 'Ads cost',
  referral_payment: 'Referral payment',
  compensation: 'Compensation',
  recovery: 'Recovery',
  other: 'Other',
};

const MATCH_STATE_LABELS: Record<MatchState, string> = {
  matched: 'Matched',
  unmatched: 'Unmatched',
  account_level: 'Account-level',
};

/** `order_payment` → "Order payment"; an unknown type is humanised. */
export function settlementEntryTypeLabel(entryType: string): string {
  return ENTRY_TYPE_LABELS[entryType as SettlementEntryType] ?? humanise(entryType);
}

export function matchStateLabel(state: string): string {
  return MATCH_STATE_LABELS[state as MatchState] ?? humanise(state);
}

function humanise(value: string): string {
  const words = value.replace(/_/g, ' ').trim().toLowerCase();
  return words.length > 0 ? words[0].toUpperCase() + words.slice(1) : value;
}
