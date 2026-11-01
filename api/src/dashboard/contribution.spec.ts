import {
  CONTRIBUTION_FORMULA,
  estimatedContribution,
  isComplete,
} from './contribution';

describe('estimated contribution and flags', () => {
  it('= settlement amount − known product cost − expenses (hand-calculated fixture numbers)', () => {
    expect(
      estimatedContribution({
        settlementAmount: '829.00',
        productCostKnown: '986.67',
        expenses: '1100.00',
      }),
    ).toBe('-1257.67');
    expect(
      estimatedContribution({
        settlementAmount: '1640.00',
        productCostKnown: '1654.33',
        expenses: '1600.00',
      }),
    ).toBe('-1614.33');
    expect(
      estimatedContribution({
        settlementAmount: null,
        productCostKnown: null,
        expenses: null,
      }),
    ).toBeNull();
    expect(CONTRIBUTION_FORMULA).toBe(
      'settlement amount − known product cost − expenses',
    );
  });

  it('complete only when no flag is raised (cancelled / returned orders included)', () => {
    const none = {
      costUnknown: 0,
      ordersWithoutSettlement: 0,
      unmatchedSettlements: 0,
      pricesMissing: 0,
      cancelledOrReturned: 0,
    };
    expect(isComplete(none)).toBe(true);
    for (const key of Object.keys(none) as (keyof typeof none)[]) {
      expect(isComplete({ ...none, [key]: 1 })).toBe(false);
    }
  });
});
