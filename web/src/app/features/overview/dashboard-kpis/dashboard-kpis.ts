import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  CONTRIBUTION_FORMULA,
  CONTRIBUTION_HELP,
  Dashboard,
  EXPENSES_HELP,
  NOT_PAYOUT_NOTE,
  ORDER_VALUE_CAVEAT,
  PRODUCT_COST_HELP,
  SETTLEMENT_AMOUNT_HELP,
  isCancelledOrReturned,
} from '../../../core/dashboard/dashboard.models';
import { Amount } from '../../../shared/amount/amount';
import { formatInr, plural } from '../../../shared/format/format';
import { CountPipe } from '../../../shared/format/format.pipes';
import {
  DrillLink as DrillLinkTarget,
  LinkContext,
  allStatusesSettlementsLink,
  expensesLink,
  ordersLink,
  productCostLink,
  productsMissingCostLink,
  reconciliationLink,
  settlementsLink,
  settlementsNarrowedByStatus,
} from '../dashboard-links';
import { DrillLink } from '../drill-link/drill-link';

/** One reason the estimated contribution is incomplete, with its count and where to look. */
export interface IncompleteReason {
  key:
    | 'costUnknown'
    | 'ordersWithoutSettlement'
    | 'unmatchedSettlements'
    | 'pricesMissing'
    | 'cancelledOrReturned';
  count: number;
  text: string;
  link: DrillLinkTarget | null;
  linkText: string;
  /** A second place to look (the Reconciliation tab for unmatched entries). */
  extraLink?: DrillLinkTarget | null;
  extraLinkText?: string;
}

/**
 * The headline numbers: orders, order value (as reported), settlement amount (as reported),
 * known product cost, expenses and the ESTIMATED contribution with its formula and every reason it
 * is incomplete. Each number links to the list behind it when that list exists for the scope.
 */
@Component({
  selector: 'app-dashboard-kpis',
  imports: [Amount, CountPipe, DrillLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './dashboard-kpis.html',
})
export class DashboardKpis {
  readonly dashboard = input.required<Dashboard>();
  readonly ctx = input.required<LinkContext>();

  protected readonly orderValueCaveat = ORDER_VALUE_CAVEAT;
  protected readonly settlementHelp = SETTLEMENT_AMOUNT_HELP;
  protected readonly productCostHelp = PRODUCT_COST_HELP;
  protected readonly expensesHelp = EXPENSES_HELP;
  protected readonly formula = CONTRIBUTION_FORMULA;
  protected readonly contributionHelp = CONTRIBUTION_HELP;
  protected readonly notPayout = NOT_PAYOUT_NOTE;
  protected readonly plural = plural;

  protected readonly workspace = computed(() => this.ctx().accountId === null);
  protected readonly ordersLink = computed(() => ordersLink(this.ctx()));
  protected readonly settlementsLink = computed(() => settlementsLink(this.ctx()));
  /** By order date with statuses: the settlement amount is narrowed, the list is not. */
  protected readonly settlementsNarrowed = computed(() => settlementsNarrowedByStatus(this.ctx()));
  protected readonly allStatusesLink = computed(() => allStatusesSettlementsLink(this.ctx()));
  protected readonly productCostLink = computed(() => productCostLink(this.ctx()));
  /** What the status filter did to the estimate; `null` without one. */
  protected readonly statusNote = computed(() => {
    const f = this.dashboard().filters;
    if (f.statuses.length === 0) {
      return null;
    }
    const statuses = f.statuses.join(', ');
    return f.basis === 'order_date'
      ? `Status filter (${statuses}): only those orders’ settlement entries and product costs are included; account-level and unmatched entries and expenses count in full.`
      : `Status filter (${statuses}): by payment date it narrows only the order counts and order value — this estimate covers orders of every status.`;
  });
  /** Nothing to estimate: no "Inputs complete" badge for an empty result. */
  protected readonly hasEstimate = computed(() => this.dashboard().contribution.amount !== null);
  protected readonly expensesLink = computed(() => expensesLink(this.ctx()));
  protected readonly missingCostLink = computed(() => productsMissingCostLink(this.ctx()));
  protected readonly ordersWithoutCost = computed(() => {
    const cost = this.dashboard().productCost;
    return cost.ordersCostUnknown + cost.ordersNoProduct;
  });

  /** "Includes ₹X for N cancelled/RTO/returned orders." for the product cost card, else `null`. */
  protected readonly cancelledCostNote = computed(() => {
    const cost = this.dashboard().productCost;
    return cost.cancelledOrReturnedOrders > 0 && cost.cancelledOrReturnedCost !== null
      ? `Includes ${formatInr(cost.cancelledOrReturnedCost)} for ${plural(cost.cancelledOrReturnedOrders, 'cancelled/RTO/returned order')}.`
      : null;
  });

  /**
   * The orders list with the cancelled / RTO / returned statuses among the dashboard's orders.
   * `null` when the list cannot hold exactly those orders: no account, none of the shown statuses
   * matches, or by payment date with a status filter (the cost ignores it there; the status counts
   * do not).
   */
  private readonly cancelledLink = computed<DrillLinkTarget | null>(() => {
    const ctx = this.ctx();
    const statuses = this.dashboard()
      .orders.statusCounts.map((s) => s.status)
      .filter((s) => isCancelledOrReturned(s));
    if (statuses.length === 0 || (ctx.basis === 'payment_date' && ctx.status.length > 0)) {
      return null;
    }
    return ordersLink(ctx, { status: statuses });
  });

  /** The flags with a count above 0, in a fixed order. */
  protected readonly reasons = computed<IncompleteReason[]>(() => {
    const flags = this.dashboard().contribution.flags;
    const cost = this.dashboard().productCost;
    const ctx = this.ctx();
    const cancelled = flags.cancelledOrReturned;
    const one = cancelled === 1;
    const cancelledOrders = one
      ? '1 order is cancelled, RTO or returned'
      : `${plural(cancelled, 'order')} are cancelled, RTO or returned`;
    const reasons: IncompleteReason[] = [
      {
        key: 'costUnknown',
        count: flags.costUnknown,
        text: `${plural(flags.costUnknown, 'order')} without a known product cost (left out of the cost, not counted as ₹0)`,
        link: productsMissingCostLink(ctx),
        linkText: 'Products missing a cost',
      },
      {
        key: 'ordersWithoutSettlement',
        count: flags.ordersWithoutSettlement,
        text: `${plural(flags.ordersWithoutSettlement, 'order')} without a matched settlement entry (not settled yet, or unmatched)`,
        link: ordersLink(ctx, { settlement: 'unmatched' }),
        linkText: 'These orders',
      },
      {
        key: 'unmatchedSettlements',
        count: flags.unmatchedSettlements,
        text: `${plural(flags.unmatchedSettlements, 'settlement entry', 'settlement entries')} not matched to an order`,
        link: settlementsLink(ctx, { match: 'unmatched' }),
        linkText: 'These entries',
        extraLink: reconciliationLink(ctx),
        extraLinkText: 'Reconciliation',
      },
      {
        key: 'pricesMissing',
        count: flags.pricesMissing,
        text: `${plural(flags.pricesMissing, 'order')} without a reported price (left out of the order value)`,
        link: ordersLink(ctx),
        linkText: 'Orders in this range',
      },
      {
        key: 'cancelledOrReturned',
        count: cancelled,
        text:
          cost.cancelledOrReturnedCost === null
            ? `${cancelledOrders} — ${one ? 'its' : 'their'} product cost is not known, so nothing is deducted for ${one ? 'it' : 'them'}`
            : `${cancelledOrders} — ${one ? 'its' : 'their'} product cost (${formatInr(cost.cancelledOrReturnedCost)}) is still deducted, so the estimate may be too low`,
        link: this.cancelledLink(),
        linkText: one ? 'This order' : 'These orders',
      },
    ];
    return reasons.filter((r) => r.count > 0);
  });
}
