import {
  CSV_BOM,
  csvCell,
  csvContentDisposition,
  csvFilename,
  csvHeader,
  csvRow,
  filenamePart,
  textCell,
  unicodeFilenamePart,
  type CsvColumn,
} from './csv';

describe('CSV cells', () => {
  it('quotes a field with a quote, comma or line break (quotes doubled); plain text stays bare', () => {
    expect(textCell('Red Kurti')).toBe('Red Kurti');
    expect(textCell('Kurti, red')).toBe('"Kurti, red"');
    expect(textCell('5" wide')).toBe('"5"" wide"');
    expect(textCell('line1\nline2')).toBe('"line1\nline2"');
    expect(textCell('line1\r\nline2')).toBe('"line1\r\nline2"');
    expect(textCell('')).toBe('');
  });

  it.each([
    ['=HYPERLINK("http://x")', `"'=HYPERLINK(""http://x"")"`],
    ['+91 phone bill', "'+91 phone bill"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tcmd', "'\tcmd"],
    ['\rcmd', `"'\rcmd"`],
    ['=1,2', `"'=1,2"`],
    // Full-width forms, and formula characters after leading spaces / TAB / CR / LF (review L9).
    ['＝SUM(A1)', "'＝SUM(A1)"],
    ['＋1', "'＋1"],
    ['－1', "'－1"],
    ['＠x', "'＠x"],
    [' =x', "' =x"],
    ['  +cmd', "'  +cmd"],
    ['\n=1', `"'\n=1"`],
    [' \t@x', "' \t@x"],
  ])(
    'guards a text cell starting with a formula character: %j',
    (value, cell) => {
      expect(csvCell(value, 'text')).toBe(cell);
    },
  );

  it('text that merely contains those characters later (or only spaces) is untouched', () => {
    expect(csvCell('a=b', 'text')).toBe('a=b');
    expect(csvCell('SKU-1', 'text')).toBe('SKU-1');
    expect(csvCell(' a =x', 'text')).toBe(' a =x');
    expect(csvCell('  ', 'text')).toBe('  ');
    expect(csvCell('x＝1', 'text')).toBe('x＝1');
  });

  it('numbers are written exactly as returned: negatives keep "-", never guarded, no grouping', () => {
    expect(csvCell('-420.00', 'number')).toBe('-420.00');
    expect(csvCell('986.6666', 'number')).toBe('986.6666');
    expect(csvCell('0.00', 'number')).toBe('0.00');
    expect(csvCell(3, 'number')).toBe('3');
    expect(csvCell('12345678901234567', 'number')).toBe('12345678901234567');
  });

  it('a "number" that does not look like one is treated as text and guarded', () => {
    expect(csvCell('-1+1', 'number')).toBe("'-1+1");
    expect(csvCell('1,000.00', 'number')).toBe('"1,000.00"');
    expect(csvCell('1e5', 'number')).toBe('1e5');
  });

  it('null / undefined → empty cell (missing is never 0); booleans as true / false', () => {
    expect(csvCell(null, 'number')).toBe('');
    expect(csvCell(undefined, 'text')).toBe('');
    expect(csvCell(true, 'text')).toBe('true');
    expect(csvCell(false, 'text')).toBe('false');
  });

  it('rows end in CRLF; the header is text; the BOM is U+FEFF', () => {
    const columns: CsvColumn<{ a: string | null; n: string }>[] = [
      { header: 'Name', kind: 'text', value: (r) => r.a },
      { header: 'Amount', kind: 'number', value: (r) => r.n },
    ];
    expect(csvHeader(columns)).toBe('Name,Amount\r\n');
    expect(csvRow(columns, { a: '=x', n: '-5.00' })).toBe("'=x,-5.00\r\n");
    expect(csvRow(columns, { a: null, n: '1.50' })).toBe(',1.50\r\n');
    expect(CSV_BOM).toBe('﻿');
  });
});

describe('CSV filenames', () => {
  it('ASCII only: accents dropped, other runs → "-", trimmed, at most 60 characters', () => {
    expect(filenamePart('Shop One')).toBe('Shop-One');
    expect(filenamePart('Café Déjà')).toBe('Cafe-Deja');
    expect(filenamePart('../../etc/passwd')).toBe('etc-passwd');
    expect(filenamePart('a"b\r\nContent-Type: x')).toBe('a-b-Content-Type-x');
    expect(filenamePart('दुकान')).toBe('export');
    expect(filenamePart('   ')).toBe('export');
    expect(filenamePart(`${'x'.repeat(59)} yz`)).toBe('x'.repeat(59));
    expect(filenamePart('y'.repeat(100))).toHaveLength(60);
  });

  it('<name>-<type>-<from>_<to>.csv; one bound or none', () => {
    expect(
      csvFilename('Shop One', 'orders', {
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    ).toBe('Shop-One-orders-2026-10-01_2026-10-31.csv');
    expect(csvFilename('Shop', 'settlements', { from: '2026-10-01' })).toBe(
      'Shop-settlements-from-2026-10-01.csv',
    );
    expect(csvFilename('Shop', 'expenses', { to: '2026-10-31' })).toBe(
      'Shop-expenses-to-2026-10-31.csv',
    );
    expect(csvFilename('Shop', 'orders', {})).toBe('Shop-orders.csv');
    expect(
      csvFilename('Shop', 'orders', { from: '"; x=', to: '2026-10-31' }),
    ).toBe('Shop-orders-date_2026-10-31.csv');
    for (const name of [
      csvFilename('Ünïcødé / "quoted"', 'orders', {}),
      csvFilename('‮gnp.exe', 'orders', {}),
    ]) {
      expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });

  it('the UTF-8 name keeps letters of any script; quotes, slashes, controls and bidi marks become "-"', () => {
    expect(unicodeFilenamePart('दुकान One')).toBe('दुकान-One');
    expect(unicodeFilenamePart('Café "x"/y\r\n')).toBe('Café-x-y');
    expect(unicodeFilenamePart('‮gnp.exe')).toBe('gnp-exe');
    expect(unicodeFilenamePart('***')).toBe('export');
    expect([...unicodeFilenamePart('क'.repeat(80))]).toHaveLength(60);
  });

  it('Content-Disposition: an ASCII filename= and an RFC 5987 filename*=UTF-8 (percent-encoded)', () => {
    const range = { from: '2026-10-01', to: '2026-10-31' };
    expect(csvContentDisposition('Shop One', 'orders', range)).toBe(
      `attachment; filename="Shop-One-orders-2026-10-01_2026-10-31.csv"; filename*=UTF-8''Shop-One-orders-2026-10-01_2026-10-31.csv`,
    );
    expect(csvContentDisposition('दुकान', 'expenses', {})).toBe(
      `attachment; filename="export-expenses.csv"; filename*=UTF-8''%E0%A4%A6%E0%A5%81%E0%A4%95%E0%A4%BE%E0%A4%A8-expenses.csv`,
    );
    const header = csvContentDisposition(`a'b(c)*"d;e`, 'orders', {});
    expect(header).toBe(
      `attachment; filename="a-b-c-d-e-orders.csv"; filename*=UTF-8''a-b-c-d-e-orders.csv`,
    );
    expect(header).not.toMatch(/[\r\n]/);
  });
});
