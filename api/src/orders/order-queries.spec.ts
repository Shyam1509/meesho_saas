import { scopeOf } from '../common/sql/account-scope';
import {
  addStatusFilter,
  FIRST_PAYMENT_DATE_SQL,
  firstPaymentInRangeSql,
  orderFirstPaymentJoin,
  orderOrderBy,
  orderScope,
  toOrderSummaryDto,
  toStatusEventDto,
  workspaceOrderScope,
} from './order-queries';
import { orderListFilter } from './orders.service';

describe('order mapping', () => {
  it('maps a row explicitly: ids as strings, prices as reported, ISO observation time', () => {
    expect(
      toOrderSummaryDto(
        {
          id: 41,
          subOrderNo: 'SO-101',
          orderNo: null,
          orderDate: '2026-10-01',
          productName: 'Red Kurti',
          sku: 'KUR-RED-M',
          size: null,
          quantity: 2,
          customerState: 'Gujarat',
          supplierListedPrice: '499.00',
          supplierDiscountedPrice: null,
          currentStatus: 'Delivered',
          currentStatusObservedAt: new Date('2026-10-10T18:29:59.999Z'),
          productId: 7,
          costUnitCost: '549.5000',
          costEffectiveFrom: '2026-10-01',
          costTotal: '1099.0000',
        },
        { entryCount: 1, amount: '420.15' },
      ),
    ).toEqual({
      id: '41',
      subOrderNo: 'SO-101',
      orderNo: null,
      orderDate: '2026-10-01',
      productName: 'Red Kurti',
      sku: 'KUR-RED-M',
      size: null,
      quantity: 2,
      customerState: 'Gujarat',
      supplierListedPrice: '499.00',
      supplierDiscountedPrice: null,
      currentStatus: 'Delivered',
      currentStatusObservedAt: '2026-10-10T18:29:59.999Z',
      settlement: { entryCount: 1, amount: '420.15' },
      productId: '7',
      productCost: {
        state: 'known',
        unitCost: '549.5000',
        effectiveFrom: '2026-10-01',
        total: '1099.0000',
      },
    });
  });

  it('maps a status event with its import', () => {
    expect(
      toStatusEventDto({
        id: 9,
        status: 'SHIPPED',
        observedAt: new Date('2026-10-10T18:29:59.999Z'),
        importJobId: 3,
        importOriginalFilename: 'orders.csv',
        importCreatedAt: new Date('2026-10-11T00:00:00.000Z'),
      }),
    ).toEqual({
      id: '9',
      status: 'SHIPPED',
      observedAt: '2026-10-10T18:29:59.999Z',
      importJob: {
        id: '3',
        originalFilename: 'orders.csv',
        createdAt: '2026-10-11T00:00:00.000Z',
      },
    });
  });
});

describe('order list SQL', () => {
  const scope = scopeOf({ id: 3, workspaceId: 2 });

  it('ORDER BY from the allowlist with an id tie-break', () => {
    expect(orderOrderBy('-orderDate')).toBe('o.order_date DESC, o.id DESC');
    expect(orderOrderBy('subOrderNo')).toBe('o.sub_order_no ASC, o.id ASC');
    expect(orderOrderBy('-updatedAt')).toBe('o.updated_at DESC, o.id DESC');
  });

  it('status filter compares raw statuses exactly (binary) and de-duplicates', () => {
    const filter = orderScope(scope);
    addStatusFilter(filter, ['DELIVERED', 'Delivered', 'DELIVERED']);
    expect(filter.conditions[2]).toBe(
      'o.current_status COLLATE utf8mb4_bin IN (:statuses)',
    );
    expect(filter.replacements.statuses).toEqual(['DELIVERED', 'Delivered']);
    const none = orderScope(scope);
    addStatusFilter(none, []);
    expect(none.conditions).toHaveLength(2);
  });

  it('search: escaped prefix on sub order / SKU, escaped contains on product name; settlement filter', () => {
    const filter = orderListFilter(scope, {
      q: '100%',
      from: '2026-10-02',
      settlement: 'unmatched',
    });
    expect(filter.replacements).toEqual(
      expect.objectContaining({
        qPrefix: '100!%%',
        qContains: '%100!%%',
        from: '2026-10-02',
      }),
    );
    expect(filter.conditions.join(' ')).toContain(
      "o.product_name LIKE :qContains ESCAPE '!'",
    );
    expect(filter.conditions[filter.conditions.length - 1]).toMatch(
      /^NOT EXISTS \(SELECT 1 FROM settlement_entries s/,
    );
    expect(
      orderListFilter(scope, { settlement: 'matched' }).conditions[2],
    ).toMatch(/^EXISTS .*superseded_by_entry_id IS NULL\)$/s);
  });
});

describe('order list SQL: first payment date (M7 payment-date basis)', () => {
  const scope = scopeOf({ id: 3, workspaceId: 2 });
  const flat = (sql: string) => sql.replace(/\s+/g, ' ');

  it('paymentFrom / paymentTo: orders whose earliest matched, non-superseded entry payment date is in range (one grouped, non-correlated subquery)', () => {
    const filter = orderListFilter(scope, {
      paymentFrom: '2026-10-01',
      paymentTo: '2026-10-31',
    });
    expect(filter.conditions).toHaveLength(3);
    expect(flat(filter.conditions[2])).toBe(
      '(o.seller_account_id, o.id) IN (SELECT s.seller_account_id, s.order_id FROM settlement_entries s' +
        ' WHERE s.seller_account_id = :sellerAccountId AND s.order_id IS NOT NULL AND s.superseded_by_entry_id IS NULL' +
        ' GROUP BY s.seller_account_id, s.order_id' +
        ' HAVING MIN(s.payment_date) >= :paymentFrom AND MIN(s.payment_date) <= :paymentTo)',
    );
    expect(filter.replacements).toEqual({
      sellerAccountId: 3,
      workspaceId: 2,
      paymentFrom: '2026-10-01',
      paymentTo: '2026-10-31',
    });
    // One bound only; a workspace scope reads every account of the workspace.
    expect(
      flat(firstPaymentInRangeSql({ paymentTo: '2026-10-31' }, false)),
    ).toContain(
      'WHERE s.seller_account_id IN (SELECT wa.id FROM seller_accounts wa WHERE wa.workspace_id = :workspaceId)',
    );
    expect(
      flat(firstPaymentInRangeSql({ paymentTo: '2026-10-31' }, false)),
    ).toMatch(/HAVING MIN\(s\.payment_date\) <= :paymentTo\)$/);
  });

  it('the dashboard join reads the same grouping: has a settlement = a row, first payment = MIN', () => {
    expect(flat(orderFirstPaymentJoin(true))).toBe(
      'LEFT JOIN (SELECT s.seller_account_id, s.order_id, MIN(s.payment_date) AS first_payment' +
        ' FROM settlement_entries s WHERE s.seller_account_id = :sellerAccountId AND s.order_id IS NOT NULL' +
        ' AND s.superseded_by_entry_id IS NULL GROUP BY s.seller_account_id, s.order_id) fp' +
        ' ON fp.seller_account_id = o.seller_account_id AND fp.order_id = o.id',
    );
    expect(FIRST_PAYMENT_DATE_SQL).toMatch(
      /^\(SELECT MIN\(s\.payment_date\) FROM settlement_entries s\s+WHERE s\.seller_account_id = o\.seller_account_id AND s\.order_id = o\.id\s+AND s\.superseded_by_entry_id IS NULL\)$/,
    );
  });

  it('without them nothing changes; the workspace scope filters on the workspace only', () => {
    expect(orderListFilter(scope, {}).conditions).toEqual(
      orderScope(scope).conditions,
    );
    expect(workspaceOrderScope(2)).toEqual({
      conditions: ['o.workspace_id = :workspaceId'],
      replacements: { workspaceId: 2 },
    });
  });
});
