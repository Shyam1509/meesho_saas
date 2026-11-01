import { RequestValidationException } from '../common/errors/request-validation.exception';
import { todayInIndia } from '../common/time/india-date';
import {
  bucketSql,
  bucketStart,
  bucketStarts,
  daysInRange,
  defaultGranularity,
  resolveDashboardFilters,
} from './dashboard-range';

function validationFields(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RequestValidationException);
    return (err as RequestValidationException).details;
  }
  throw new Error('expected a RequestValidationException');
}

describe('dashboard range', () => {
  it('counts days inclusively', () => {
    expect(daysInRange('2026-10-01', '2026-10-01')).toBe(1);
    expect(daysInRange('2026-10-01', '2026-10-31')).toBe(31);
    expect(daysInRange('2024-10-31', '2026-10-31')).toBe(731); // 2 × 365 days apart, both ends included
    expect(daysInRange('2028-02-28', '2028-03-01')).toBe(3); // leap year
    expect(daysInRange('2026-10-02', '2026-10-01')).toBe(0);
  });

  it('default granularity: day ≤ 62 days, week ≤ 366, else month', () => {
    expect(defaultGranularity(1)).toBe('day');
    expect(defaultGranularity(62)).toBe('day');
    expect(defaultGranularity(63)).toBe('week');
    expect(defaultGranularity(366)).toBe('week');
    expect(defaultGranularity(367)).toBe('month');
    expect(defaultGranularity(731)).toBe('month');
  });

  it('defaults: last 30 days ending today (India), order_date basis, no status, granularity from the length', () => {
    expect(resolveDashboardFilters({}, '2026-11-01')).toEqual({
      from: '2026-10-03',
      to: '2026-11-01',
      basis: 'order_date',
      statuses: [],
      granularity: 'day',
    });
    // `to` given: from = to − 29; `from` given: to = today.
    expect(resolveDashboardFilters({ to: '2026-03-01' }, '2026-11-01')).toEqual(
      expect.objectContaining({ from: '2026-01-31', to: '2026-03-01' }),
    );
    expect(
      resolveDashboardFilters({ from: '2026-01-01' }, '2026-11-01'),
    ).toEqual(
      expect.objectContaining({
        from: '2026-01-01',
        to: '2026-11-01',
        granularity: 'week', // 305 days
      }),
    );
  });

  it('"today" is the India calendar date: 18:29:59.999 UTC is still that day, 18:30 UTC is the next', () => {
    const before = todayInIndia(Date.parse('2026-10-31T18:29:59.999Z'));
    const after = todayInIndia(Date.parse('2026-10-31T18:30:00.000Z'));
    expect([before, after]).toEqual(['2026-10-31', '2026-11-01']);
    expect(resolveDashboardFilters({}, after)).toEqual(
      expect.objectContaining({ from: '2026-10-03', to: '2026-11-01' }),
    );
    expect(resolveDashboardFilters({}, before)).toEqual(
      expect.objectContaining({ from: '2026-10-02', to: '2026-10-31' }),
    );
  });

  it('keeps an explicit basis / granularity, de-duplicates statuses in order', () => {
    expect(
      resolveDashboardFilters(
        {
          from: '2026-10-01',
          to: '2026-10-31',
          basis: 'payment_date',
          status: ['RTO', 'DELIVERED', 'RTO'],
          granularity: 'month',
        },
        '2026-11-01',
      ),
    ).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      basis: 'payment_date',
      statuses: ['RTO', 'DELIVERED'],
      granularity: 'month',
    });
  });

  it('731 days (both ends included) is the longest range; 732 → 400 on `to`', () => {
    expect(
      resolveDashboardFilters(
        { from: '2024-10-31', to: '2026-10-31' },
        '2026-11-01',
      ),
    ).toEqual(expect.objectContaining({ granularity: 'month' }));
    expect(
      validationFields(() =>
        resolveDashboardFilters(
          { from: '2024-10-30', to: '2026-10-31' },
          '2026-11-01',
        ),
      ),
    ).toEqual([
      {
        field: 'to',
        reasons: ['the range from from to to must not be longer than 731 days'],
      },
    ]);
  });

  it('a from after the (defaulted) to → 400 naming the field', () => {
    expect(
      validationFields(() =>
        resolveDashboardFilters({ from: '2026-11-05' }, '2026-11-01'),
      ),
    ).toEqual([
      {
        field: 'from',
        reasons: [
          'from must not be after to (to defaults to today, India time)',
        ],
      },
    ]);
    // Both given and reversed is normally caught by the DTO (IsNotBefore); the resolver refuses it too.
    expect(
      validationFields(() =>
        resolveDashboardFilters(
          { from: '2026-10-02', to: '2026-10-01' },
          '2026-11-01',
        ),
      ),
    ).toEqual([{ field: 'to', reasons: ['to must not be before from'] }]);
  });
});

describe('trend buckets', () => {
  it('bucketStart: the day, the ISO Monday on or before it, the 1st of the month', () => {
    // 2026-10-01 is a Thursday.
    expect(bucketStart('2026-10-01', 'day')).toBe('2026-10-01');
    expect(bucketStart('2026-10-01', 'week')).toBe('2026-09-28');
    expect(bucketStart('2026-10-05', 'week')).toBe('2026-10-05'); // a Monday is its own bucket
    expect(bucketStart('2026-10-11', 'week')).toBe('2026-10-05'); // Sunday belongs to the week before
    expect(bucketStart('2027-01-01', 'week')).toBe('2026-12-28'); // across a year
    expect(bucketStart('2028-03-01', 'week')).toBe('2028-02-28'); // across a leap day
    expect(bucketStart('2026-10-31', 'month')).toBe('2026-10-01');
  });

  it('bucketStarts: every bucket from the bucket of from to the bucket of to, none skipped', () => {
    expect(bucketStarts('2026-10-01', '2026-10-31', 'week')).toEqual([
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
    const days = bucketStarts('2026-10-01', '2026-10-31', 'day');
    expect(days).toHaveLength(31);
    expect([days[0], days[30]]).toEqual(['2026-10-01', '2026-10-31']);
    expect(bucketStarts('2026-11-15', '2027-02-03', 'month')).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
    ]);
    expect(bucketStarts('2026-10-07', '2026-10-07', 'week')).toEqual([
      '2026-10-05',
    ]);
    expect(bucketStarts('2024-10-31', '2026-10-31', 'day')).toHaveLength(731);
  });

  it('bucketSql: the same buckets in MySQL, as YYYY-MM-DD text', () => {
    expect(bucketSql('t.d', 'day')).toBe('CAST(t.d AS CHAR)');
    expect(bucketSql('t.d', 'week')).toBe(
      'CAST(DATE_SUB(t.d, INTERVAL WEEKDAY(t.d) DAY) AS CHAR)',
    );
    expect(bucketSql('t.d', 'month')).toBe("DATE_FORMAT(t.d, '%Y-%m-01')");
  });
});
