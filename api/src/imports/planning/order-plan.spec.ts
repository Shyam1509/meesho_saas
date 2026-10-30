import { planOrder, rowOrderValues, type ExistingOrder } from './order-plan';

const OCT_10 = new Date('2026-10-10T00:00:00.000Z');
const OCT_20 = new Date('2026-10-20T00:00:00.000Z');

const row = {
  subOrderNo: '1001_1',
  status: 'SHIPPED',
  orderDate: '2026-10-01',
  quantity: '2',
  sku: 'SKU-1',
  supplierListedPrice: '499.00',
  productName: null,
};

function existing(overrides: Partial<ExistingOrder> = {}): ExistingOrder {
  return {
    id: 7,
    firstImportJobId: 3,
    currentStatus: 'SHIPPED',
    currentStatusObservedAt: OCT_10,
    values: {
      orderNo: null,
      orderDate: '2026-10-01',
      sku: 'SKU-1',
      catalogId: null,
      productName: 'Kurti',
      size: null,
      quantity: '2',
      customerState: null,
      supplierListedPrice: '499.00',
      supplierDiscountedPrice: null,
      packetId: null,
    },
    ...overrides,
  };
}

describe('planOrder', () => {
  it('a new sub-order → insert with the row values (absent columns null)', () => {
    expect(planOrder(undefined, row, OCT_10)).toEqual({
      action: 'insert',
      values: {
        orderNo: null,
        orderDate: '2026-10-01',
        sku: 'SKU-1',
        catalogId: null,
        productName: null,
        size: null,
        quantity: '2',
        customerState: null,
        supplierListedPrice: '499.00',
        supplierDiscountedPrice: null,
        packetId: null,
        currentStatus: 'SHIPPED',
      },
    });
  });

  it('same values, same or newer observation → unchanged (blank cells never erase known values)', () => {
    const plan = planOrder(existing(), row, OCT_20);
    expect(plan.action).toBe('unchanged');
    expect(plan.values?.productName).toBe('Kurti');
    expect(planOrder(existing(), row, OCT_10).action).toBe('unchanged');
  });

  it('a newer report with a different status → update', () => {
    const plan = planOrder(existing(), { ...row, status: 'DELIVERED' }, OCT_20);
    expect(plan.action).toBe('update');
    expect(plan.values?.currentStatus).toBe('DELIVERED');
  });

  it('an equally recent report counts as forward (≥)', () => {
    expect(
      planOrder(existing(), { ...row, status: 'RTO' }, OCT_10).action,
    ).toBe('update');
  });

  it('a newer report with a changed non-status value → update, keeping the other known values', () => {
    const plan = planOrder(
      existing(),
      { ...row, supplierListedPrice: '450.00' },
      OCT_20,
    );
    expect(plan.action).toBe('update');
    expect(plan.values).toEqual(
      expect.objectContaining({
        supplierListedPrice: '450.00',
        productName: 'Kurti',
        currentStatus: 'SHIPPED',
      }),
    );
  });

  it('an older report → status_event only: the order is left untouched', () => {
    const plan = planOrder(
      existing({ currentStatusObservedAt: OCT_20, currentStatus: 'DELIVERED' }),
      { ...row, status: 'SHIPPED', supplierListedPrice: '1.00' },
      OCT_10,
    );
    expect(plan).toEqual({ action: 'status_event', values: null });
  });
});

describe('rowOrderValues', () => {
  it('takes the status from the status column and nulls absent fields', () => {
    expect(
      rowOrderValues({
        subOrderNo: 'x',
        status: 'RTO',
        orderDate: '2026-10-01',
        quantity: '1',
      }),
    ).toEqual(
      expect.objectContaining({
        currentStatus: 'RTO',
        sku: null,
        packetId: null,
        quantity: '1',
      }),
    );
  });
});
