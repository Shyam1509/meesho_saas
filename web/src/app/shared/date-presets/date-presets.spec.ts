import { addDays, daysInRange, presetRange, todayInIndia } from './date-presets';

describe('date presets (India calendar)', () => {
  // 19:00 UTC on 31 Oct is 00:30 IST on 1 Nov: India is already in November.
  const AFTER_IST_MIDNIGHT = new Date('2026-10-31T19:00:00Z');
  // 18:00 UTC on 31 Oct is 23:30 IST on 31 Oct: still October in India.
  const BEFORE_IST_MIDNIGHT = new Date('2026-10-31T18:00:00Z');

  it('takes "today" from India’s calendar, not UTC', () => {
    expect(todayInIndia(AFTER_IST_MIDNIGHT)).toBe('2026-11-01');
    expect(todayInIndia(BEFORE_IST_MIDNIGHT)).toBe('2026-10-31');
  });

  it('last 7 / 30 / 90 days end today, today included', () => {
    expect(presetRange('last7', AFTER_IST_MIDNIGHT)).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(presetRange('last30', AFTER_IST_MIDNIGHT)).toEqual({ from: '2026-10-03', to: '2026-11-01' });
    expect(presetRange('last90', AFTER_IST_MIDNIGHT)).toEqual({ from: '2026-08-04', to: '2026-11-01' });
    expect(daysInRange('2026-10-03', '2026-11-01')).toBe(30);
  });

  it('this month and last month across the month boundary in IST', () => {
    expect(presetRange('thisMonth', AFTER_IST_MIDNIGHT)).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(presetRange('lastMonth', AFTER_IST_MIDNIGHT)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('thisMonth', BEFORE_IST_MIDNIGHT)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('lastMonth', BEFORE_IST_MIDNIGHT)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('last month in January is December of the previous year; leap February', () => {
    expect(presetRange('lastMonth', new Date('2027-01-15T06:00:00Z'))).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(presetRange('lastMonth', new Date('2028-03-10T06:00:00Z'))).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysInRange('2026-10-01', '2026-10-01')).toBe(1);
  });
});
