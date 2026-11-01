import { firstPaymentInRangeSql, STATUS_IN_SQL } from '../orders/order-queries';
import { orderListFilter } from '../orders/orders.service';
import { orderBasisRangeSql } from '../settlements/settlement-entry-queries';
import { settlementListFilter } from '../settlements/settlements.service';
import {
  costFilter,
  entryFilter,
  expenseFilter,
  orderFilter,
  statusMatchSql,
  undatedEntryFilter,
  type MetricScope,
} from './dashboard-queries';
import type { ResolvedDashboardFilters } from './dashboard-range';

const account: MetricScope = {
  kind: 'account',
  workspaceId: 2,
  sellerAccountId: 3,
};
const workspace: MetricScope = { kind: 'workspace', workspaceId: 2 };

function filters(
  overrides: Partial<ResolvedDashboardFilters> = {},
): ResolvedDashboardFilters {
  return {
    from: '2026-10-01',
    to: '2026-10-31',
    basis: 'order_date',
    statuses: [],
    granularity: 'day',
    ...overrides,
  };
}

/**
 * One number, one source: the dashboard's row sets must be exactly the lists' filters with the same values.
 */
describe('dashboard row sets = the list filters', () => {
  const scope = { workspaceId: 2, sellerAccountId: 3 };

  it('order_date basis: orders = GET .../orders?from&to&status; every order counts in the order metrics', () => {
    const f = filters({ statuses: ['DELIVERED'] });
    expect(orderFilter(account, f)).toEqual(
      orderListFilter(scope, {
        status: ['DELIVERED'],
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    );
    expect(costFilter(account, f)).toEqual(orderFilter(account, f));
    expect(statusMatchSql(f)).toBe('1');
  });

  it('payment_date basis: ?paymentFrom&paymentTo (first payment date); the status narrows the order metrics only', () => {
    const f = filters({ basis: 'payment_date', statuses: ['DELIVERED'] });
    expect(orderFilter(account, f)).toEqual(
      orderListFilter(scope, {
        status: ['DELIVERED'],
        paymentFrom: '2026-10-01',
        paymentTo: '2026-10-31',
      }),
    );
    const costs = costFilter(account, f);
    const list = orderListFilter(scope, {
      paymentFrom: '2026-10-01',
      paymentTo: '2026-10-31',
    });
    expect(costs.conditions).toEqual(list.conditions);
    expect(costs.conditions).toContain(
      firstPaymentInRangeSql(
        { paymentFrom: '2026-10-01', paymentTo: '2026-10-31' },
        true,
      ),
    );
    expect(costs.replacements).toEqual({
      ...list.replacements,
      statuses: ['DELIVERED'],
    });
    expect(statusMatchSql(f)).toBe(`(${STATUS_IN_SQL})`);
  });

  it('settlement entries = GET .../settlements?dateBasis&from&to (superseded excluded)', () => {
    for (const basis of ['order_date', 'payment_date'] as const) {
      const list = settlementListFilter(scope, {
        dateBasis: basis,
        from: '2026-10-01',
        to: '2026-10-31',
        includeSuperseded: false,
      });
      const dash = entryFilter(account, filters({ basis }));
      expect(new Set(dash.conditions)).toEqual(new Set(list.conditions));
      expect(dash.replacements).toEqual(list.replacements);
    }
    expect(entryFilter(account, filters()).conditions).toContain(
      orderBasisRangeSql({ from: '2026-10-01', to: '2026-10-31' }, true),
    );
  });

  it('order_date basis with statuses: the matched branch also checks the status; payment basis ignores it', () => {
    const f = entryFilter(account, filters({ statuses: ['DELIVERED'] }));
    expect(f.conditions).toContain(
      orderBasisRangeSql({ from: '2026-10-01', to: '2026-10-31' }, true, true),
    );
    expect(f.conditions.join(' ')).toContain(
      'bo.current_status COLLATE utf8mb4_bin IN (:statuses)',
    );
    expect(f.replacements.statuses).toEqual(['DELIVERED']);
    expect(
      entryFilter(
        account,
        filters({ basis: 'payment_date', statuses: ['DELIVERED'] }),
      ).replacements.statuses,
    ).toBeUndefined();
  });

  it('undated entries: no date in the basis, not superseded', () => {
    const order = undatedEntryFilter(account, filters()).conditions.slice(2);
    expect(order[0]).toBe('se.superseded_by_entry_id IS NULL');
    expect(order[1].replace(/\s+/g, ' ')).toBe(
      '((se.order_id IS NULL AND se.sub_order_no IS NOT NULL AND se.order_date IS NULL)' +
        ' OR (se.order_id IS NULL AND se.sub_order_no IS NULL AND se.payment_date IS NULL))',
    );
    expect(
      undatedEntryFilter(account, filters({ basis: 'payment_date' }))
        .conditions[3],
    ).toBe('se.payment_date IS NULL');
  });

  it('workspace scope: every account of the workspace (sub-queries scoped to it too); expenses include the workspace-wide ones', () => {
    const orders = orderFilter(workspace, filters({ basis: 'payment_date' }));
    expect(orders.conditions[0]).toBe('o.workspace_id = :workspaceId');
    expect(orders.conditions[1]).toContain(
      'SELECT wa.id FROM seller_accounts wa WHERE wa.workspace_id = :workspaceId',
    );
    const entries = entryFilter(workspace, filters());
    expect(entries.conditions[0]).toBe('se.workspace_id = :workspaceId');
    expect(entries.conditions[2]).toContain('bo.workspace_id = :workspaceId');
    expect(expenseFilter(workspace, filters())).toEqual({
      conditions: [
        'e.workspace_id = :workspaceId',
        'e.expense_date >= :from',
        'e.expense_date <= :to',
      ],
      replacements: { workspaceId: 2, from: '2026-10-01', to: '2026-10-31' },
    });
    expect(expenseFilter(account, filters()).conditions).toEqual([
      'e.workspace_id = :workspaceId',
      'e.seller_account_id = :sellerAccountId',
      'e.expense_date >= :from',
      'e.expense_date <= :to',
    ]);
  });
});
