import { convertToParamMap } from '@angular/router';

import {
  compactParams,
  isDateOnly,
  isDateRangeValid,
  mergeParams,
  readDate,
  readList,
  readOneOf,
  readPage,
  readText,
} from './url-state';

describe('url-state helpers', () => {
  const params = convertToParamMap({
    q: '  kurta  ',
    long: 'x'.repeat(150),
    from: '2026-02-29',
    to: '2026-10-31',
    page: '3',
    zero: '0',
    max: '2000',
    over: '2001',
    huge: '9999999',
    codes: ['x'.repeat(64), 'y'.repeat(65)],
    sort: '-orderDate',
    status: ['Delivered', ' Delivered ', '', 'RTO'],
  });

  it('isDateOnly accepts real calendar days only', () => {
    expect(isDateOnly('2026-10-31')).toBe(true);
    expect(isDateOnly('2028-02-29')).toBe(true);
    expect(isDateOnly('2026-02-29')).toBe(false);
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('31-10-2026')).toBe(false);
  });

  it('isDateRangeValid rejects only a start after the end', () => {
    expect(isDateRangeValid('2026-10-01', '2026-10-31')).toBe(true);
    expect(isDateRangeValid('2026-10-31', '2026-10-31')).toBe(true);
    expect(isDateRangeValid('2026-10-31', '2026-10-01')).toBe(false);
    expect(isDateRangeValid('', '2026-10-01')).toBe(true);
    expect(isDateRangeValid(null, null)).toBe(true);
  });

  it('reads text (trimmed, at most 100 characters), dates, pages, enums and lists', () => {
    expect(readText(params, 'q')).toBe('kurta');
    expect(readText(params, 'long')).toHaveLength(100);
    expect(readText(params, 'missing')).toBe('');
    expect(readDate(params, 'from')).toBe('');
    expect(readDate(params, 'to')).toBe('2026-10-31');
    expect(readPage(params)).toBe(3);
    expect(readPage(params, 'zero')).toBe(1);
    expect(readPage(params, 'max')).toBe(2000);
    expect(readPage(params, 'over')).toBe(1);
    expect(readPage(params, 'huge')).toBe(1);
    expect(readPage(params, 'missing')).toBe(1);
    expect(readOneOf(params, 'sort', ['orderDate', '-orderDate'])).toBe('-orderDate');
    expect(readOneOf(params, 'sort', ['orderDate'])).toBeNull();
    expect(readList(params, 'status')).toEqual(['Delivered', 'RTO']);
    expect(readList(params, 'codes')).toEqual(['x'.repeat(64)]);
  });

  it('compactParams drops defaults; mergeParams turns them into null (removed on merge)', () => {
    const values = { q: 'x', status: [], from: '', settlement: null, flag: true, off: false, page: 2 };
    expect(compactParams(values)).toEqual({ q: 'x', flag: 'true', page: 2 });
    expect(mergeParams(values)).toEqual({
      q: 'x',
      status: null,
      from: null,
      settlement: null,
      flag: 'true',
      off: null,
      page: 2,
    });
  });
});
