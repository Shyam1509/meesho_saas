import { RequestValidationException } from '../common/errors/request-validation.exception';
import { DATA_AS_OF_PATTERN } from './dto/import.dto';
import { parseDataAsOf, todayInIndia } from './imports.service';

// 30 Oct 2026 20:00 UTC = 31 Oct 2026 01:30 in India.
const NOW = Date.UTC(2026, 9, 30, 20, 0, 0);

function reasonsOf(value: string): string[] {
  try {
    parseDataAsOf(value, NOW);
  } catch (err) {
    if (err instanceof RequestValidationException) {
      expect(err.details[0].field).toBe('dataAsOf');
      return err.details[0].reasons;
    }
    throw err;
  }
  throw new Error('expected a RequestValidationException');
}

describe('dataAsOf (the day the report was downloaded)', () => {
  it('a date means the END of that day in India (23:59:59.999 IST = 18:29:59.999 UTC)', () => {
    expect(parseDataAsOf('2026-10-25', NOW).toISOString()).toBe(
      '2026-10-25T18:29:59.999Z',
    );
    expect(
      parseDataAsOf('2028-02-29', Date.UTC(2028, 5, 1)).toISOString(),
    ).toBe('2028-02-29T18:29:59.999Z');
  });

  it('"today" is the Indian calendar date: up to today (India) is allowed, tomorrow is not', () => {
    expect(todayInIndia(NOW)).toBe('2026-10-31');
    expect(parseDataAsOf('2026-10-31', NOW).toISOString()).toBe(
      '2026-10-31T18:29:59.999Z',
    );
    expect(reasonsOf('2026-11-01')).toEqual([
      'dataAsOf must not be after today (India time)',
    ]);
  });

  it('the DTO pattern accepts a date only', () => {
    for (const value of ['2026-10-25', '2000-01-01']) {
      expect({ value, ok: DATA_AS_OF_PATTERN.test(value) }).toEqual({
        value,
        ok: true,
      });
    }
    for (const value of [
      '2026-10-25T10:30:00Z',
      '2026-10-25T10:30',
      '25-10-2026',
      'yesterday',
      '2026-1-5',
    ]) {
      expect({ value, ok: DATA_AS_OF_PATTERN.test(value) }).toEqual({
        value,
        ok: false,
      });
    }
  });

  it('rejects impossible calendar dates and dates before 2000', () => {
    expect(reasonsOf('2026-02-30')).toEqual(['dataAsOf is not a valid date']);
    expect(reasonsOf('2026-13-01')).toEqual(['dataAsOf is not a valid date']);
    expect(reasonsOf('1999-12-31')).toEqual([
      'dataAsOf must not be before 2000-01-01',
    ]);
  });
});
