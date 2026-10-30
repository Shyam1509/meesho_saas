import { FileRejectedError } from './file-rejected.error';
import { parseOrdersCsv } from './orders-parser';

const LIMITS = { maxRows: 100 };

function parse(csv: string, limits = LIMITS) {
  return parseOrdersCsv(csv, limits);
}

function rejection(csv: string, limits = LIMITS): FileRejectedError {
  try {
    parse(csv, limits);
  } catch (err) {
    if (err instanceof FileRejectedError) return err;
    throw err;
  }
  throw new Error('expected a FileRejectedError');
}

const HEADER =
  'Reason for Credit Entry,Sub Order No,Order Date,Customer State,Product Name,SKU,Size,Quantity,' +
  'Supplier Listed Price (Incl. GST + Commission),Supplier Discounted Price (Incl GST and Commision),Packet Id,Catalog ID';

describe('parseOrdersCsv', () => {
  it('normalises the mapped columns and summarises the sheet', () => {
    const report = parse(
      `${HEADER}\n` +
        'DELIVERED,1001_1,05-10-2026,Gujarat,"Kurti, cotton",SKU-1,XL,2,"₹1,099.00",999,PKT1,CAT1\n' +
        'SHIPPED,1002_1,2026-10-07 10:15,Maharashtra,Saree,SKU-2,,1,500,450.5,,\n',
    );
    expect(report.reportType).toBe('orders_csv');
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]).toEqual({
      sheetName: '',
      rowNumber: 2,
      errors: [],
      values: {
        status: 'DELIVERED',
        subOrderNo: '1001_1',
        orderDate: '2026-10-05',
        customerState: 'Gujarat',
        productName: 'Kurti, cotton',
        sku: 'SKU-1',
        size: 'XL',
        quantity: '2',
        supplierListedPrice: '1099.00',
        supplierDiscountedPrice: '999.00',
        packetId: 'PKT1',
        catalogId: 'CAT1',
      },
      rowHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
    });
    expect(report.rows[1].values).toEqual(
      expect.objectContaining({
        orderDate: '2026-10-07',
        size: null,
        supplierDiscountedPrice: '450.50',
        packetId: null,
        catalogId: null,
      }),
    );
    expect(report.periodStart).toBe('2026-10-05');
    expect(report.periodEnd).toBe('2026-10-07');
    expect(report.sheets).toEqual([
      {
        name: '',
        entryType: null,
        ignored: false,
        rows: 2,
        validRows: 2,
        errorRows: 0,
        recognisedColumns: HEADER.split(','),
        missingOptionalColumns: ['Order No'],
        ignoredColumns: [],
      },
    ]);
  });

  it('header drift: extra columns ignored (never stored), alias-renamed and missing optional columns', () => {
    const report = parse(
      'Customer Phone,Suborder No,Order Status,Order Date,Qty,Buyer Address\n' +
        '+91 99999 00000,2001_1,RTO,01/10/2026,1,"12 Some Street"\n',
    );
    expect(report.rows[0].values).toEqual({
      subOrderNo: '2001_1',
      status: 'RTO',
      orderDate: '2026-10-01',
      quantity: '1',
    });
    expect(JSON.stringify(report)).not.toContain('99999');
    expect(JSON.stringify(report.rows)).not.toContain('Some Street');
    expect(report.sheets[0].ignoredColumns).toEqual([
      'Customer Phone',
      'Buyer Address',
    ]);
    expect(report.sheets[0].recognisedColumns).toEqual([
      'Suborder No',
      'Order Status',
      'Order Date',
      'Qty',
    ]);
    expect(report.sheets[0].missingOptionalColumns).toHaveLength(9);
  });

  it('a UTF-8 BOM before the header does not hide the first column', () => {
    const report = parseOrdersCsv(
      '\ufeffSub Order No,Status,Order Date,Quantity\n1,X,2026-10-01,1\n',
      LIMITS,
    );
    expect(report.rows[0].values.subOrderNo).toBe('1');
  });

  it('row errors: field key + column name in the reason, raw text kept, other rows still valid', () => {
    const report = parse(
      'Sub Order No,Status,Order Date,Quantity,Supplier Listed Price\n' +
        '1,DELIVERED,10/25/2026,0,12.345\n' +
        '2,,2026-10-01,1,\n' +
        '3,SHIPPED,2026-10-02,1,10\n',
    );
    expect(
      report.rows.map((r) => [r.rowNumber, r.errors.map((e) => e.field)]),
    ).toEqual([
      [2, ['orderDate', 'quantity', 'supplierListedPrice']],
      [3, ['status']],
      [4, []],
    ]);
    expect(report.rows[0].errors[0].reason).toBe(
      '"Order Date" is not a valid date (use DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD or DD Mon YYYY)',
    );
    expect(report.rows[1].errors[0].reason).toBe('"Status" is required');
    expect(report.rows[0].values).toEqual(
      expect.objectContaining({
        orderDate: '10/25/2026',
        quantity: '0',
        supplierListedPrice: '12.345',
      }),
    );
    // Error rows have no say in the report period.
    expect([report.periodStart, report.periodEnd]).toEqual([
      '2026-10-02',
      '2026-10-02',
    ]);
    expect(report.sheets[0]).toEqual(
      expect.objectContaining({ rows: 3, validRows: 1, errorRows: 2 }),
    );
  });

  it('blank rows (all mapped cells empty) are skipped and not counted; row numbers stay as in the file', () => {
    const report = parse(
      'Sub Order No,Status,Order Date,Quantity,Notes\n' +
        '\n' +
        ',,,,only an unmapped note\n' +
        '1,X,2026-10-01,1,\n' +
        ' , , , ,\n' +
        '2,X,2026-10-01,1,\n',
    );
    expect(report.rows.map((r) => r.rowNumber)).toEqual([4, 6]);
    expect(report.sheets[0].rows).toBe(2);
  });

  it('a Sub Order No repeated in the file makes the later rows errors', () => {
    const report = parse(
      'Sub Order No,Status,Order Date,Quantity\n1,A,2026-10-01,1\n2,A,2026-10-01,1\n1,B,2026-10-02,1\n1,C,2026-10-03,1\n',
    );
    expect(report.rows.map((r) => r.errors.map((e) => e.reason))).toEqual([
      [],
      [],
      [
        '"Sub Order No" is also on row 2: each sub-order may appear once per file',
      ],
      [
        '"Sub Order No" is also on row 2: each sub-order may appear once per file',
      ],
    ]);
  });

  describe('file-level rejections (no job is created)', () => {
    it('missing required headers', () => {
      expect(
        rejection('Sub Order No,Order Date\n1,2026-10-01\n').details,
      ).toEqual([
        {
          field: 'columns',
          reasons: [
            'Missing required column "Reason for Credit Entry" (also accepted: "Order Status", "Status")',
            'Missing required column "Quantity" (also accepted: "Qty")',
          ],
        },
      ]);
    });

    it('two columns mapping to one field', () => {
      expect(
        rejection(
          'Sub Order No,Status,Order Status,Order Date,Quantity\n1,A,A,2026-10-01,1\n',
        ).details[0].reasons,
      ).toEqual([
        'Columns "Status" and "Order Status" both match "Reason for Credit Entry"; keep only one',
      ]);
    });

    it('empty file, header only, blank first row', () => {
      expect(rejection('').details[0].reasons).toEqual(['The file is empty']);
      expect(
        rejection('Sub Order No,Status,Order Date,Quantity\n').details[0]
          .reasons,
      ).toEqual(['The file has no data rows']);
      expect(
        rejection('\nSub Order No,Status,Order Date,Quantity\n').details[0]
          .reasons,
      ).toEqual(['The first row must be the header row (column names)']);
    });

    it('more data rows than allowed (blank rows do not count)', () => {
      const csv =
        'Sub Order No,Status,Order Date,Quantity\n1,A,2026-10-01,1\n\n2,A,2026-10-01,1\n3,A,2026-10-01,1\n';
      expect(() => parse(csv, { maxRows: 3 })).not.toThrow();
      expect(rejection(csv, { maxRows: 2 }).details[0].reasons).toEqual([
        'The file has more than 2 data rows: split it into smaller date ranges',
      ]);
    });

    it('more physical lines than IMPORT_MAX_ROWS + 1000 (blank lines count) → rejected before parsing', () => {
      const head =
        'Sub Order No,Status,Order Date,Quantity\n1,A,2026-10-01,1\n';
      // maxRows 1 → at most 1001 lines.
      expect(() =>
        parse(head + '\n'.repeat(999), { maxRows: 1 }),
      ).not.toThrow();
      expect(
        rejection(head + '\n'.repeat(1000), { maxRows: 1 }).details,
      ).toEqual([
        {
          field: 'file',
          reasons: [
            'The file has more than 1001 rows or lines (blank ones included): split it into smaller date ranges',
          ],
        },
      ]);
    });

    it('a row with more than 200 columns', () => {
      expect(
        rejection(
          `Sub Order No,Status,Order Date,Quantity\n1,A,2026-10-01,1${','.repeat(200)}\n`,
        ).details[0].reasons,
      ).toEqual([
        'A row uses more than 200 columns: this does not look like a Meesho report',
      ]);
    });
  });

  it('preview column lists are capped at 100 names with an "and N more" entry', () => {
    const extra = Array.from({ length: 150 }, (_, i) => `Extra ${i}`);
    const report = parse(
      `Sub Order No,Status,Order Date,Quantity,${extra.join(',')}\n1,A,2026-10-01,1\n`,
    );
    const ignored = report.sheets[0].ignoredColumns;
    expect(ignored).toHaveLength(101);
    expect(ignored[99]).toBe('Extra 99');
    expect(ignored[100]).toBe('and 50 more');
  });
});
