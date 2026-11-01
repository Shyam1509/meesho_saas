import {
  fromScaled,
  roundHalfUp,
  subtractDecimals,
  sumDecimals,
  toScaled,
} from './decimal-text';

describe('exact decimal arithmetic (BigInt, never a float)', () => {
  it('scales decimal strings and back', () => {
    expect(toScaled('829.00', 2)).toBe(82900n);
    expect(toScaled('-0.5', 2)).toBe(-50n);
    expect(toScaled('7', 4)).toBe(70000n);
    expect(fromScaled(-125767n, 2)).toBe('-1257.67');
    expect(fromScaled(5n, 2)).toBe('0.05');
    expect(fromScaled(-5n, 2)).toBe('-0.05');
    expect(fromScaled(0n, 2)).toBe('0.00');
  });

  it('refuses text that is not a plain decimal, or more decimals than the scale (never rounds)', () => {
    expect(() => toScaled('1e3', 2)).toThrow('not a decimal string');
    expect(() => toScaled('1,000.00', 2)).toThrow('not a decimal string');
    expect(() => toScaled('0.123', 2)).toThrow('more decimals');
  });

  it('subtracts exactly where a float would not (0.30 − 0.10 − 0.20 = 0.00)', () => {
    expect(0.3 - 0.1 - 0.2).not.toBe(0);
    expect(subtractDecimals('0.30', '0.10', '0.20')).toBe('0.00');
    expect(subtractDecimals('99999999999.99', '-0.01')).toBe('100000000000.00');
  });

  it('null parts count as nothing; all null → null; the scale follows the inputs (at least 2)', () => {
    expect(subtractDecimals(null, '986.67', '1100.00')).toBe('-2086.67');
    expect(subtractDecimals('800.00', null, null)).toBe('800.00');
    expect(subtractDecimals(null, null, null)).toBeNull();
    expect(subtractDecimals('1', '0.5')).toBe('0.50');
    expect(subtractDecimals('840.00', '653.3333')).toBe('186.6667');
  });

  it('sums exactly at the largest scale; only nulls → null; a real zero stays zero', () => {
    expect(sumDecimals(['200.0000', '333.3333', '120.0000', '333.3333'])).toBe(
      '986.6666',
    );
    expect(sumDecimals(['0.10', '0.20', null])).toBe('0.30');
    expect(sumDecimals(['-420.00', '400.00', '20'])).toBe('0.00');
    expect(sumDecimals([null, null])).toBeNull();
    expect(sumDecimals([])).toBeNull();
  });

  it('rounds half away from zero like MySQL ROUND on DECIMAL', () => {
    expect(roundHalfUp('986.6666', 2)).toBe('986.67');
    expect(roundHalfUp('999.9999', 2)).toBe('1000.00');
    expect(roundHalfUp('986.6650', 2)).toBe('986.67');
    expect(roundHalfUp('986.6649', 2)).toBe('986.66');
    expect(roundHalfUp('-0.005', 2)).toBe('-0.01');
    expect(roundHalfUp('-0.0049', 2)).toBe('0.00');
    expect(roundHalfUp('5', 2)).toBe('5.00');
    expect(roundHalfUp(null, 2)).toBeNull();
  });
});
