import { ariaSort, nextSort, parseSort } from './sort';

describe('sort helpers', () => {
  it('parseSort reads the API’s "-" prefix as descending', () => {
    expect(parseSort('-orderDate')).toEqual({ key: 'orderDate', direction: 'descending' });
    expect(parseSort('subOrderNo')).toEqual({ key: 'subOrderNo', direction: 'ascending' });
  });

  it('ariaSort is set only on the sorted column', () => {
    expect(ariaSort('-orderDate', 'orderDate')).toBe('descending');
    expect(ariaSort('orderDate', 'orderDate')).toBe('ascending');
    expect(ariaSort('-orderDate', 'subOrderNo')).toBeNull();
  });

  it('nextSort flips the sorted column and starts another one ascending (or descending)', () => {
    expect(nextSort('-orderDate', 'orderDate')).toBe('orderDate');
    expect(nextSort('orderDate', 'orderDate')).toBe('-orderDate');
    expect(nextSort('-orderDate', 'subOrderNo')).toBe('subOrderNo');
    expect(nextSort('subOrderNo', 'settlementAmount', true)).toBe('-settlementAmount');
    expect(nextSort('-settlementAmount', 'settlementAmount', true)).toBe('settlementAmount');
  });
});
