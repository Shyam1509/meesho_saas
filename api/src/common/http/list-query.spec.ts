import { ValidationPipe, type Type } from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from '../../app.setup';
import {
  ListOrdersQueryDto,
  OrderStatusFilterQueryDto,
} from '../../orders/dto/order.dto';
import {
  ManualMatchDto,
  ManualUnmatchDto,
} from '../../reconciliation/dto/reconciliation.dto';
import {
  ListSettlementsQueryDto,
  SettlementSortQueryDto,
} from '../../settlements/dto/settlement.dto';
import { RequestValidationException } from '../errors/request-validation.exception';
import { PaginationQueryDto } from './pagination.dto';
import {
  isCalendarDate,
  ListPageQueryDto,
  listWindow,
  parseSort,
  sortValues,
} from './list-query';

/** The real global pipe (whitelist + forbidNonWhitelisted + transform), as the app runs it. */
const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

async function accept<T>(metatype: Type<T>, value: object): Promise<T> {
  return (await pipe.transform(value, { type: 'query', metatype })) as T;
}

/** Field → reasons of a rejected value (fails the test if it is accepted). */
async function reject(
  metatype: Type<unknown>,
  value: object,
): Promise<Record<string, string[]>> {
  try {
    await pipe.transform(value, { type: 'query', metatype });
  } catch (err) {
    if (err instanceof RequestValidationException) {
      return Object.fromEntries(err.details.map((d) => [d.field, d.reasons]));
    }
    throw err;
  }
  throw new Error(`accepted ${JSON.stringify(value)}`);
}

describe('sort helpers', () => {
  it('sortValues lists key and -key; parseSort splits them', () => {
    expect(sortValues(['a', 'b'] as const)).toEqual(['a', '-a', 'b', '-b']);
    expect(parseSort('orderDate')).toEqual({
      key: 'orderDate',
      descending: false,
    });
    expect(parseSort('-orderDate')).toEqual({
      key: 'orderDate',
      descending: true,
    });
  });

  it('listWindow turns page/pageSize into LIMIT/OFFSET', () => {
    expect(listWindow({ page: 3, pageSize: 25 })).toEqual({
      limit: 25,
      offset: 50,
    });
  });
});

describe('isCalendarDate', () => {
  it.each(['2026-10-01', '2028-02-29', '1000-01-01', '9999-12-31'])(
    'accepts %s',
    (value) => expect(isCalendarDate(value)).toBe(true),
  );
  it.each([
    '2026-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '0999-12-31',
    '2026-1-5',
    '01-10-2026',
    '2026-10-01T00:00:00Z',
    '',
  ])('rejects %s', (value) => expect(isCalendarDate(value)).toBe(false));
  it('rejects non-strings', () => {
    expect(isCalendarDate(20261001)).toBe(false);
    expect(isCalendarDate(null)).toBe(false);
  });
});

describe('list query DTOs (through the global ValidationPipe)', () => {
  it('ListPageQueryDto: defaults page 1 / pageSize 25; bounds 1–100', async () => {
    const dto = await accept(ListPageQueryDto, {});
    expect([dto.page, dto.pageSize]).toEqual([1, 25]);
    const set = await accept(ListPageQueryDto, { page: '2', pageSize: '100' });
    expect([set.page, set.pageSize]).toEqual([2, 100]);
    expect(
      Object.keys(await reject(ListPageQueryDto, { pageSize: '101' })),
    ).toEqual(['pageSize']);
    expect((await accept(ListPageQueryDto, { page: '2000' })).page).toBe(2000);
    expect(
      Object.keys(await reject(ListPageQueryDto, { page: '2001' })),
    ).toEqual(['page']);
    expect(
      Object.keys(await reject(PaginationQueryDto, { page: '2001' })),
    ).toEqual(['page']);
    expect(Object.keys(await reject(ListPageQueryDto, { page: '0' }))).toEqual([
      'page',
    ]);
    expect(
      Object.keys(await reject(ListPageQueryDto, { page: ['1', '2'] })),
    ).toEqual(['page']);
  });

  describe('ListOrdersQueryDto', () => {
    it('defaults: sort -orderDate, no filters', async () => {
      const dto = await accept(ListOrdersQueryDto, {});
      expect(dto).toEqual(
        expect.objectContaining({ page: 1, pageSize: 25, sort: '-orderDate' }),
      );
      expect(dto.status).toBeUndefined();
      expect(dto.q).toBeUndefined();
    });

    it('accepts every allowlisted sort key in both directions', async () => {
      for (const sort of [
        'orderDate',
        '-orderDate',
        'subOrderNo',
        '-subOrderNo',
        'currentStatus',
        '-currentStatus',
        'updatedAt',
        '-updatedAt',
      ]) {
        expect((await accept(ListOrdersQueryDto, { sort })).sort).toBe(sort);
      }
    });

    it.each([
      [{ sort: 'price' }, 'sort'],
      [{ sort: '--orderDate' }, 'sort'],
      [{ sort: 'orderDate,subOrderNo' }, 'sort'],
      [{ sort: ['orderDate', 'subOrderNo'] }, 'sort'],
      [{ settlement: 'maybe' }, 'settlement'],
      [{ from: '2026-02-30' }, 'from'],
      [{ to: '31-10-2026' }, 'to'],
      [{ status: '' }, 'status'],
      [{ status: ['DELIVERED', 'x'.repeat(65)] }, 'status'],
      [{ q: 'x'.repeat(101) }, 'q'],
      [{ entryType: 'ads_cost' }, 'entryType'],
      [{ unknown: '1' }, 'unknown'],
    ])('rejects %j (field %s)', async (value, field) => {
      expect(Object.keys(await reject(ListOrdersQueryDto, value))).toEqual([
        field,
      ]);
    });

    it('rejects a to date before from, and never echoes the values', async () => {
      const reasons = await reject(ListOrdersQueryDto, {
        from: '2026-10-05',
        to: '2026-10-04',
      });
      expect(reasons).toEqual({ to: ['to must not be before from'] });
      expect(JSON.stringify(reasons)).not.toContain('2026-10-04');
      const same = await accept(ListOrdersQueryDto, {
        from: '2026-10-05',
        to: '2026-10-05',
      });
      expect([same.from, same.to]).toEqual(['2026-10-05', '2026-10-05']);
    });

    it('status: one value or many become an array (case and spaces kept)', async () => {
      expect(
        (await accept(ListOrdersQueryDto, { status: 'Delivered' })).status,
      ).toEqual(['Delivered']);
      expect(
        (
          await accept(ListOrdersQueryDto, {
            status: ['DELIVERED', 'RTO Initiated'],
          })
        ).status,
      ).toEqual(['DELIVERED', 'RTO Initiated']);
      const tooMany = Array.from({ length: 51 }, (_, i) => `S${i}`);
      expect(
        Object.keys(await reject(ListOrdersQueryDto, { status: tooMany })),
      ).toEqual(['status']);
    });

    it('q is trimmed; blank means no search', async () => {
      expect((await accept(ListOrdersQueryDto, { q: '  SO-1 ' })).q).toBe(
        'SO-1',
      );
      expect(
        (await accept(ListOrdersQueryDto, { q: '   ' })).q,
      ).toBeUndefined();
      expect((await accept(ListOrdersQueryDto, { q: '100%_' })).q).toBe(
        '100%_',
      );
    });
  });

  describe('ListSettlementsQueryDto', () => {
    it('defaults: sort -paymentDate, includeSuperseded false', async () => {
      const dto = await accept(ListSettlementsQueryDto, {});
      expect(dto).toEqual(
        expect.objectContaining({
          page: 1,
          pageSize: 25,
          sort: '-paymentDate',
          includeSuperseded: false,
        }),
      );
    });

    it('entryType is repeatable and allowlisted; match and includeSuperseded parse', async () => {
      const dto = await accept(ListSettlementsQueryDto, {
        entryType: ['ads_cost', 'referral_payment'],
        match: 'account_level',
        includeSuperseded: 'true',
        sort: 'settlementAmount',
      });
      expect(dto).toEqual(
        expect.objectContaining({
          entryType: ['ads_cost', 'referral_payment'],
          match: 'account_level',
          includeSuperseded: true,
          sort: 'settlementAmount',
        }),
      );
      expect(
        (await accept(ListSettlementsQueryDto, { includeSuperseded: 'false' }))
          .includeSuperseded,
      ).toBe(false);
    });

    it.each([
      [{ entryType: 'ads' }, 'entryType'],
      [{ entryType: ['ads_cost', 'bonus'] }, 'entryType'],
      [{ match: 'partial' }, 'match'],
      [{ includeSuperseded: 'yes' }, 'includeSuperseded'],
      [{ includeSuperseded: '1' }, 'includeSuperseded'],
      [{ sort: 'amount' }, 'sort'],
      [{ sort: '-orderNo' }, 'sort'],
      [{ from: '2026-10-32' }, 'from'],
      [{ status: 'DELIVERED' }, 'status'],
    ])('rejects %j (field %s)', async (value, field) => {
      expect(Object.keys(await reject(ListSettlementsQueryDto, value))).toEqual(
        [field],
      );
    });
  });

  it('reconciliation exception lists accept only page, pageSize, sort (+ status for orders)', async () => {
    expect((await accept(SettlementSortQueryDto, {})).sort).toBe(
      '-paymentDate',
    );
    expect(
      Object.keys(await reject(SettlementSortQueryDto, { q: 'x' })),
    ).toEqual(['q']);
    expect(
      (await accept(OrderStatusFilterQueryDto, { status: 'RTO' })).status,
    ).toEqual(['RTO']);
    expect(
      Object.keys(
        await reject(OrderStatusFilterQueryDto, { from: '2026-10-01' }),
      ),
    ).toEqual(['from']);
  });
});

describe('manual match / unmatch bodies', () => {
  const body = async (metatype: Type<unknown>, value: object) => {
    try {
      await pipe.transform(value, { type: 'body', metatype });
      return [];
    } catch (err) {
      if (err instanceof RequestValidationException) {
        return err.details.map((d) => d.field).sort();
      }
      throw err;
    }
  };

  it('ids must be positive integer strings', async () => {
    expect(
      await body(ManualMatchDto, { settlementEntryId: '5', orderId: '7' }),
    ).toEqual([]);
    expect(await body(ManualMatchDto, { settlementEntryId: '5' })).toEqual([
      'orderId',
    ]);
    expect(
      await body(ManualMatchDto, { settlementEntryId: 5, orderId: '07' }),
    ).toEqual(['orderId', 'settlementEntryId']);
    expect(
      await body(ManualMatchDto, {
        settlementEntryId: '5',
        orderId: '7',
        matchMethod: 'auto',
      }),
    ).toEqual(['matchMethod']);
    expect(await body(ManualUnmatchDto, { settlementEntryId: '-1' })).toEqual([
      'settlementEntryId',
    ]);
    expect(await body(ManualUnmatchDto, { settlementEntryId: '12' })).toEqual(
      [],
    );
  });
});
