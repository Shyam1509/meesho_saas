import { Params } from '@angular/router';

import { DashboardBasis } from '../../core/dashboard/dashboard.models';
import { OrderSettlementFilter } from '../../core/orders/order.models';
import { MatchState } from '../../core/settlements/settlement.models';
import { compactParams } from '../../shared/url-state/url-state';

/**
 * A link from a dashboard number to the list that holds its rows, with the same filters
 * (blueprint §13: every number is traceable). The lists work on the shared selected seller
 * account, so `accountId` (when set) is selected before following the link.
 */
export interface DrillLink {
  path: string;
  queryParams: Params;
  accountId: string | null;
}

/** The dashboard filters a link carries. */
export interface LinkContext {
  from: string;
  to: string;
  basis: DashboardBasis;
  status: readonly string[];
  /**
   * The seller account whose lists the links open; `null` on the all-accounts dashboard, where
   * only the workspace-wide lists (expenses) can be linked.
   */
  accountId: string | null;
}

/**
 * The orders list with the dashboard's order set: by order date (`from` / `to`), or by the
 * earliest matched settlement entry's payment date (`paymentFrom` / `paymentTo`); the status
 * filter is kept unless `status` replaces it. `null` without an account.
 */
export function ordersLink(
  ctx: LinkContext,
  extra: { status?: readonly string[]; settlement?: OrderSettlementFilter } = {},
): DrillLink | null {
  if (ctx.accountId === null) {
    return null;
  }
  const byOrderDate = ctx.basis === 'order_date';
  return {
    path: '/orders',
    queryParams: compactParams({
      status: extra.status ?? ctx.status,
      from: byOrderDate ? ctx.from : null,
      to: byOrderDate ? ctx.to : null,
      paymentFrom: byOrderDate ? null : ctx.from,
      paymentTo: byOrderDate ? null : ctx.to,
      settlement: extra.settlement ?? null,
    }),
    accountId: ctx.accountId,
  };
}

/**
 * The settlement entries list on the same dates: payment date, or (order-date basis) the matched
 * order's order date, else the entry's own. `match: 'account_level'` always uses the payment date:
 * those entries have no order date and the dashboard counts them by payment date.
 *
 * `null` when the list cannot reproduce the number: by order date, a status filter narrows the
 * dashboard's order-linked entries, but the settlements list has no status filter (see
 * {@link settlementsNarrowedByStatus}). Unmatched and account-level entries belong to no order, so
 * the status filter never applies to them and their links stay.
 */
export function settlementsLink(
  ctx: LinkContext,
  extra: { entryType?: string; match?: MatchState } = {},
): DrillLink | null {
  const statusFree = extra.match === 'unmatched' || extra.match === 'account_level';
  if (ctx.accountId === null || (settlementsNarrowedByStatus(ctx) && !statusFree)) {
    return null;
  }
  return settlementsListLink(ctx, ctx.accountId, extra);
}

/**
 * The settlement entries of EVERY status on the same dates, for a card whose number is narrowed by
 * the status filter (the list cannot narrow by order status). `null` without an account.
 */
export function allStatusesSettlementsLink(ctx: LinkContext): DrillLink | null {
  return ctx.accountId === null ? null : settlementsListLink(ctx, ctx.accountId, {});
}

/** True when, by order date, the status filter narrows the settlement amount (order basis only). */
export function settlementsNarrowedByStatus(ctx: LinkContext): boolean {
  return ctx.basis === 'order_date' && ctx.status.length > 0;
}

/**
 * The orders list behind the known product cost: by order date the status filter narrows the cost
 * too; by payment date the cost ignores it, so the link leaves it out. The list shows each order's
 * cost, not a total.
 */
export function productCostLink(ctx: LinkContext): DrillLink | null {
  return ordersLink(ctx.basis === 'payment_date' ? { ...ctx, status: [] } : ctx);
}

function settlementsListLink(
  ctx: LinkContext,
  accountId: string,
  extra: { entryType?: string; match?: MatchState },
): DrillLink {
  const byOrderDate = ctx.basis === 'order_date' && extra.match !== 'account_level';
  return {
    path: '/settlements',
    queryParams: compactParams({
      entryType: extra.entryType ? [extra.entryType] : null,
      from: ctx.from,
      to: ctx.to,
      dateBasis: byOrderDate ? 'order_date' : null,
      match: extra.match ?? null,
    }),
    accountId,
  };
}

/** The Reconciliation tab of the account's settlements. */
export function reconciliationLink(ctx: LinkContext): DrillLink | null {
  return ctx.accountId === null
    ? null
    : { path: '/settlements', queryParams: { tab: 'reconciliation' }, accountId: ctx.accountId };
}

/** Products with orders that have no cost on their order date (`?cost=incomplete`). */
export function productsMissingCostLink(ctx: LinkContext): DrillLink | null {
  return ctx.accountId === null
    ? null
    : { path: '/products', queryParams: { cost: 'incomplete' }, accountId: ctx.accountId };
}

/**
 * Expenses dated in the range: the account's, or on the all-accounts dashboard the workspace-wide
 * ones together with every account's (`scope=workspace&includeAccounts=true`).
 */
export function expensesLink(ctx: LinkContext): DrillLink {
  return {
    path: '/expenses',
    queryParams: compactParams({
      scope: ctx.accountId === null ? 'workspace' : null,
      includeAccounts: ctx.accountId === null,
      from: ctx.from,
      to: ctx.to,
    }),
    accountId: ctx.accountId,
  };
}
