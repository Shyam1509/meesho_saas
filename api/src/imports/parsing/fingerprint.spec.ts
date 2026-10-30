import { createHash } from 'node:crypto';
import { SETTLEMENT_SHEET_PROFILES } from '../profiles/meesho-profiles';
import {
  FINGERPRINT_VERSION,
  fingerprintOf,
  fingerprintTuple,
  FingerprintSequencer,
  valuesHash,
} from './fingerprint';
import { parseSettlementWorkbook } from './settlement-parser';

const profile = (key: string) => {
  const found = SETTLEMENT_SHEET_PROFILES.find((p) => p.key === key);
  if (!found) throw new Error(key);
  return found;
};
const PAYMENTS = profile('order_payments');

const payment = {
  subOrderNo: '1001_1',
  transactionId: 'TXN-9',
  orderDate: '2026-10-01',
  paymentDate: '2026-10-08',
  settlementAmount: '250.00',
  saleAmount: '300.00',
  returnAmount: null,
  commissionAmount: '-30.00',
  tcsAmount: null,
};

const hashOf = (values: Record<string, string | null>) =>
  fingerprintOf(fingerprintTuple(PAYMENTS, values), 0);

describe('fingerprint v2', () => {
  it('is version 2 over the sheet key and the REQUIRED fields only (no entry type)', () => {
    expect(FINGERPRINT_VERSION).toBe(2);
    expect(fingerprintTuple(PAYMENTS, payment)).toEqual([
      'order_payments',
      '1001_1',
      'TXN-9',
      '2026-10-08',
      '250.00',
    ]);
    expect(
      fingerprintTuple(profile('ads_cost'), {
        settlementAmount: '-75.00',
        paymentDate: '2026-10-09',
        transactionId: 'CMP-1',
      }),
    ).toEqual(['ads_cost', '-75.00', '2026-10-09']);
  });

  it('is stable: sha256 of JSON([...tuple, occurrence]) — a pinned value', () => {
    expect(fingerprintOf(['a', null], 0)).toBe(
      createHash('sha256').update('["a",null,0]').digest('hex'),
    );
    expect(hashOf(payment)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('optional values never matter: absent, blank, zero, changed or extra', () => {
    const base = hashOf(payment);
    for (const variant of [
      { ...payment, tcsAmount: '0.00' },
      { ...payment, tcsAmount: '1.50', commissionAmount: null },
      { ...payment, orderDate: null, saleAmount: '999.00' },
      {
        subOrderNo: '1001_1',
        transactionId: 'TXN-9',
        paymentDate: '2026-10-08',
        settlementAmount: '250.00',
      },
      {
        ...payment,
        typeLabel: 'x',
        productName: 'Kurti',
        entryType: 'recovery',
      },
    ]) {
      expect(hashOf(variant)).toBe(base);
    }
  });

  it('changes with a required value or the sheet key; a blank required value differs from a filled one', () => {
    const base = hashOf(payment);
    for (const variant of [
      { ...payment, settlementAmount: '250.01' },
      { ...payment, transactionId: null },
      { ...payment, paymentDate: null },
    ]) {
      expect(hashOf(variant)).not.toBe(base);
    }
    expect(
      fingerprintOf(fingerprintTuple(profile('referral_payments'), payment), 0),
    ).not.toBe(base);
  });

  it('occurrence index: identical tuples in one file get 0, 1, 2 …; a new file starts again at 0', () => {
    const tuple = fingerprintTuple(PAYMENTS, payment);
    const other = fingerprintTuple(PAYMENTS, {
      ...payment,
      transactionId: 'TXN-10',
    });
    const first = new FingerprintSequencer();
    const run1 = [
      first.next(tuple),
      first.next(other),
      first.next(tuple),
      first.next(tuple),
    ];
    expect(run1).toEqual([
      fingerprintOf(tuple, 0),
      fingerprintOf(other, 0),
      fingerprintOf(tuple, 1),
      fingerprintOf(tuple, 2),
    ]);
    const second = new FingerprintSequencer();
    expect([second.next(tuple), second.next(tuple)]).toEqual([
      run1[0],
      run1[2],
    ]);
  });

  describe('header drift between two files of the same rows (review cases)', () => {
    const limits = { maxRows: 100 };
    const fileHash = (
      sheetName: string,
      header: string[],
      row: (string | number | null)[],
    ) =>
      parseSettlementWorkbook(
        [
          {
            name: sheetName,
            rows: [
              { rowNumber: 1, cells: header },
              { rowNumber: 2, cells: row },
            ],
          },
        ],
        limits,
      ).rows[0].rowHash;
    const REQUIRED = [
      'Sub Order No',
      'Transaction ID',
      'Final Settlement Amount',
      'Payment Date',
    ];
    const payments = (header: string[], row: (string | number | null)[]) =>
      fileHash('Order Payments', header, row);

    it('an optional column renamed so it is no longer recognised → same fingerprint', () => {
      expect(
        payments(
          [...REQUIRED, 'TCS Amount (Rs)'],
          ['SO-1', 'T1', 100, '2026-10-12', 1.5],
        ),
      ).toBe(
        payments([...REQUIRED, 'TCS'], ['SO-1', 'T1', 100, '2026-10-12', 1.5]),
      );
    });

    it('an optional column added → same fingerprint', () => {
      expect(
        payments(
          [...REQUIRED, 'Order Date'],
          ['SO-1', 'T1', 100, '2026-10-12', '2026-10-01'],
        ),
      ).toBe(payments(REQUIRED, ['SO-1', 'T1', 100, '2026-10-12']));
    });

    it('an optional amount blank in one file and 0 in the other → same fingerprint', () => {
      expect(
        payments([...REQUIRED, 'TCS'], ['SO-1', 'T1', 100, '2026-10-12', null]),
      ).toBe(
        payments([...REQUIRED, 'TCS'], ['SO-1', 'T1', 100, '2026-10-12', '0']),
      );
    });

    it('Compensation and Recovery: a Type column added later (flipping the derived entry type) → same fingerprint', () => {
      const withoutType = parseSettlementWorkbook(
        [
          {
            name: 'Compensation and Recovery',
            rows: [
              { rowNumber: 1, cells: ['Date', 'Amount'] },
              { rowNumber: 2, cells: ['2026-10-03', -50] },
            ],
          },
        ],
        limits,
      ).rows[0];
      const withType = parseSettlementWorkbook(
        [
          {
            name: 'Compensation and Recovery',
            rows: [
              { rowNumber: 1, cells: ['Date', 'Amount', 'Type'] },
              {
                rowNumber: 2,
                cells: ['2026-10-03', -50, 'Compensation reversal'],
              },
            ],
          },
        ],
        limits,
      ).rows[0];
      expect([withoutType.values.entryType, withType.values.entryType]).toEqual(
        ['recovery', 'compensation'],
      );
      expect(withType.rowHash).toBe(withoutType.rowHash);
    });
  });
});

describe('valuesHash', () => {
  it('does not depend on key order', () => {
    expect(valuesHash({ a: '1', b: null })).toBe(
      valuesHash({ b: null, a: '1' }),
    );
    expect(valuesHash({ a: '1' })).not.toBe(valuesHash({ a: '2' }));
  });
});
