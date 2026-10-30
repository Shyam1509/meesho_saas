import {
  displayRaw,
  normalizeDate,
  normalizeDecimal,
  normalizeHeader,
  normalizeId,
  normalizeQuantity,
  normalizeStatus,
  normalizeText,
  REASONS,
} from './normalizers';

const okValue = (value: string | null) => ({ ok: true, value });
const failure = (reason: string) => ({ ok: false, reason });

describe('normalizeHeader', () => {
  it.each([
    [
      'Supplier Listed Price (Incl. GST + Commission)',
      'supplierlistedpriceinclgstcommission',
    ],
    ['  Sub Order No  ', 'suborderno'],
    ['SUB_ORDER-NO', 'suborderno'],
    ['Meesho Commission Percentage', 'meeshocommissionpercentage'],
    ['₹ Amount', 'amount'],
    ['', ''],
  ])('%p → %p', (input, expected) => {
    expect(normalizeHeader(input)).toBe(expected);
  });
});

describe('normalizeText', () => {
  it('trims and collapses internal whitespace (tabs, line breaks, NBSP)', () => {
    expect(normalizeText('  Kurti \t set\n for women ', 255)).toEqual(
      okValue('Kurti set for women'),
    );
  });

  it('blank → null (missing), never empty string', () => {
    expect(normalizeText('   ', 64)).toEqual(okValue(null));
    expect(normalizeText(null, 64)).toEqual(okValue(null));
  });

  it('counts characters, not UTF-16 units, against the limit', () => {
    expect(normalizeText('😀'.repeat(4), 4)).toEqual(okValue('😀😀😀😀'));
    expect(normalizeText('😀'.repeat(5), 4)).toEqual(
      failure(REASONS.tooLong(4)),
    );
  });

  it('numbers and booleans become text; XLSX dates their calendar date', () => {
    expect(normalizeText(32, 64)).toEqual(okValue('32'));
    expect(normalizeText(true, 64)).toEqual(okValue('TRUE'));
    expect(normalizeText(new Date(Date.UTC(2026, 9, 5)), 64)).toEqual(
      okValue('2026-10-05'),
    );
  });
});

describe('normalizeId', () => {
  it('keeps the id exactly (case kept, whitespace collapsed)', () => {
    expect(normalizeId(' 1234567890123_1 ', 64)).toEqual(
      okValue('1234567890123_1'),
    );
    expect(normalizeId('SKU-red  XL', 128)).toEqual(okValue('SKU-red XL'));
  });

  it('rejects ids that Excel turned into scientific notation', () => {
    expect(normalizeId('1.23457E+17', 64)).toEqual(failure(REASONS.scientific));
    expect(normalizeId('2E+15', 64)).toEqual(failure(REASONS.scientific));
  });

  it('XLSX numbers: safe integers become text; unsafe or fractional ones are errors', () => {
    expect(normalizeId(987654321, 64)).toEqual(okValue('987654321'));
    expect(normalizeId(2 ** 60, 64)).toEqual(failure(REASONS.unsafeNumber));
    expect(normalizeId(12.5, 64)).toEqual(failure(REASONS.notAnId));
    expect(normalizeId(new Date(), 64)).toEqual(failure(REASONS.notAnId));
  });

  it('enforces the maximum length', () => {
    expect(normalizeId('x'.repeat(65), 64)).toEqual(
      failure(REASONS.tooLong(64)),
    );
  });
});

describe('normalizeStatus', () => {
  it('raw status: trimmed, spaces collapsed, case kept', () => {
    expect(normalizeStatus('  Delivered   to  customer ')).toEqual(
      okValue('Delivered to customer'),
    );
    expect(normalizeStatus('RTO')).toEqual(okValue('RTO'));
    expect(normalizeStatus('')).toEqual(okValue(null));
  });
});

describe('normalizeDecimal', () => {
  it.each([
    ['100', '100.00'],
    ['100.5', '100.50'],
    ['0.1', '0.10'],
    ['₹1,234.50', '1234.50'],
    ['₹ 1,234.50', '1234.50'],
    ['Rs. 250', '250.00'],
    ['Rs.250.75', '250.75'],
    ['INR 99', '99.00'],
    ['1,00,000.25', '100000.25'],
    ['100,000', '100000.00'],
    ['-45.10', '-45.10'],
    ['-₹45', '-45.00'],
    ['₹-45', '-45.00'],
    ['  -12  ', '-12.00'],
    ['007.5', '7.50'],
    ['-0', '0.00'],
    ['-0.00', '0.00'],
    ['10.500', '10.50'],
    ['9999999999.99', '9999999999.99'],
  ])('%p → %p', (input, expected) => {
    expect(normalizeDecimal(input)).toEqual(okValue(expected));
  });

  it('blank → null (not reported), never 0', () => {
    expect(normalizeDecimal('')).toEqual(okValue(null));
    expect(normalizeDecimal('   ')).toEqual(okValue(null));
    expect(normalizeDecimal(null)).toEqual(okValue(null));
  });

  it.each(['12.345', '0.001', '1.999'])('%p has too many decimals', (input) => {
    expect(normalizeDecimal(input)).toEqual(failure(REASONS.tooManyDecimals));
  });

  it.each([
    'abc',
    '1.2.3',
    '--5',
    '1e5',
    ',100',
    '100,',
    '1,,000',
    '(100)',
    '.50',
    '₹',
    '12-',
    'NaN',
  ])('%p is not an amount', (input) => {
    expect(normalizeDecimal(input)).toEqual(failure(REASONS.notAmount));
  });

  it('rejects amounts beyond DECIMAL(12,2)', () => {
    expect(normalizeDecimal('12345678901')).toEqual(
      failure(REASONS.amountTooLarge),
    );
    expect(normalizeDecimal(1e11)).toEqual(failure(REASONS.amountTooLarge));
  });

  it('XLSX numbers: exact 2-dp values and float artefacts are fine, finer values are errors', () => {
    expect(normalizeDecimal(1234.5)).toEqual(okValue('1234.50'));
    expect(normalizeDecimal(-45.1)).toEqual(okValue('-45.10'));
    expect(normalizeDecimal(0.1 + 0.2)).toEqual(okValue('0.30'));
    expect(normalizeDecimal(1.15 * 3)).toEqual(okValue('3.45'));
    expect(normalizeDecimal(1234567.89)).toEqual(okValue('1234567.89'));
    expect(normalizeDecimal(-0)).toEqual(okValue('0.00'));
    expect(normalizeDecimal(1.005)).toEqual(failure(REASONS.tooManyDecimals));
    expect(normalizeDecimal(10.1234)).toEqual(failure(REASONS.tooManyDecimals));
    expect(normalizeDecimal(Number.NaN)).toEqual(failure(REASONS.notAmount));
    expect(normalizeDecimal(true)).toEqual(failure(REASONS.notAmount));
    expect(normalizeDecimal(new Date())).toEqual(failure(REASONS.notAmount));
  });

  it.each([
    ['1,23,456.78', '123456.78'],
    ['12,34,56,789', '123456789.00'],
    ['1,000', '1000.00'],
    ['123,456.78', '123456.78'],
    ['1,234,567', '1234567.00'],
    ['-₹1,00,000', '-100000.00'],
  ])('valid Indian / Western grouping %p → %p', (input, expected) => {
    expect(normalizeDecimal(input)).toEqual(okValue(expected));
  });

  it.each([
    '1,23',
    '12,5',
    '1,000,00',
    '12,345,67',
    '1234,567',
    '0,5',
    '1,0000',
  ])(
    'thousands separators in any other place (%p) are an error, never guessed',
    (input) => {
      expect(normalizeDecimal(input)).toEqual(failure(REASONS.notAmount));
    },
  );
});

describe('format characters (zero-width, bidi, soft hyphen)', () => {
  it('are removed from text, ids, statuses, amounts, dates and quantities', () => {
    expect(normalizeId('SO\u200b-1\u2060', 64)).toEqual(okValue('SO-1'));
    expect(normalizeText('\u202eKurti\u00ad', 64)).toEqual(okValue('Kurti'));
    expect(normalizeStatus('\ufeffDELIVERED')).toEqual(okValue('DELIVERED'));
    expect(normalizeDecimal('1\u200b00.50')).toEqual(okValue('100.50'));
    expect(normalizeDate('01-10-2026\u200e')).toEqual(okValue('2026-10-01'));
    expect(normalizeQuantity('2\u200b')).toEqual(okValue('2'));
  });

  it('a cell of only format characters is blank (null), not text', () => {
    expect(normalizeId('\u200b\u200b', 64)).toEqual(okValue(null));
    expect(normalizeDate('\u200b')).toEqual(okValue(null));
    expect(normalizeQuantity('\u2060')).toEqual(okValue(null));
  });
});

describe('normalizeQuantity', () => {
  it('whole numbers > 0', () => {
    expect(normalizeQuantity('2')).toEqual(okValue('2'));
    expect(normalizeQuantity(' 10 ')).toEqual(okValue('10'));
    expect(normalizeQuantity(3)).toEqual(okValue('3'));
    expect(normalizeQuantity('')).toEqual(okValue(null));
  });

  it.each(['0', '-1', '1.5', 'two', '1,000', '2.0', '4294967296'])(
    '%p is rejected',
    (input) => {
      expect(normalizeQuantity(input)).toEqual(failure(REASONS.quantity));
    },
  );

  it('rejects fractional and zero XLSX numbers', () => {
    expect(normalizeQuantity(1.5)).toEqual(failure(REASONS.quantity));
    expect(normalizeQuantity(0)).toEqual(failure(REASONS.quantity));
  });
});

describe('normalizeDate', () => {
  it.each([
    ['2026-10-05', '2026-10-05'],
    ['2026-10-05 14:32', '2026-10-05'],
    ['2026-10-05 14:32:09', '2026-10-05'],
    ['2026-10-05T23:59:59', '2026-10-05'],
    ['05-10-2026', '2026-10-05'],
    ['05/10/2026', '2026-10-05'],
    ['5/1/2026', '2026-01-05'],
    ['25/10/2026', '2026-10-25'],
    ['05 Oct 2026', '2026-10-05'],
    ['5 oct 2026', '2026-10-05'],
    ['05-Oct-2026', '2026-10-05'],
    ['1 September 2026', '2026-09-01'],
    ['1 Sept 2026', '2026-09-01'],
    ['29/02/2028', '2028-02-29'],
    [' 05-10-2026 ', '2026-10-05'],
  ])('%p → %p (Indian day-first order)', (input, expected) => {
    expect(normalizeDate(input)).toEqual(okValue(expected));
  });

  it.each([
    // Month-first dates that cannot be day-first are rejected, never re-read as MM/DD.
    '10/25/2026',
    '12-31-2026',
    '31/02/2026',
    '29/02/2026',
    '2026-13-01',
    '2026-02-30',
    '2026-10-05 25:00',
    '2026/10/05',
    '05.10.2026',
    '05-10/2026',
    'Oct 5 2026',
    '05 Foo 2026',
    '20261005',
    '5 Oct 26',
    'yesterday',
  ])('%p is rejected', (input) => {
    expect(normalizeDate(input)).toEqual(failure(REASONS.date));
  });

  it('rejects years outside 2000–2100', () => {
    expect(normalizeDate('05-10-1999')).toEqual(failure(REASONS.dateYear));
    expect(normalizeDate('2101-01-01')).toEqual(failure(REASONS.dateYear));
  });

  it('XLSX date cells use their UTC calendar date; numbers are not dates', () => {
    expect(normalizeDate(new Date(Date.UTC(2026, 9, 5, 23, 30)))).toEqual(
      okValue('2026-10-05'),
    );
    expect(normalizeDate(new Date(Number.NaN))).toEqual(failure(REASONS.date));
    expect(normalizeDate(46300)).toEqual(failure(REASONS.date));
  });

  it('blank → null', () => {
    expect(normalizeDate('')).toEqual(okValue(null));
    expect(normalizeDate(null)).toEqual(okValue(null));
  });
});

describe('displayRaw', () => {
  it('keeps the trimmed text of an invalid cell, cut to 255 characters', () => {
    expect(displayRaw('  31/02/2026 ')).toBe('31/02/2026');
    expect(displayRaw('x'.repeat(300))).toHaveLength(255);
    expect(displayRaw('   ')).toBeNull();
    expect(displayRaw(null)).toBeNull();
    expect(displayRaw(12.345)).toBe('12.345');
  });
});
