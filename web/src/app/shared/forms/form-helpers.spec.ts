import { FormControl } from '@angular/forms';

import { dateOnly, decimalAmount, notAfter } from './form-helpers';

describe('form validators', () => {
  const errorsOf = (validator: (c: FormControl) => unknown, value: string) =>
    validator(new FormControl(value));

  it('dateOnly accepts a real YYYY-MM-DD day or nothing', () => {
    expect(errorsOf(dateOnly, '')).toBeNull();
    expect(errorsOf(dateOnly, '2026-10-31')).toBeNull();
    expect(errorsOf(dateOnly, '2026-02-30')).toEqual({ date: true });
    expect(errorsOf(dateOnly, '31-10-2026')).toEqual({ date: true });
  });

  it('notAfter rejects a day after the limit, read at validation time', () => {
    let max = '2026-10-31';
    const validator = notAfter(() => max);
    expect(errorsOf(validator, '2026-10-31')).toBeNull();
    expect(errorsOf(validator, '2026-11-01')).toEqual({ after: { max: '2026-10-31' } });
    max = '2026-11-01';
    expect(errorsOf(validator, '2026-11-01')).toBeNull();
    // Malformed or empty: left to dateOnly / requiredTrimmed.
    expect(errorsOf(validator, 'soon')).toBeNull();
  });

  describe('decimalAmount', () => {
    const fourDp = decimalAmount({ maxDecimals: 4, limit: 100_000_000 });
    const positiveTwoDp = decimalAmount({ maxDecimals: 2, limit: 10_000_000_000, positive: true });

    it.each(['0', '249.5', '12.3456', ' 7 ', '99999999.9999'])('accepts %j (4 decimals)', (v) => {
      expect(errorsOf(fourDp, v)).toBeNull();
    });

    it.each(['12.34567', '-1', '1,000', '₹5', '1e3', '.5', '5.', '007.5', '00', '01', '00.5'])(
      'rejects %j as format (leading zeros too, as the API)',
      (v) => {
        expect(errorsOf(fourDp, v)).toEqual({ format: true });
        expect(errorsOf(positiveTwoDp, v)).toEqual({ format: true });
      },
    );

    it('still accepts 0 and 0.x', () => {
      expect(errorsOf(fourDp, '0.5')).toBeNull();
      expect(errorsOf(positiveTwoDp, '0.50')).toBeNull();
      expect(errorsOf(fourDp, '10.0001')).toBeNull();
    });

    it('rejects the limit and above', () => {
      expect(errorsOf(fourDp, '100000000')).toEqual({ limit: { limit: 100_000_000 } });
      expect(errorsOf(positiveTwoDp, '10000000000')).toEqual({ limit: { limit: 10_000_000_000 } });
      expect(errorsOf(positiveTwoDp, '9999999999.99')).toBeNull();
    });

    it('positive rejects zero but a cost of 0 is allowed', () => {
      expect(errorsOf(positiveTwoDp, '0')).toEqual({ positive: true });
      expect(errorsOf(positiveTwoDp, '0.00')).toEqual({ positive: true });
      expect(errorsOf(positiveTwoDp, '0.01')).toBeNull();
      expect(errorsOf(positiveTwoDp, '1.234')).toEqual({ format: true });
      expect(errorsOf(fourDp, '0')).toBeNull();
    });

    it('leaves an empty value to requiredTrimmed', () => {
      expect(errorsOf(positiveTwoDp, '')).toBeNull();
      expect(errorsOf(positiveTwoDp, '   ')).toBeNull();
    });
  });
});
