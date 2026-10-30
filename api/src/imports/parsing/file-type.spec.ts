import {
  cleanFilename,
  detectReportType,
  UNSUPPORTED_TYPE_REASON,
} from './file-type';
import { FileRejectedError } from './file-rejected.error';

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const TEXT = Buffer.from('Sub Order No,Order Date\n');

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof FileRejectedError) return err.details[0].reasons[0];
    throw err;
  }
  throw new Error('expected a FileRejectedError');
}

describe('detectReportType', () => {
  it('.csv text → orders_csv; .xlsx zip → settlement_xlsx (extension case-insensitive)', () => {
    expect(detectReportType('orders.csv', TEXT)).toBe('orders_csv');
    expect(detectReportType('ORDERS.CSV', TEXT)).toBe('orders_csv');
    expect(detectReportType('payments.xlsx', ZIP)).toBe('settlement_xlsx');
    expect(detectReportType('Payments.XLSX', ZIP)).toBe('settlement_xlsx');
  });

  it('content must agree with the extension', () => {
    expect(reasonOf(() => detectReportType('orders.csv', ZIP))).toMatch(
      /actually a ZIP\/Excel file/,
    );
    expect(reasonOf(() => detectReportType('payments.xlsx', TEXT))).toMatch(
      /not a valid \.xlsx workbook/,
    );
  });

  it.each([
    'orders.xls',
    'orders.txt',
    'orders',
    'orders.csv.exe',
    'payments.xlsm',
    'a.json',
  ])('%p is an unsupported type', (name) => {
    expect(reasonOf(() => detectReportType(name, TEXT))).toBe(
      UNSUPPORTED_TYPE_REASON,
    );
  });

  it('an empty file is rejected', () => {
    expect(
      reasonOf(() => detectReportType('orders.csv', Buffer.alloc(0))),
    ).toBe('The file is empty');
  });
});

describe('cleanFilename', () => {
  it('keeps the last path segment, drops control characters, collapses spaces', () => {
    expect(cleanFilename('C:\\Users\\me\\orders  oct.csv', 'orders_csv')).toBe(
      'orders oct.csv',
    );
    expect(cleanFilename('../../etc/passwd.csv', 'orders_csv')).toBe(
      'passwd.csv',
    );
    expect(cleanFilename('ord\u0000ers\u001f.csv', 'orders_csv')).toBe(
      'orders.csv',
    );
    expect(cleanFilename('रिपोर्ट.xlsx', 'settlement_xlsx')).toBe(
      'रिपोर्ट.xlsx',
    );
  });

  it('drops zero-width and bidi format characters (no "invoice\u202ecsv.exe" spoofing)', () => {
    expect(
      cleanFilename('pay\u200bments\u202e\u2066.xlsx', 'settlement_xlsx'),
    ).toBe('payments.xlsx');
    expect(cleanFilename('\u200b\u200d', 'orders_csv')).toBe('orders.csv');
  });

  it('falls back to a generic name and caps the length at 255 characters', () => {
    expect(cleanFilename('  ', 'orders_csv')).toBe('orders.csv');
    expect(cleanFilename('/', 'settlement_xlsx')).toBe('settlement.xlsx');
    expect([
      ...cleanFilename(`${'é'.repeat(300)}.csv`, 'orders_csv'),
    ]).toHaveLength(255);
  });
});
