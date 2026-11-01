import {
  MISSING,
  dateStringInTimeZone,
  formatCount,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatFileSize,
  formatInr,
  formatUnitCost,
  localDateString,
  plural,
} from './format';
import { CountPipe, DisplayDateTimePipe, InrPipe, UnitCostPipe } from './format.pipes';

describe('format helpers', () => {
  describe('formatInr', () => {
    it.each([
      ['1234567.5', '₹12,34,567.50'],
      ['0', '₹0.00'],
      ['0.00', '₹0.00'],
      ['-250', '-₹250.00'],
      ['99.99', '₹99.99'],
      [' 1000 ', '₹1,000.00'],
      [1500, '₹1,500.00'],
      [0, '₹0.00'],
    ])('formats %j as %s', (value, expected) => {
      expect(formatInr(value)).toBe(expected);
    });

    it.each([null, undefined, ''])('shows "—" for a missing value (%j), never ₹0.00', (value) => {
      expect(formatInr(value)).toBe(MISSING);
      expect(MISSING).toBe('—');
    });

    it('shows a value that is not a number as it is', () => {
      expect(formatInr('n/a')).toBe('n/a');
      expect(formatInr(Number.NaN)).toBe(MISSING);
    });
  });

  describe('formatUnitCost', () => {
    it.each([
      ['12.3456', '₹12.3456'],
      ['12.3', '₹12.30'],
      ['250', '₹250.00'],
      ['0', '₹0.00'],
      ['125000.5', '₹1,25,000.50'],
    ])('formats %j as %s (up to 4 decimals)', (value, expected) => {
      expect(formatUnitCost(value)).toBe(expected);
      expect(new UnitCostPipe().transform(value)).toBe(expected);
    });

    it.each([null, undefined, ''])('shows "—" for a missing value (%j), never ₹0.00', (value) => {
      expect(formatUnitCost(value)).toBe(MISSING);
    });
  });

  describe('formatCount', () => {
    it('groups digits the Indian way and keeps 0', () => {
      expect(formatCount(1234567)).toBe('12,34,567');
      expect(formatCount(0)).toBe('0');
    });

    it('shows "—" for a missing count', () => {
      expect(formatCount(null)).toBe('—');
      expect(formatCount(undefined)).toBe('—');
    });
  });

  describe('dates', () => {
    it('formats a YYYY-MM-DD date as that exact day in any time zone', () => {
      expect(formatDate('2026-10-05')).toBe('5 Oct 2026');
      expect(formatDate('2026-10-05', 'America/Los_Angeles')).toBe('5 Oct 2026');
    });

    it('formats a moment as its day in the given time zone', () => {
      // 19:00 UTC on 31 Oct is already 1 Nov in India.
      expect(formatDate('2026-10-31T19:00:00.000Z', 'Asia/Kolkata')).toBe('1 Nov 2026');
      expect(formatDate('2026-10-31T19:00:00.000Z', 'UTC')).toBe('31 Oct 2026');
    });

    it('formats a date-time with a 12-hour clock', () => {
      expect(formatDateTime('2026-10-30T08:30:00.000Z', 'Asia/Kolkata')).toBe(
        '30 Oct 2026, 2:00 pm',
      );
      expect(formatDateTime('2026-10-30T08:30:00.000Z', 'UTC')).toBe('30 Oct 2026, 8:30 am');
    });

    it('shows "—" for missing dates and the raw text for unparseable ones', () => {
      expect(formatDate(null)).toBe('—');
      expect(formatDateTime(undefined)).toBe('—');
      expect(formatDate('')).toBe('—');
      expect(formatDateTime('not a date')).toBe('not a date');
    });

    it('formats a range, a single side or nothing', () => {
      expect(formatDateRange('2026-10-01', '2026-10-31')).toBe('1 Oct 2026 – 31 Oct 2026');
      expect(formatDateRange('2026-10-01', '2026-10-01')).toBe('1 Oct 2026');
      expect(formatDateRange('2026-10-01', null)).toBe('1 Oct 2026');
      expect(formatDateRange(null, '2026-10-31')).toBe('31 Oct 2026');
      expect(formatDateRange(null, null)).toBe('—');
    });

    it('gives the calendar date in a time zone as YYYY-MM-DD', () => {
      const moment = new Date(Date.UTC(2026, 9, 30, 20, 0)); // 01:30 on 31 Oct in India
      expect(dateStringInTimeZone(moment, 'Asia/Kolkata')).toBe('2026-10-31');
      expect(dateStringInTimeZone(moment, 'UTC')).toBe('2026-10-30');
    });

    it('gives the local calendar date as YYYY-MM-DD', () => {
      expect(localDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    });
  });

  it('formats file sizes', () => {
    expect(formatFileSize(1)).toBe('1 byte');
    expect(formatFileSize(512)).toBe('512 bytes');
    expect(formatFileSize(20480)).toBe('20 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatFileSize(null)).toBe('—');
  });

  it('pluralises', () => {
    expect(plural(1, 'row')).toBe('1 row');
    expect(plural(3, 'row')).toBe('3 rows');
    expect(plural(1200, 'row')).toBe('1,200 rows');
  });

  it('exposes the helpers as pipes', () => {
    expect(new InrPipe().transform('2500')).toBe('₹2,500.00');
    expect(new InrPipe().transform(null)).toBe('—');
    expect(new CountPipe().transform(0)).toBe('0');
    expect(new DisplayDateTimePipe().transform('2026-10-30T08:30:00.000Z', 'UTC')).toBe(
      '30 Oct 2026, 8:30 am',
    );
  });
});
