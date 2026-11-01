import {
  flagsOf,
  summarizeEntries,
  summarizeExpenses,
  summarizeOrders,
  trendFromGroups,
} from './dashboard-aggregate';
import type { EntryGroup, ExpenseGroup, OrderGroup } from './dashboard-queries';

function order(overrides: Partial<OrderGroup>): OrderGroup {
  return {
    accountId: '1',
    status: 'DELIVERED',
    bucket: '2026-10-05',
    statusMatch: true,
    cancelledOrReturned: false,
    count: 1,
    units: 1,
    orderValueDiscounted: null,
    orderValueListed: null,
    pricesMissing: 0,
    withoutSettlement: 0,
    costExact: null,
    ordersKnown: 0,
    ordersCostUnknown: 0,
    ordersNoProduct: 0,
    ...overrides,
  };
}

function entry(overrides: Partial<EntryGroup>): EntryGroup {
  return {
    accountId: '1',
    entryType: 'order_payment',
    bucket: '2026-10-05',
    count: 1,
    amount: null,
    unmatched: 0,
    components: {
      sale: null,
      return: null,
      commission: null,
      shipping: null,
      tcs: null,
      tds: null,
      recovery: null,
      compensation: null,
    },
    ...overrides,
  };
}

describe('dashboard aggregation (exact sums of grouped rows)', () => {
  const groups = [
    order({
      status: 'DELIVERED',
      count: 2,
      units: 3,
      orderValueDiscounted: '730.00',
      orderValueListed: '800.00',
      costExact: '533.3333',
      ordersKnown: 2,
    }),
    order({
      status: 'RTO',
      cancelledOrReturned: true,
      orderValueDiscounted: '450.00',
      orderValueListed: '500.00',
      costExact: '120.0000',
      ordersKnown: 1,
    }),
    order({
      status: 'Delivered',
      bucket: '2026-10-12',
      count: 2,
      units: 2,
      orderValueDiscounted: '190.00',
      pricesMissing: 1,
      withoutSettlement: 2,
      ordersCostUnknown: 1,
      ordersNoProduct: 1,
    }),
    order({
      accountId: '2',
      status: 'DELIVERED',
      statusMatch: false,
      count: 5,
      units: 5,
      orderValueDiscounted: '9999.00',
      costExact: '333.3334',
      ordersKnown: 5,
    }),
  ];

  it('order metrics count only status-matching groups; costs and the cancelled warning count every group', () => {
    expect(summarizeOrders(groups)).toEqual({
      count: 5,
      units: 6,
      orderValueDiscounted: '1370.00',
      orderValueListed: '1300.00',
      pricesMissing: 1,
      withoutSettlement: 2,
      statusCounts: [
        { status: 'DELIVERED', count: 2 },
        { status: 'Delivered', count: 2 }, // "D","E" < "D","e" in byte order
        { status: 'RTO', count: 1 },
      ],
      known: '986.67', // 533.3333 + 120.0000 + 333.3334 = 986.6667 → half-up
      knownExact: '986.6667',
      ordersKnown: 8,
      ordersCostUnknown: 1,
      ordersNoProduct: 1,
      cancelledOrReturnedOrders: 1,
      cancelledOrReturnedCost: '120.00',
    });
    expect(summarizeOrders([])).toEqual(
      expect.objectContaining({
        count: 0,
        orderValueDiscounted: null,
        known: null,
        cancelledOrReturnedCost: null,
        statusCounts: [],
      }),
    );
  });

  it('the same status in two accounts is one status count', () => {
    expect(
      summarizeOrders([
        order({ accountId: '1', count: 2 }),
        order({ accountId: '2', count: 3 }),
      ]).statusCounts,
    ).toEqual([{ status: 'DELIVERED', count: 5 }]);
  });

  it('entries: totals, every entry type in order, components summed (null stays null)', () => {
    const summary = summarizeEntries([
      entry({
        amount: '400.00',
        unmatched: 0,
        components: { ...entry({}).components, sale: '900.00', tcs: '-4.50' },
      }),
      entry({ accountId: '2', amount: '-420.00', count: 2, unmatched: 1 }),
      entry({ entryType: 'ads_cost', amount: '-150.00' }),
    ]);
    expect(summary.amount).toBe('-170.00');
    expect([summary.count, summary.unmatched]).toEqual([4, 1]);
    expect(summary.components).toEqual({
      sale: '900.00',
      return: null,
      commission: null,
      shipping: null,
      tcs: '-4.50',
      tds: null,
      recovery: null,
      compensation: null,
    });
    expect(summary.byType).toEqual([
      { entryType: 'order_payment', amount: '-20.00', count: 3 },
      { entryType: 'ads_cost', amount: '-150.00', count: 1 },
      { entryType: 'referral_payment', amount: null, count: 0 },
      { entryType: 'compensation', amount: null, count: 0 },
      { entryType: 'recovery', amount: null, count: 0 },
      { entryType: 'other', amount: null, count: 0 },
    ]);
  });

  it('expenses: account groups vs the workspace-wide group (account id null)', () => {
    const rows: ExpenseGroup[] = [
      { accountId: '1', bucket: '2026-10-05', count: 2, amount: '1100.00' },
      { accountId: '2', bucket: '2026-10-12', count: 1, amount: '200.00' },
      { accountId: null, bucket: '2026-10-05', count: 1, amount: '300.00' },
    ];
    expect(summarizeExpenses(rows)).toEqual({
      amount: '1600.00',
      count: 4,
      accountAmount: '1300.00',
      workspaceAmount: '300.00',
    });
    expect(summarizeExpenses(rows.slice(0, 1)).workspaceAmount).toBeNull();
  });

  it('flags: unknown + no product, without settlement, unmatched, prices missing, cancelled / returned', () => {
    expect(flagsOf(summarizeOrders(groups), summarizeEntries([]))).toEqual({
      costUnknown: 2,
      ordersWithoutSettlement: 2,
      unmatchedSettlements: 0,
      pricesMissing: 1,
      cancelledOrReturned: 1,
    });
  });
});

describe('trend from the same groups', () => {
  const starts = ['2026-09-28', '2026-10-05', '2026-10-12'];

  it('every bucket present; 0 orders and null sums where no row fell; a real zero stays "0.00"', () => {
    const points = trendFromGroups(starts, {
      orders: [
        order({ orderValueDiscounted: '450.00', costExact: '0.3333' }),
        order({ costExact: '0.3333', statusMatch: false }),
      ],
      entries: [entry({ bucket: '2026-10-12', amount: '0.00' })],
      expenses: [],
    });
    expect(points).toEqual([
      {
        bucketStart: '2026-09-28',
        orders: 0,
        orderValueDiscounted: null,
        settlementAmount: null,
        productCostKnown: null,
        expenses: null,
      },
      {
        bucketStart: '2026-10-05',
        orders: 1, // the non-matching status counts in costs only
        orderValueDiscounted: '450.00',
        settlementAmount: null,
        productCostKnown: '0.67', // 0.6666 → half-up, per bucket
        expenses: null,
      },
      {
        bucketStart: '2026-10-12',
        orders: 0,
        orderValueDiscounted: null,
        settlementAmount: '0.00',
        productCostKnown: null,
        expenses: null,
      },
    ]);
  });

  it('a group in a bucket outside the range is a bug, never dropped silently', () => {
    expect(() =>
      trendFromGroups(starts, {
        orders: [order({ bucket: '2026-10-06' })],
        entries: [],
        expenses: [],
      }),
    ).toThrow('unexpected trend bucket');
  });
});
