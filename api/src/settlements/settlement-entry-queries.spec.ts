import { scopeOf } from '../common/sql/account-scope';
import {
  ENTRY_ORDER_BASIS_DATE_SQL,
  ENTRY_ORDER_JOIN,
  entryOrderBy,
  entryScope,
  matchState,
  orderBasisRangeSql,
  toSettlementEntryDto,
  type SettlementEntryRow,
} from './settlement-entry-queries';
import { settlementListFilter } from './settlements.service';

const created = new Date('2026-10-12T05:00:00.000Z');

function row(overrides: Partial<SettlementEntryRow> = {}): SettlementEntryRow {
  return {
    id: 501,
    entryType: 'order_payment',
    sheetName: 'Order Payments',
    transactionId: 'TXN-9',
    subOrderNo: 'SO-101',
    orderDate: '2026-10-01',
    paymentDate: '2026-10-08',
    settlementAmount: '420.15',
    saleAmount: '499.00',
    returnAmount: null,
    commissionAmount: '-60.00',
    shippingCharge: null,
    tcsAmount: '-4.23',
    tdsAmount: '0.00',
    recoveryAmount: null,
    compensationAmount: null,
    isEstimate: 0,
    supersededByEntryId: null,
    createdAt: created,
    orderId: 41,
    matchMethod: 'auto',
    matchedAt: new Date('2026-10-12T05:00:01.000Z'),
    autoMatchBlocked: 0,
    orderSubOrderNo: 'SO-101',
    matchedById: null,
    matchedByDisplayName: null,
    matchedByEmail: null,
    importJobId: 12,
    importOriginalFilename: 'payments-oct.xlsx',
    importCreatedAt: created,
    ...overrides,
  };
}

describe('toSettlementEntryDto', () => {
  it('maps every field explicitly: ids as strings, amounts as reported (0.00 ≠ null), ISO timestamps', () => {
    expect(toSettlementEntryDto(row())).toEqual({
      id: '501',
      entryType: 'order_payment',
      sheetName: 'Order Payments',
      transactionId: 'TXN-9',
      subOrderNo: 'SO-101',
      orderDate: '2026-10-01',
      paymentDate: '2026-10-08',
      settlementAmount: '420.15',
      saleAmount: '499.00',
      returnAmount: null,
      commissionAmount: '-60.00',
      shippingCharge: null,
      tcsAmount: '-4.23',
      tdsAmount: '0.00',
      recoveryAmount: null,
      compensationAmount: null,
      isEstimate: false,
      supersededByEntryId: null,
      importJob: {
        id: '12',
        originalFilename: 'payments-oct.xlsx',
        createdAt: '2026-10-12T05:00:00.000Z',
      },
      createdAt: '2026-10-12T05:00:00.000Z',
      match: {
        state: 'matched',
        method: 'auto',
        orderId: '41',
        orderSubOrderNo: 'SO-101',
        matchedAt: '2026-10-12T05:00:01.000Z',
        matchedBy: null,
        autoMatchBlocked: false,
      },
    });
  });

  it('a manual match names the user; an unmatched, blocked entry has no order', () => {
    const manual = toSettlementEntryDto(
      row({
        matchMethod: 'manual',
        matchedById: 7,
        matchedByDisplayName: 'Alice',
        matchedByEmail: 'alice@example.test',
      }),
    );
    expect(manual.match.matchedBy).toEqual({
      id: '7',
      displayName: 'Alice',
      email: 'alice@example.test',
    });
    const blocked = toSettlementEntryDto(
      row({
        orderId: null,
        matchMethod: null,
        matchedAt: null,
        orderSubOrderNo: null,
        autoMatchBlocked: 1,
        supersededByEntryId: 600,
      }),
    );
    expect(blocked.match).toEqual({
      state: 'unmatched',
      method: null,
      orderId: null,
      orderSubOrderNo: null,
      matchedAt: null,
      matchedBy: null,
      autoMatchBlocked: true,
    });
    expect(blocked.supersededByEntryId).toBe('600');
  });

  it('never returns internal columns (fingerprint, import row, workspace)', () => {
    const dto = toSettlementEntryDto(
      row({
        entryFingerprint: 'f'.repeat(64),
        importRowId: 3,
      } as Partial<SettlementEntryRow>),
    );
    expect(Object.keys(dto)).not.toEqual(
      expect.arrayContaining(['entryFingerprint']),
    );
    expect(JSON.stringify(dto)).not.toContain('fff');
  });
});

describe('matchState', () => {
  it.each([
    [41, 'SO-1', 'matched'],
    [41, null, 'matched'],
    [null, 'SO-1', 'unmatched'],
    [null, null, 'account_level'],
  ] as const)('order %p, sub order %p → %s', (orderId, subOrderNo, state) => {
    expect(matchState(orderId, subOrderNo)).toBe(state);
  });
});

describe('settlement list SQL', () => {
  const scope = scopeOf({ id: 3, workspaceId: 2 });

  it('always scopes to the resolved workspace + account', () => {
    expect(entryScope(scope)).toEqual({
      conditions: [
        'se.seller_account_id = :sellerAccountId',
        'se.workspace_id = :workspaceId',
      ],
      replacements: { sellerAccountId: 3, workspaceId: 2 },
    });
  });

  it('ORDER BY comes from the allowlist only, with an id tie-break in the same direction', () => {
    expect(entryOrderBy('-paymentDate')).toBe(
      'se.payment_date DESC, se.id DESC',
    );
    expect(entryOrderBy('settlementAmount')).toBe(
      'se.settlement_amount ASC, se.id ASC',
    );
  });

  it('filters bind every value; search escapes LIKE wildcards; superseded rows excluded by default', () => {
    const filter = settlementListFilter(scope, {
      entryType: ['ads_cost', 'ads_cost', 'recovery'],
      from: '2026-10-01',
      to: '2026-10-31',
      q: 'TXN_1%',
      match: 'unmatched',
      includeSuperseded: false,
    });
    expect(filter.conditions.slice(2)).toEqual([
      'se.entry_type IN (:entryTypes)',
      'se.payment_date >= :from',
      'se.payment_date <= :to',
      "(se.sub_order_no LIKE :qPrefix ESCAPE '!' OR se.transaction_id LIKE :qPrefix ESCAPE '!')",
      '(se.order_id IS NULL AND se.sub_order_no IS NOT NULL)',
      'se.superseded_by_entry_id IS NULL',
    ]);
    expect(filter.replacements).toEqual({
      sellerAccountId: 3,
      workspaceId: 2,
      entryTypes: ['ads_cost', 'recovery'],
      from: '2026-10-01',
      to: '2026-10-31',
      qPrefix: 'TXN!_1!%%',
    });
    const all = settlementListFilter(scope, { includeSuperseded: true });
    expect(all.conditions).toHaveLength(2);
  });
});

describe('settlement list SQL: dateBasis (M7)', () => {
  const scope = scopeOf({ id: 3, workspaceId: 2 });
  const flat = (sql: string) => sql.replace(/\s+/g, ' ');

  it('payment_date (default, as before) and order_date filter from / to on different dates', () => {
    const range = {
      from: '2026-10-01',
      to: '2026-10-31',
      includeSuperseded: false,
    };
    const byDefault = settlementListFilter(scope, range);
    expect(byDefault.conditions.slice(2, 4)).toEqual([
      'se.payment_date >= :from',
      'se.payment_date <= :to',
    ]);
    expect(
      settlementListFilter(scope, { ...range, dateBasis: 'payment_date' }),
    ).toEqual(byDefault);
    const byOrder = settlementListFilter(scope, {
      ...range,
      dateBasis: 'order_date',
    });
    expect(byOrder.conditions.slice(2)).toEqual([
      orderBasisRangeSql(range, true),
      'se.superseded_by_entry_id IS NULL',
    ]);
    expect(byOrder.replacements).toEqual(byDefault.replacements);
    // No bound, no condition (as for the payment date).
    expect(
      settlementListFilter(scope, {
        dateBasis: 'order_date',
        includeSuperseded: true,
      }).conditions,
    ).toHaveLength(2);
  });

  it('order-basis range: matched → its order dated in range (grouped subquery), unmatched → own order date, account-level → payment date', () => {
    expect(flat(orderBasisRangeSql({ from: '2026-10-01' }, true))).toBe(
      '((se.order_id IS NOT NULL AND (se.seller_account_id, se.order_id) IN (' +
        ' SELECT bo.seller_account_id, bo.id FROM orders bo' +
        ' WHERE bo.seller_account_id = :sellerAccountId AND bo.order_date >= :from))' +
        ' OR (se.order_id IS NULL AND se.sub_order_no IS NOT NULL AND se.order_date >= :from)' +
        ' OR (se.order_id IS NULL AND se.sub_order_no IS NULL AND se.payment_date >= :from))',
    );
  });

  it('order-basis date (SELECT form, with its join): account-level → payment date; else the matched order date first, else the entry order date', () => {
    expect(flat(ENTRY_ORDER_BASIS_DATE_SQL)).toBe(
      '(CASE WHEN se.order_id IS NULL AND se.sub_order_no IS NULL THEN se.payment_date' +
        ' ELSE COALESCE(mo.order_date, se.order_date) END)',
    );
    expect(flat(ENTRY_ORDER_JOIN)).toBe(
      'LEFT JOIN orders mo ON mo.seller_account_id = se.seller_account_id AND mo.id = se.order_id',
    );
  });
});
