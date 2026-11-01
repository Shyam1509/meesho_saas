import { addDays, todayInIndia } from '../time/india-date';
import {
  canonicalDecimal,
  decimalProblem,
  EXPENSE_AMOUNT_RULE,
  toDecimalText,
  UNIT_COST_RULE,
} from './value-rules';

const transform = (value: unknown) =>
  toDecimalText({ value } as Parameters<typeof toDecimalText>[0]);

describe('decimal input rules', () => {
  describe('unit cost: 0 ≤ x < 100000000, at most 4 decimals, zero allowed', () => {
    it.each([
      '0',
      '0.0000',
      '549.5',
      '549.5000',
      '0.0001',
      '333.3333',
      '99999999.9999',
      '1',
    ])('accepts %s', (value) =>
      expect(decimalProblem(value, UNIT_COST_RULE)).toBeNull(),
    );

    it('rejects more than 4 decimals, the upper bound, negatives and non-plain text', () => {
      expect(decimalProblem('1.12345', UNIT_COST_RULE)).toBe(
        'must have at most 4 decimal places',
      );
      expect(decimalProblem('100000000', UNIT_COST_RULE)).toBe(
        'must be at least 0 and below 100000000',
      );
      expect(decimalProblem('100000000.0', UNIT_COST_RULE)).toBe(
        'must be at least 0 and below 100000000',
      );
      for (const value of [
        '-1',
        '-0.01',
        '+5',
        '1e3',
        '1,000',
        '00.5',
        '01',
        '.5',
        '5.',
        ' 5',
        '',
        'abc',
        'NaN',
        'Infinity',
      ]) {
        expect({
          value,
          problem: decimalProblem(value, UNIT_COST_RULE),
        }).toEqual({
          value,
          problem: expect.stringMatching(
            /^must be a plain decimal number/,
          ) as string,
        });
      }
      expect(decimalProblem(5, UNIT_COST_RULE)).toBe(
        'must be a decimal number given as a string',
      );
      expect(decimalProblem(null, UNIT_COST_RULE)).toBe(
        'must be a decimal number given as a string',
      );
    });
  });

  describe('expense amount: 0 < x < 10000000000, at most 2 decimals', () => {
    it.each(['0.01', '1', '1200.50', '9999999999.99', '10.5'])(
      'accepts %s',
      (value) => expect(decimalProblem(value, EXPENSE_AMOUNT_RULE)).toBeNull(),
    );

    it('rejects zero (any spelling), 3 decimals, the upper bound and negatives', () => {
      for (const value of [
        '0',
        '0.0',
        '0.00',
        '10000000000',
        '10000000000.00',
      ]) {
        expect({
          value,
          problem: decimalProblem(value, EXPENSE_AMOUNT_RULE),
        }).toEqual({
          value,
          problem: 'must be greater than 0 and below 10000000000',
        });
      }
      expect(decimalProblem('10.123', EXPENSE_AMOUNT_RULE)).toBe(
        'must have at most 2 decimal places',
      );
      expect(decimalProblem('-5', EXPENSE_AMOUNT_RULE)).toMatch(
        /^must be a plain decimal number/,
      );
    });
  });

  it('transform: strings are trimmed, finite numbers become their decimal text, everything else passes through', () => {
    expect(transform(' 549.5 ')).toBe('549.5');
    expect(transform(549.5)).toBe('549.5');
    expect(transform(0)).toBe('0');
    // JS prints these with an exponent: the validator then rejects them instead of guessing.
    expect(transform(1e21)).toBe('1e+21');
    expect(transform(0.0000001)).toBe('1e-7');
    expect(transform(Number.NaN)).toBeNaN();
    expect(transform(null)).toBeNull();
    expect(transform(true)).toBe(true);
  });

  it('canonical form pads to the column scale without float maths', () => {
    expect(canonicalDecimal('549.5', UNIT_COST_RULE)).toBe('549.5000');
    expect(canonicalDecimal('0', UNIT_COST_RULE)).toBe('0.0000');
    expect(canonicalDecimal('333.3333', UNIT_COST_RULE)).toBe('333.3333');
    expect(canonicalDecimal('100', EXPENSE_AMOUNT_RULE)).toBe('100.00');
    expect(canonicalDecimal('0.1', EXPENSE_AMOUNT_RULE)).toBe('0.10');
    expect(canonicalDecimal('9999999999.99', EXPENSE_AMOUNT_RULE)).toBe(
      '9999999999.99',
    );
  });
});

describe('India dates', () => {
  it('addDays crosses month, year and leap days', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-10-31', 366)).toBe('2027-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-31', 0)).toBe('2026-10-31');
  });

  it('todayInIndia uses UTC+05:30', () => {
    // 30 Oct 2026 18:29:59.999 UTC = 23:59:59.999 IST; one ms later it is 31 Oct in India.
    expect(todayInIndia(Date.UTC(2026, 9, 30, 18, 29, 59, 999))).toBe(
      '2026-10-30',
    );
    expect(todayInIndia(Date.UTC(2026, 9, 30, 18, 30, 0, 0))).toBe(
      '2026-10-31',
    );
  });
});
