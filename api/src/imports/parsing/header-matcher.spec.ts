import {
  ORDERS_CSV_FIELDS,
  PROFILE_VERSION,
  SETTLEMENT_SHEET_PROFILES,
  type FieldSpec,
} from '../profiles/meesho-profiles';
import {
  fieldForHeader,
  findHeaderRow,
  headerProblems,
  matchHeaders,
  profileForSheet,
} from './header-matcher';
import { normalizeHeader } from './normalizers';

const orderPayments = SETTLEMENT_SHEET_PROFILES.find(
  (p) => p.key === 'order_payments',
) as {
  fields: readonly FieldSpec[];
};

const keyOf = (header: string, fields: readonly FieldSpec[]) =>
  fieldForHeader(normalizeHeader(header), fields)?.key;

describe('profiles (version 1)', () => {
  it('is version 1', () => {
    expect(PROFILE_VERSION).toBe(2);
  });

  it('no alias or prefix of one field is claimed by another field of the same profile', () => {
    const profiles = [
      { name: 'orders_csv', fields: ORDERS_CSV_FIELDS },
      ...SETTLEMENT_SHEET_PROFILES.map((p) => ({
        name: p.key,
        fields: p.fields,
      })),
    ];
    for (const { name, fields } of profiles) {
      for (const field of fields) {
        for (const alias of field.aliases) {
          expect({ name, alias, matched: keyOf(alias, fields) }).toEqual({
            name,
            alias,
            matched: field.key,
          });
        }
      }
      const keys = fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('settlement sheet keys and names are unique', () => {
    const keys = SETTLEMENT_SHEET_PROFILES.map((p) => p.key);
    const names = SETTLEMENT_SHEET_PROFILES.flatMap((p) =>
      p.names.map(normalizeHeader),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('fieldForHeader', () => {
  it('matches exact aliases in any case / punctuation', () => {
    expect(keyOf('SUB ORDER NO', ORDERS_CSV_FIELDS)).toBe('subOrderNo');
    expect(keyOf('Sub-Order Number', ORDERS_CSV_FIELDS)).toBe('subOrderNo');
    expect(keyOf('suborder_no', ORDERS_CSV_FIELDS)).toBe('subOrderNo');
    expect(keyOf('Reason for Credit Entry', ORDERS_CSV_FIELDS)).toBe('status');
    expect(keyOf('Qty', ORDERS_CSV_FIELDS)).toBe('quantity');
  });

  it('matches prefix aliases (header drift in the bracketed suffix)', () => {
    expect(
      keyOf(
        'Supplier Listed Price (Incl. GST + Commission)',
        ORDERS_CSV_FIELDS,
      ),
    ).toBe('supplierListedPrice');
    expect(
      keyOf(
        'Supplier Discounted Price (Incl GST and Commision)',
        ORDERS_CSV_FIELDS,
      ),
    ).toBe('supplierDiscountedPrice');
    expect(
      keyOf('Total Sale Amount (Incl. Shipping & GST)', orderPayments.fields),
    ).toBe('saleAmount');
    expect(
      keyOf(
        'Total Sale Return Amount (Incl. Shipping & GST)',
        orderPayments.fields,
      ),
    ).toBe('returnAmount');
    expect(keyOf('Meesho Commission (Incl. GST)', orderPayments.fields)).toBe(
      'commissionAmount',
    );
    expect(keyOf('Shipping Charge (Incl. GST)', orderPayments.fields)).toBe(
      'shippingCharge',
    );
  });

  it('does not take "Meesho Commission Percentage" for the commission amount', () => {
    expect(
      keyOf('Meesho Commission Percentage', orderPayments.fields),
    ).toBeUndefined();
    expect(
      keyOf('Meesho commission percentage (%)', orderPayments.fields),
    ).toBeUndefined();
  });

  it('a prefix must match from the start; unknown headers match nothing', () => {
    expect(
      keyOf('Net Supplier Listed Price', ORDERS_CSV_FIELDS),
    ).toBeUndefined();
    expect(keyOf('Customer Name', ORDERS_CSV_FIELDS)).toBeUndefined();
    expect(keyOf('', ORDERS_CSV_FIELDS)).toBeUndefined();
  });
});

describe('matchHeaders', () => {
  it('maps columns, lists recognised / ignored / missing optional columns', () => {
    const match = matchHeaders(
      [
        'Sub Order No',
        'Order Date',
        'Customer Name',
        'Reason for Credit Entry',
        '',
        'Quantity',
        'Phone',
      ],
      ORDERS_CSV_FIELDS,
    );
    expect(match.columns.map((c) => [c.field.key, c.index])).toEqual([
      ['subOrderNo', 0],
      ['orderDate', 1],
      ['status', 3],
      ['quantity', 5],
    ]);
    expect(match.recognised).toEqual([
      'Sub Order No',
      'Order Date',
      'Reason for Credit Entry',
      'Quantity',
    ]);
    expect(match.ignored).toEqual(['Customer Name', 'Phone']);
    expect(match.missingRequired).toEqual([]);
    expect(match.missingOptional.map((f) => f.label)).toEqual([
      'Order No',
      'Catalog ID',
      'Customer State',
      'Product Name',
      'SKU',
      'Size',
      'Supplier Listed Price',
      'Supplier Discounted Price',
      'Packet Id',
    ]);
    expect(headerProblems(match)).toEqual([]);
  });

  it('two columns for one field → duplicate (file rejected), naming both', () => {
    const match = matchHeaders(
      [
        'Sub Order No',
        'Suborder Number',
        'Order Date',
        'Status',
        'Qty',
        'Sub Order Number',
      ],
      ORDERS_CSV_FIELDS,
    );
    expect(match.duplicates.map((d) => [d.field.key, d.headers])).toEqual([
      ['subOrderNo', ['Sub Order No', 'Suborder Number', 'Sub Order Number']],
    ]);
    expect(headerProblems(match)).toEqual([
      'Columns "Sub Order No" and "Suborder Number" and "Sub Order Number" all match "Sub Order No"; keep only one',
    ]);
  });

  it('two prefix matches for one field are a duplicate too', () => {
    const match = matchHeaders(
      [
        'Sub Order No',
        'Order Date',
        'Status',
        'Qty',
        'Supplier Listed Price (Incl GST)',
        'Supplier Listed Price (Excl GST)',
      ],
      ORDERS_CSV_FIELDS,
    );
    expect(headerProblems(match)).toEqual([
      'Columns "Supplier Listed Price (Incl GST)" and "Supplier Listed Price (Excl GST)" both match "Supplier Listed Price"; keep only one',
    ]);
  });

  it('missing required columns are named with their accepted spellings', () => {
    const match = matchHeaders(['Order Date', 'SKU'], ORDERS_CSV_FIELDS);
    expect(headerProblems(match)).toEqual([
      'Missing required column "Sub Order No" (also accepted: "Sub Order Number", "Suborder No")',
      'Missing required column "Reason for Credit Entry" (also accepted: "Order Status", "Status")',
      'Missing required column "Quantity" (also accepted: "Qty")',
    ]);
  });
});

describe('findHeaderRow', () => {
  const required = [
    'Sub Order No',
    'Transaction ID',
    'Payment Date',
    'Final Settlement Amount',
  ];

  it('picks the first of the candidate rows that has every required column', () => {
    const found = findHeaderRow(
      [
        { rowNumber: 1, cells: ['Payments to date: October 2026'] },
        { rowNumber: 3, cells: ['Sub Order No', 'Something'] },
        { rowNumber: 4, cells: [null, ...required, 'TCS'] },
        { rowNumber: 5, cells: required },
      ],
      orderPayments.fields,
    );
    expect(found?.rowNumber).toBe(4);
    expect(found?.complete).toBe(true);
    expect(found?.match.columns.map((c) => c.index)).toEqual([1, 2, 3, 4, 5]);
  });

  it('without a complete row, returns the closest one for the error message', () => {
    const found = findHeaderRow(
      [
        { rowNumber: 1, cells: ['Title'] },
        { rowNumber: 2, cells: ['Sub Order No', 'Amount'] },
      ],
      orderPayments.fields,
    );
    expect(found?.rowNumber).toBe(2);
    expect(found?.complete).toBe(false);
    expect(found?.match.missingRequired.map((f) => f.key)).toEqual([
      'transactionId',
      'paymentDate',
      'settlementAmount',
    ]);
    expect(findHeaderRow([], orderPayments.fields)).toBeNull();
  });
});

describe('profileForSheet', () => {
  it.each([
    ['Order Payments', 'order_payments'],
    ['order payments', 'order_payments'],
    ['ORDER_PAYMENT', 'order_payments'],
    ['Ads Cost', 'ads_cost'],
    ['Referral Payments', 'referral_payments'],
    ['Compensation and Recovery', 'compensation_recovery'],
    ['Compensation & Recovery', 'compensation_recovery'],
  ])('%p → %p', (name, key) => {
    expect(profileForSheet(name, SETTLEMENT_SHEET_PROFILES)?.key).toBe(key);
  });

  it.each(['Disclaimer', 'Summary', 'Order Payments 2', ''])(
    '%p is not recognised',
    (name) => {
      expect(profileForSheet(name, SETTLEMENT_SHEET_PROFILES)).toBeUndefined();
    },
  );
});

describe('header names are bounded', () => {
  it('a header longer than 100 characters is cut (in recognised / ignored lists and messages)', () => {
    const long = `Notes ${'x'.repeat(300)}`;
    const match = matchHeaders(
      ['Sub Order No', 'Status', 'Order Date', 'Quantity', long],
      ORDERS_CSV_FIELDS,
    );
    expect([...match.ignored[0]]).toHaveLength(100);
    expect(match.ignored[0].endsWith('…')).toBe(true);
  });

  it('format characters in a header are ignored when matching', () => {
    const match = matchHeaders(
      ['Sub\u200b Order No', '\ufeffStatus', 'Order Date', 'Quantity'],
      ORDERS_CSV_FIELDS,
    );
    expect(match.missingRequired).toEqual([]);
    expect(match.recognised[0]).toBe('Sub Order No');
  });
});

describe('Order Payments (profile v2)', () => {
  it('requires Sub Order No, Transaction ID, Payment Date and Final Settlement Amount columns', () => {
    expect(
      orderPayments.fields.filter((f) => f.required).map((f) => f.key),
    ).toEqual([
      'subOrderNo',
      'transactionId',
      'paymentDate',
      'settlementAmount',
    ]);
    expect(
      orderPayments.fields.filter((f) => f.blankAllowed).map((f) => f.key),
    ).toEqual(['transactionId', 'paymentDate']);
  });
});
