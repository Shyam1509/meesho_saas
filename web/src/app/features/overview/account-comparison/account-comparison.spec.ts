import { workspaceDashboard } from '../../../../testing/test-data';
import { comparisonTotals, sortComparison } from './account-comparison';

describe('account comparison helpers', () => {
  const rows = workspaceDashboard().accounts ?? [];
  const names = (sorted: { displayName: string }[]) => sorted.map((r) => r.displayName);

  it('totals the account rows exactly, a column with no amount at all stays null', () => {
    expect(comparisonTotals(rows)).toEqual({
      orders: 5,
      orderValueDiscounted: '2297.50',
      settlementAmount: '1130.15',
      productCostKnown: '600.00',
      expenses: '350.00',
      contribution: '180.15',
    });
    expect(comparisonTotals([rows[2]]).settlementAmount).toBeNull();
    expect(comparisonTotals([])).toEqual({
      orders: 0,
      orderValueDiscounted: null,
      settlementAmount: null,
      productCostKnown: null,
      expenses: null,
      contribution: null,
    });
  });

  it('sorts by name, counts and amounts; a missing amount is last in both directions', () => {
    expect(names(sortComparison(rows, 'displayName'))).toEqual(['Main store', 'Old shop', 'Outlet']);
    expect(names(sortComparison(rows, '-displayName'))).toEqual(['Outlet', 'Old shop', 'Main store']);
    expect(names(sortComparison(rows, '-orders'))).toEqual(['Main store', 'Outlet', 'Old shop']);
    expect(names(sortComparison(rows, '-settlementAmount'))).toEqual([
      'Main store',
      'Outlet',
      'Old shop',
    ]);
    expect(names(sortComparison(rows, 'settlementAmount'))).toEqual([
      'Outlet',
      'Main store',
      'Old shop',
    ]);
    expect(names(sortComparison(rows, 'contribution'))).toEqual(['Old shop', 'Outlet', 'Main store']);
    expect(names(sortComparison(rows, '-expenses'))).toEqual(['Main store', 'Old shop', 'Outlet']);
    expect(names(sortComparison(rows, 'expenses'))).toEqual(['Old shop', 'Main store', 'Outlet']);
  });
});
