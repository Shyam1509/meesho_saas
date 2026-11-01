import {
  CANCELLED_OR_RETURNED_KEYWORDS,
  cancelledOrReturnedSql,
  isCancelledOrReturned,
} from './order-status-classes';

describe('cancelled / returned order statuses (keyword match)', () => {
  it.each([
    'Cancelled',
    'CANCELLED',
    'cancelled by customer',
    'RTO',
    'RTO_DELIVERED',
    'rto initiated',
    'Return Requested',
    'RETURNED',
    'Customer return',
  ])('%j is cancelled / returned', (status) => {
    expect(isCancelledOrReturned(status)).toBe(true);
  });

  it.each([
    'DELIVERED',
    'Delivered',
    'SHIPPED',
    'PENDING',
    'READY_TO_SHIP',
    '',
  ])('%j is not', (status) => {
    expect(isCancelledOrReturned(status)).toBe(false);
  });

  it('the SQL fragment is built from the same keywords (UPPER + LIKE, no collation dependence)', () => {
    expect(CANCELLED_OR_RETURNED_KEYWORDS).toEqual(['CANCEL', 'RTO', 'RETURN']);
    expect(cancelledOrReturnedSql('o')).toBe(
      "(UPPER(o.current_status) LIKE '%CANCEL%' OR UPPER(o.current_status) LIKE '%RTO%'" +
        " OR UPPER(o.current_status) LIKE '%RETURN%')",
    );
  });
});
