import * as ExcelJS from 'exceljs';
import { zipSync } from 'fflate';
import { FileRejectedError } from './file-rejected.error';
import { SETTLEMENT_SHEET_PROFILES } from '../profiles/meesho-profiles';
import { fingerprintOf, fingerprintTuple } from './fingerprint';
import type { RawCell } from './normalizers';
import {
  compensationOrRecovery,
  parseSettlementWorkbook,
} from './settlement-parser';
import {
  decodeXmlText,
  elementsOf,
  readWorkbookStructure,
  resolveTarget,
} from './workbook-structure';
import {
  cellToRaw,
  streamWorkbookRows,
  type WorkbookSheet,
} from './xlsx-reader';
import { parseReport } from './report-parser';
import { inspectZip } from './zip-guard';

const LIMITS = { maxRows: 100 };
const PAYMENTS = SETTLEMENT_SHEET_PROFILES[0];

const enc = (text: string) => new TextEncoder().encode(text);
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WORKSHEET_TYPE = `${REL_NS}/worksheet`;

/** Hand-built workbook parts: `sheets` (names already XML-escaped) → r:ids; `rels` r:id → target. */
function workbookFiles(
  sheets: { name: string; rid: string }[],
  rels: { id: string; target: string; type?: string }[],
  parts: Record<string, string>,
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': enc(
      `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>${sheets
        .map(
          (s, i) =>
            `<sheet name="${s.name}" sheetId="${i + 1}" r:id="${s.rid}"/>`,
        )
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': enc(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
        .map(
          (r) =>
            `<Relationship Id="${r.id}" Type="${r.type ?? WORKSHEET_TYPE}" Target="${r.target}"/>`,
        )
        .join('')}</Relationships>`,
    ),
  };
  for (const [path, xml] of Object.entries(parts)) files[path] = enc(xml);
  return files;
}

/** One sheet named `name` holding `sheetData` rows. */
function sheetZip(name: string, sheetData: string): Record<string, Uint8Array> {
  return workbookFiles(
    [{ name, rid: 'rId1' }],
    [{ id: 'rId1', target: 'worksheets/sheet1.xml' }],
    {
      'xl/worksheets/sheet1.xml': `<worksheet xmlns="${MAIN_NS}"><sheetData>${sheetData}</sheetData></worksheet>`,
    },
  );
}

const PAYMENTS_SHEET_DATA =
  '<row r="1"><c r="A1" t="inlineStr"><is><t>Sub Order No</t></is></c><c r="B1" t="inlineStr"><is><t>Transaction ID</t></is></c>' +
  '<c r="C1" t="inlineStr"><is><t>Payment Date</t></is></c><c r="D1" t="inlineStr"><is><t>Final Settlement Amount</t></is></c></row>' +
  '<row r="2"><c r="A2" t="inlineStr"><is><t>SO-1</t></is></c><c r="C2" t="inlineStr"><is><t>2026-10-12</t></is></c><c r="D2"><v>5</v></c></row>';

async function parseRejection(zip: Buffer): Promise<FileRejectedError> {
  try {
    await parseReport('payments.xlsx', zip, LIMITS);
  } catch (err) {
    if (err instanceof FileRejectedError) return err;
    throw err;
  }
  throw new Error('expected a FileRejectedError');
}

function sheet(name: string, rows: RawCell[][], firstRow = 1): WorkbookSheet {
  return {
    name,
    rows: rows.map((cells, i) => ({ rowNumber: firstRow + i, cells })),
  };
}

function rejection(
  sheets: WorkbookSheet[],
  limits = LIMITS,
): FileRejectedError {
  try {
    parseSettlementWorkbook(sheets, limits);
  } catch (err) {
    if (err instanceof FileRejectedError) return err;
    throw err;
  }
  throw new Error('expected a FileRejectedError');
}

const PAYMENT_HEADER = [
  'Sub Order No',
  'Transaction ID',
  'Order Date',
  'Payment Date',
  'Final Settlement Amount',
  'Total Sale Amount (Incl. Shipping & GST)',
  'Meesho Commission (Incl. GST)',
  'Meesho Commission Percentage',
  'TCS',
];

describe('compensationOrRecovery', () => {
  it.each([
    ['Recovery', '100.00', 'recovery'],
    ['Logistics recovery', '100.00', 'recovery'],
    ['Compensation', '-5.00', 'compensation'],
    ['Lost shipment compensation', '5.00', 'compensation'],
    ['Compensation recovery', '-5.00', 'recovery'],
    ['Compensation recovery', '5.00', 'compensation'],
    [null, '-1.00', 'recovery'],
    ['', '0.00', 'compensation'],
    ['Other', '12.00', 'compensation'],
  ])('type %p, amount %p → %p', (label, amount, expected) => {
    expect(compensationOrRecovery(label, amount)).toBe(expected);
  });
});

describe('parseSettlementWorkbook', () => {
  it('reads recognised sheets, ignores Disclaimer / unknown ones, finds a header below a title row', () => {
    const report = parseSettlementWorkbook(
      [
        sheet('Disclaimer', [['All figures are provisional']]),
        sheet('Order Payments', [
          ['Settlement report October'],
          PAYMENT_HEADER,
          [
            '1001_1',
            'TXN-1',
            new Date(Date.UTC(2026, 9, 1)),
            '08-10-2026',
            250,
            300,
            -30,
            10,
            1.5,
          ],
          [],
          [
            '1002_1',
            'TXN-1',
            '2026-10-02',
            '08-10-2026',
            '-120.50',
            null,
            null,
            null,
            null,
          ],
        ]),
        sheet('Ads Cost', [
          ['Campaign ID', 'Deduction Date', 'Total Ads Cost (Incl. GST)'],
          ['CMP-1', '09/10/2026', -75],
        ]),
        sheet('Pivot', [['x']]),
      ],
      LIMITS,
    );
    expect(report.reportType).toBe('settlement_xlsx');
    expect(
      report.sheets.map((s) => [s.name, s.entryType, s.ignored, s.rows]),
    ).toEqual([
      ['Disclaimer', null, true, 0],
      ['Order Payments', 'order_payment', false, 2],
      ['Ads Cost', 'ads_cost', false, 1],
      ['Pivot', null, true, 0],
    ]);
    const payments = report.sheets[1];
    expect(payments.ignoredColumns).toEqual(['Meesho Commission Percentage']);
    expect(payments.missingOptionalColumns).toEqual([
      'Total Sale Return Amount',
      'Shipping Charge',
      'TDS',
      'Recovery',
      'Compensation',
    ]);
    expect(report.rows.map((r) => [r.sheetName, r.rowNumber])).toEqual([
      ['Order Payments', 3],
      ['Order Payments', 5],
      ['Ads Cost', 2],
    ]);
    expect(report.rows[0].values).toEqual({
      subOrderNo: '1001_1',
      transactionId: 'TXN-1',
      orderDate: '2026-10-01',
      paymentDate: '2026-10-08',
      settlementAmount: '250.00',
      saleAmount: '300.00',
      commissionAmount: '-30.00',
      tcsAmount: '1.50',
      entryType: 'order_payment',
    });
    expect(report.rows[2].values).toEqual({
      transactionId: 'CMP-1',
      paymentDate: '2026-10-09',
      settlementAmount: '-75.00',
      entryType: 'ads_cost',
    });
    expect(report.rows[0].rowHash).toBe(
      fingerprintOf(fingerprintTuple(PAYMENTS, report.rows[0].values), 0),
    );
    expect([report.periodStart, report.periodEnd]).toEqual([
      '2026-10-08',
      '2026-10-09',
    ]);
  });

  it('repeated transaction IDs with identical values stay separate rows with different fingerprints', () => {
    const row = ['1001_1', 'TXN-1', '2026-10-01', '2026-10-08', '10.00'];
    const report = parseSettlementWorkbook(
      [
        sheet('Order Payments', [
          PAYMENT_HEADER.slice(0, 5),
          row,
          row,
          ['1001_1', 'TXN-1', '2026-10-01', '2026-10-08', '11.00'],
        ]),
      ],
      LIMITS,
    );
    const hashes = report.rows.map((r) => r.rowHash);
    expect(new Set(hashes).size).toBe(3);
    const tuple = fingerprintTuple(PAYMENTS, report.rows[0].values);
    expect(hashes.slice(0, 2)).toEqual([
      fingerprintOf(tuple, 0),
      fingerprintOf(tuple, 1),
    ]);
  });

  it('Compensation and Recovery: entry type per row from Type, else from the sign', () => {
    const report = parseSettlementWorkbook(
      [
        sheet('Compensation & Recovery', [
          ['Date', 'Amount', 'Type', 'Reason'],
          ['2026-10-03', '-40', 'Recovery', 'free text that is not stored'],
          ['2026-10-04', '25', '', 'free text'],
          ['2026-10-05', '-5', '', ''],
        ]),
      ],
      LIMITS,
    );
    expect(report.rows.map((r) => r.values.entryType)).toEqual([
      'recovery',
      'compensation',
      'recovery',
    ]);
    expect(report.sheets[0].entryType).toBe('compensation_or_recovery');
    expect(report.sheets[0].ignoredColumns).toEqual(['Reason']);
    expect(JSON.stringify(report.rows)).not.toContain('free text');
  });

  it('row errors keep the row out of fingerprinting', () => {
    const report = parseSettlementWorkbook(
      [
        sheet('Order Payments', [
          PAYMENT_HEADER.slice(0, 5),
          ['1', 'T', '2026-10-01', '31/02/2026', 'abc'],
        ]),
      ],
      LIMITS,
    );
    expect(report.rows[0].errors.map((e) => e.field)).toEqual([
      'paymentDate',
      'settlementAmount',
    ]);
    expect(report.rows[0].rowHash).toBeNull();
    expect(report.rows[0].values.entryType).toBeUndefined();
  });

  it('an empty recognised sheet contributes nothing (not an error)', () => {
    const report = parseSettlementWorkbook(
      [
        sheet('Ads Cost', []),
        sheet('Order Payments', [
          PAYMENT_HEADER.slice(0, 5),
          ['1', 'T', null, null, 5],
        ]),
      ],
      LIMITS,
    );
    expect(report.sheets[0]).toEqual(
      expect.objectContaining({ name: 'Ads Cost', ignored: false, rows: 0 }),
    );
    expect(report.rows).toHaveLength(1);
  });

  describe('file-level rejections', () => {
    it('no recognised sheet', () => {
      expect(
        rejection([sheet('Disclaimer', [['x']]), sheet('Sheet1', [['a']])])
          .details,
      ).toEqual([
        {
          field: 'sheets',
          reasons: [
            'No recognised sheet: expected one of Order Payments, Ads Cost, Referral Payments, Compensation and Recovery',
          ],
        },
      ]);
    });

    it('every sheet missing required columns is reported at once', () => {
      expect(
        rejection([
          sheet('Order Payments', [
            ['Sub Order No', 'Amount'],
            ['1', '5'],
          ]),
          sheet('Referral Payments', [['Referral Amount'], ['5']]),
        ]).details,
      ).toEqual([
        {
          field: 'sheets.Order Payments',
          reasons: [
            'Missing required column "Transaction ID"',
            'Missing required column "Payment Date"',
            'Missing required column "Final Settlement Amount"',
          ],
        },
        {
          field: 'sheets.Referral Payments',
          reasons: [
            'Missing required column "Payment Date" (also accepted: "Date")',
          ],
        },
      ]);
    });

    it('the header must be within the first 10 non-empty rows', () => {
      const title = Array.from({ length: 10 }, (_, i) => [`note ${i}`]);
      expect(
        rejection([
          sheet('Ads Cost', [
            ...title,
            ['Deduction Date', 'Total Ads Cost'],
            ['2026-10-01', '5'],
          ]),
        ]).details[0].field,
      ).toBe('sheets.Ads Cost');
    });

    it('no data rows in the recognised sheets', () => {
      expect(
        rejection([sheet('Order Payments', [PAYMENT_HEADER])]).details[0]
          .reasons,
      ).toEqual(['The workbook has no data rows in its recognised sheets']);
    });

    it('too many data rows across all sheets', () => {
      const sheets = [
        sheet('Ads Cost', [
          ['Date', 'Ads Cost'],
          ['2026-10-01', '1'],
          ['2026-10-02', '2'],
        ]),
        sheet('Referral Payments', [
          ['Date', 'Amount'],
          ['2026-10-01', '1'],
        ]),
      ];
      expect(() =>
        parseSettlementWorkbook(sheets, { maxRows: 3 }),
      ).not.toThrow();
      expect(rejection(sheets, { maxRows: 2 }).details[0].reasons).toEqual([
        'The file has more than 2 data rows: split it into smaller date ranges',
      ]);
    });
  });
});

describe('xlsx reader', () => {
  it('cellToRaw reduces formulas, rich text, hyperlinks and errors to plain values', () => {
    expect(cellToRaw({ formula: 'A1*2', result: 12.5 })).toBe(12.5);
    expect(cellToRaw({ formula: 'A1' })).toBeNull();
    expect(
      cellToRaw({
        richText: [{ text: 'Ord' }, { text: 'er' }],
      }),
    ).toBe('Order');
    expect(cellToRaw({ text: 'SKU-1', hyperlink: 'https://x' })).toBe('SKU-1');
    expect(cellToRaw({ error: '#N/A' })).toBe('#N/A');
    expect(cellToRaw(undefined)).toBeNull();
  });

  /** Every sheet's streamed rows (names from workbook.xml), through the production path. */
  async function readAll(
    buffer: Buffer,
    maxPhysicalRows = 10_000,
  ): Promise<WorkbookSheet[]> {
    const structure = readWorkbookStructure(buffer, inspectZip(buffer));
    const sheets: WorkbookSheet[] = structure.sheets.map((s) => ({
      name: s.name,
      rows: [],
    }));
    await streamWorkbookRows(
      buffer,
      structure,
      structure.sheets,
      (i) => ({
        row: (rowNumber, cells) => {
          sheets[i].rows.push({ rowNumber, cells });
          return true;
        },
      }),
      { maxPhysicalRows, tooManyRowsReason: 'too many rows' },
    );
    return sheets;
  }

  it('streams a real exceljs workbook: sheet order, row numbers, dates as UTC, sparse cells', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Order Payments');
    ws.getCell('A1').value = 'Sub Order No';
    ws.getCell('C1').value = 'Final Settlement Amount';
    ws.getCell('A3').value = '1001_1';
    ws.getCell('B3').value = new Date(Date.UTC(2026, 9, 5));
    ws.getCell('C3').value = { formula: '100+50', result: 150 };
    workbook.addWorksheet('Disclaimer').getCell('A1').value = 'x';
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const sheets = await readAll(buffer);
    expect(sheets.map((s) => s.name)).toEqual(['Order Payments', 'Disclaimer']);
    expect(sheets[0].rows).toEqual([
      {
        rowNumber: 1,
        cells: ['Sub Order No', null, 'Final Settlement Amount'],
      },
      { rowNumber: 3, cells: ['1001_1', new Date(Date.UTC(2026, 9, 5)), 150] },
    ]);
    expect(sheets[1].rows).toEqual([{ rowNumber: 1, cells: ['x'] }]);
  });

  it('finds sheets through the relationships: absolute targets, any part name, escaped names, data descriptors', async () => {
    const enc = (text: string) => new TextEncoder().encode(text);
    const files = {
      'xl/workbook.xml': enc(
        '<?xml version="1.0"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets>' +
          '<x:sheet name="Compensation &amp; Recovery" sheetId="1" r:id="rId7"/></x:sheets></x:workbook>',
      ),
      'xl/_rels/workbook.xml.rels': enc(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/data.xml"/></Relationships>',
      ),
      'xl/worksheets/data.xml': enc(
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
          '<row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>2026-10-03</t></is></c><c r="B2"><v>-40</v></c></row>' +
          '</sheetData></worksheet>',
      ),
    };
    const sheets = await readAll(Buffer.from(zipSync(files)));
    expect(sheets).toEqual([
      {
        name: 'Compensation & Recovery',
        rows: [
          { rowNumber: 1, cells: ['Date', 'Amount'] },
          { rowNumber: 2, cells: ['2026-10-03', -40] },
        ],
      },
    ]);
  });

  it('counts rows as they stream and stops at the cap (a large but small-enough workbook)', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Ads Cost');
    ws.addRow(['Date', 'Ads Cost']);
    for (let i = 0; i < 5000; i++) ws.addRow(['2026-10-01', i]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    let seen = 0;
    const structure = readWorkbookStructure(buffer, inspectZip(buffer));
    await expect(
      streamWorkbookRows(
        buffer,
        structure,
        structure.sheets,
        () => ({
          row: () => {
            seen += 1;
            return true;
          },
        }),
        { maxPhysicalRows: 100, tooManyRowsReason: 'too many rows' },
      ),
    ).rejects.toEqual(FileRejectedError.of('file', 'too many rows'));
    expect(seen).toBe(100);
  });

  it('a value beyond column 200 rejects the file', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Ads Cost');
    ws.getCell(1, 1).value = 'Date';
    ws.getCell(1, 201).value = 'far away';
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(readAll(buffer)).rejects.toEqual(
      FileRejectedError.of(
        'file',
        'A row uses more than 200 columns: this does not look like a Meesho report',
      ),
    );
  });

  it('an EMPTY cell far to the right (column XFD) rejects the file at its first row, before reading the rest', async () => {
    // Behavioural, not wall-clock: the row cap is 2 (header + the first XFD row). The column check must
    // fire on row 2; if the reader went on to row 3 of the 3000, the cap would reject it as "too many rows"
    // instead, and the visitor sees only the header.
    const rows = [
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c></row>',
    ];
    for (let r = 2; r <= 3000; r++) {
      rows.push(
        `<row r="${r}"><c r="XFD${r}" t="inlineStr"><is><t></t></is></c></row>`,
      );
    }
    const zip = Buffer.from(zipSync(sheetZip('Ads Cost', rows.join(''))));
    let seen = 0;
    const structure = readWorkbookStructure(zip, inspectZip(zip));
    await expect(
      streamWorkbookRows(
        zip,
        structure,
        structure.sheets,
        () => ({
          row: () => {
            seen += 1;
            return true;
          },
        }),
        { maxPhysicalRows: 2, tooManyRowsReason: 'too many rows' },
      ),
    ).rejects.toEqual(
      FileRejectedError.of(
        'file',
        'A row uses more than 200 columns: this does not look like a Meesho report',
      ),
    );
    expect(seen).toBe(1);
  });

  it('a ZIP without any worksheet is not a workbook', () => {
    const zip = Buffer.from(
      zipSync({ 'hello.txt': new TextEncoder().encode('hi') }),
    );
    expect(() => readWorkbookStructure(zip, inspectZip(zip))).toThrow(
      FileRejectedError,
    );
  });

  it('a truncated sheet XML yields no half rows, and the parse then rejects the file (422, no crash)', async () => {
    const enc = (text: string) => new TextEncoder().encode(text);
    const zip = Buffer.from(
      zipSync({
        'xl/workbook.xml': enc(
          '<workbook><sheets><sheet name="Ads Cost" r:id="rId1"/></sheets></workbook>',
        ),
        'xl/_rels/workbook.xml.rels': enc(
          '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        ),
        'xl/worksheets/sheet1.xml': enc(
          '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Date',
        ),
      }),
    );
    const sheets = await readAll(zip).catch((err: unknown) => err);
    if (!(sheets instanceof FileRejectedError)) {
      expect(sheets).toEqual([{ name: 'Ads Cost', rows: [] }]);
    }
    await expect(
      parseReport('payments.xlsx', zip, { maxRows: 10 }),
    ).rejects.toBeInstanceOf(FileRejectedError);
  });
});

describe('xml helpers of workbook-structure', () => {
  it('decodes entities and resolves targets', () => {
    expect(decodeXmlText('A &amp; B &lt;&#65;&#x42;&gt; &quot;&apos;')).toBe(
      'A & B <AB> "\'',
    );
    expect(resolveTarget('worksheets/sheet1.xml')).toBe(
      'xl/worksheets/sheet1.xml',
    );
    expect(resolveTarget('/xl/worksheets/s.xml')).toBe('xl/worksheets/s.xml');
    expect(resolveTarget('../xl/./worksheets/s.xml')).toBe(
      'xl/worksheets/s.xml',
    );
    expect(
      elementsOf('<a:sheet name="X" r:id="r1"/><sheets/>', 'sheet'),
    ).toEqual([{ name: 'X', id: 'r1' }]);
  });

  it('a character reference that is not an XML character is a malformed workbook, not a crash', () => {
    for (const bad of [
      '&#x110000;',
      '&#0;',
      '&#xD800;',
      '&#99999999999999999999;',
    ]) {
      expect(() => decodeXmlText(`Order Payments${bad}`)).toThrow(
        FileRejectedError,
      );
    }
    expect(decodeXmlText('&#x1F600;')).toBe('\u{1F600}');
  });
});

describe('workbook structure guards (review cases)', () => {
  it('a sheet name with &#x110000; → 422 unreadable (was a RangeError → 500)', async () => {
    const zip = Buffer.from(
      zipSync(sheetZip('Order Payments&#x110000;', PAYMENTS_SHEET_DATA)),
    );
    expect((await parseRejection(zip)).details).toEqual([
      {
        field: 'file',
        reasons: ['The workbook could not be read: is it a valid .xlsx file?'],
      },
    ]);
  });

  it('300 sheets aliasing one part ("Order Payments", "Order Payments.", …) → 422 at once, nothing parsed', async () => {
    const sheets = Array.from({ length: 300 }, (_, k) => ({
      name: `Order Payments${'.'.repeat(k)}`,
      rid: 'rId1',
    }));
    const zip = Buffer.from(
      zipSync(
        workbookFiles(
          sheets,
          [{ id: 'rId1', target: 'worksheets/sheet1.xml' }],
          {
            'xl/worksheets/sheet1.xml': `<worksheet xmlns="${MAIN_NS}"><sheetData>${PAYMENTS_SHEET_DATA}</sheetData></worksheet>`,
          },
        ),
      ),
    );
    const started = Date.now();
    expect((await parseRejection(zip)).details).toEqual([
      { field: 'file', reasons: ['The workbook has more than 50 sheets'] },
    ]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('two sheets on the same part → 422', async () => {
    const zip = Buffer.from(
      zipSync(
        workbookFiles(
          [
            { name: 'Order Payments', rid: 'rId1' },
            { name: 'Copy', rid: 'rId1' },
          ],
          [{ id: 'rId1', target: 'worksheets/sheet1.xml' }],
          {
            'xl/worksheets/sheet1.xml': `<worksheet xmlns="${MAIN_NS}"><sheetData>${PAYMENTS_SHEET_DATA}</sheetData></worksheet>`,
          },
        ),
      ),
    );
    expect((await parseRejection(zip)).details).toEqual([
      {
        field: 'file',
        reasons: [
          'Sheets "Order Payments" and "Copy" point to the same data: this workbook is not supported',
        ],
      },
    ]);
  });

  it('two sheets read as the same kind ("Order Payments" and "Order Payments.") → 422', async () => {
    const sheetXml = `<worksheet xmlns="${MAIN_NS}"><sheetData>${PAYMENTS_SHEET_DATA}</sheetData></worksheet>`;
    const zip = Buffer.from(
      zipSync(
        workbookFiles(
          [
            { name: 'Order Payments', rid: 'rId1' },
            { name: 'Order Payments.', rid: 'rId2' },
          ],
          [
            { id: 'rId1', target: 'worksheets/sheet1.xml' },
            { id: 'rId2', target: 'worksheets/sheet2.xml' },
          ],
          {
            'xl/worksheets/sheet1.xml': sheetXml,
            'xl/worksheets/sheet2.xml': sheetXml,
          },
        ),
      ),
    );
    expect((await parseRejection(zip)).details).toEqual([
      {
        field: 'sheets',
        reasons: [
          'Sheets "Order Payments" and "Order Payments." are both read as "Order Payments": keep only one',
        ],
      },
    ]);
  });

  it('a sheet name longer than 64 characters → 422', async () => {
    const zip = Buffer.from(
      zipSync(
        sheetZip(`Order Payments${' '.repeat(60)}x`, PAYMENTS_SHEET_DATA),
      ),
    );
    expect((await parseRejection(zip)).details[0].reasons[0]).toMatch(
      /^A sheet name is longer than 64 characters/,
    );
  });

  it('shared strings or styles over 20 MB → 422 before they are read', () => {
    const rels = workbookFiles(
      [],
      [
        { id: 'rId1', target: 'worksheets/sheet1.xml' },
        {
          id: 'rId2',
          target: 'sharedStrings.xml',
          type: `${REL_NS}/sharedStrings`,
        },
      ],
      {},
    )['xl/_rels/workbook.xml.rels'];
    const zip = Buffer.from(
      zipSync({
        ...sheetZip('Order Payments', PAYMENTS_SHEET_DATA),
        'xl/_rels/workbook.xml.rels': rels,
      }),
    );
    const entries = inspectZip(zip);
    // Its size was verified by inspectZip in real use; here only the declared size matters.
    const huge = {
      ...entries[0],
      name: 'xl/sharedStrings.xml',
      uncompressedSize: 21 * 1024 * 1024,
    };
    let caught: unknown;
    try {
      readWorkbookStructure(zip, [...entries, huge]);
    } catch (err) {
      caught = err;
    }
    expect((caught as FileRejectedError).details).toEqual([
      {
        field: 'file',
        reasons: [
          "The workbook's shared strings part expands to more than 20 MB and is refused as unsafe",
        ],
      },
    ]);
  });
});
