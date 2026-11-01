import { compareDecimals, negateDecimal, sumDecimals } from './decimal';

describe('decimal helpers', () => {
  it('sums exactly, without floating-point drift', () => {
    expect(sumDecimals(['0.10', '0.20'])).toBe('0.30');
    expect(sumDecimals(['1180.40', '-50.25'])).toBe('1130.15');
    expect(sumDecimals(['330.40', '-50.25', '-100.00'])).toBe('180.15');
    expect(sumDecimals(['99999999999.99', '0.01'])).toBe('100000000000.00');
  });

  it('keeps the largest scale (at least 2 decimals)', () => {
    expect(sumDecimals(['12.3456', '1'])).toBe('13.3456');
    expect(sumDecimals(['5'])).toBe('5.00');
  });

  it('skips missing values but returns null when every value is missing (never 0)', () => {
    expect(sumDecimals([null, '250.00', undefined])).toBe('250.00');
    expect(sumDecimals([null, null])).toBeNull();
    expect(sumDecimals([])).toBeNull();
    expect(sumDecimals(['0.00', null])).toBe('0.00');
  });

  it('negates, keeping zero and missing apart', () => {
    expect(negateDecimal('75.00')).toBe('-75.00');
    expect(negateDecimal('-0.5')).toBe('0.50');
    expect(negateDecimal('0.00')).toBe('0.00');
    expect(negateDecimal(null)).toBeNull();
  });

  it('compares numerically; a missing value counts as larger', () => {
    expect(compareDecimals('10.00', '9.99')).toBe(1);
    expect(compareDecimals('-50.25', '0')).toBe(-1);
    expect(compareDecimals('1.50', '1.5')).toBe(0);
    expect(compareDecimals(null, '1')).toBe(1);
    expect(compareDecimals('1', null)).toBe(-1);
    expect(compareDecimals(null, null)).toBe(0);
  });
});
