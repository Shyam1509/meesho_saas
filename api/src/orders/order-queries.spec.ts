import { scopeOf } from '../common/sql/account-scope';
import {
  addStatusFilter,
  orderOrderBy,
  orderScope,
  toOrderSummaryDto,
  toStatusEventDto,
} from './order-queries';
import { orderListFilter } from './orders.service';

describe('order mapping', () => {
  it('maps a row explicitly: ids as strings, prices as reported, ISO observation time', () => {
    expect(
      toOrderSummaryDto(
        {
          id: 41,
          subOrderNo: 'SO-101',
          orderNo: null,
          orderDate: '2026-10-01',
          productName: 'Red Kurti',
          sku: 'KUR-RED-M',
          size: null,
          quantity: 2,
          customerState: 'Gujarat',
          supplierListedPrice: '499.00',
          supplierDiscountedPrice: null,
          currentStatus: 'Delivered',
          currentStatusObservedAt: new Date('2026-10-10T18:29:59.999Z'),
        },
        { entryCount: 1, amount: '420.15' },
      ),
    ).toEqual({
      id: '41',
      subOrderNo: 'SO-101',
      orderNo: null,
      orderDate: '2026-10-01',
      productName: 'Red Kurti',
      sku: 'KUR-RED-M',
      size: null,
      quantity: 2,
      customerState: 'Gujarat',
      supplierListedPrice: '499.00',
      supplierDiscountedPrice: null,
      currentStatus: 'Delivered',
      currentStatusObservedAt: '2026-10-10T18:29:59.999Z',
      settlement: { entryCount: 1, amount: '420.15' },
    });
  });

  it('maps a status event with its import', () => {
    expect(
      toStatusEventDto({
        id: 9,
        status: 'SHIPPED',
        observedAt: new Date('2026-10-10T18:29:59.999Z'),
        importJobId: 3,
        importOriginalFilename: 'orders.csv',
        importCreatedAt: new Date('2026-10-11T00:00:00.000Z'),
      }),
    ).toEqual({
      id: '9',
      status: 'SHIPPED',
      observedAt: '2026-10-10T18:29:59.999Z',
      importJob: {
        id: '3',
        originalFilename: 'orders.csv',
        createdAt: '2026-10-11T00:00:00.000Z',
      },
    });
  });
});

describe('order list SQL', () => {
  const scope = scopeOf({ id: 3, workspaceId: 2 });

  it('ORDER BY from the allowlist with an id tie-break', () => {
    expect(orderOrderBy('-orderDate')).toBe('o.order_date DESC, o.id DESC');
    expect(orderOrderBy('subOrderNo')).toBe('o.sub_order_no ASC, o.id ASC');
    expect(orderOrderBy('-updatedAt')).toBe('o.updated_at DESC, o.id DESC');
  });

  it('status filter compares raw statuses exactly (binary) and de-duplicates', () => {
    const filter = orderScope(scope);
    addStatusFilter(filter, ['DELIVERED', 'Delivered', 'DELIVERED']);
    expect(filter.conditions[2]).toBe(
      'o.current_status COLLATE utf8mb4_bin IN (:statuses)',
    );
    expect(filter.replacements.statuses).toEqual(['DELIVERED', 'Delivered']);
    const none = orderScope(scope);
    addStatusFilter(none, []);
    expect(none.conditions).toHaveLength(2);
  });

  it('search: escaped prefix on sub order / SKU, escaped contains on product name; settlement filter', () => {
    const filter = orderListFilter(scope, {
      q: '100%',
      from: '2026-10-02',
      settlement: 'unmatched',
    });
    expect(filter.replacements).toEqual(
      expect.objectContaining({
        qPrefix: '100!%%',
        qContains: '%100!%%',
        from: '2026-10-02',
      }),
    );
    expect(filter.conditions.join(' ')).toContain(
      "o.product_name LIKE :qContains ESCAPE '!'",
    );
    expect(filter.conditions[filter.conditions.length - 1]).toMatch(
      /^NOT EXISTS \(SELECT 1 FROM settlement_entries s/,
    );
    expect(
      orderListFilter(scope, { settlement: 'matched' }).conditions[2],
    ).toMatch(/^EXISTS .*superseded_by_entry_id IS NULL\)$/s);
  });
});
