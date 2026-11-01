import type { Sequelize } from 'sequelize-typescript';
import {
  cancelledOrReturnedSql,
  isCancelledOrReturned,
} from '../../src/orders/order-status-classes';
import { createTestSequelize, select } from './db-helpers';

/**
 * The cancelled / returned classification (M7 "count it, but warn") is one SQL fragment used by the dashboard
 * and one JS twin: MySQL must classify every sample exactly like the JS function, whatever the case, on a column
 * with the orders table's collation (utf8mb4_0900_ai_ci) and on a binary-collated value (grouped statuses).
 */
describe('cancelled / returned status classification: MySQL = JS (meesho_test)', () => {
  let sequelize: Sequelize;
  const statuses = [
    'Cancelled',
    'CANCELLED',
    'cancelled by customer',
    'RTO',
    'RTO_DELIVERED',
    'rto initiated',
    'Return Requested',
    'RETURNED',
    'DELIVERED',
    'Delivered',
    'SHIPPED',
    'PENDING',
    'Ready to ship',
  ];

  beforeAll(() => {
    sequelize = createTestSequelize(false);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it.each(['utf8mb4_0900_ai_ci', 'utf8mb4_bin'])(
    'collation %s',
    async (collation) => {
      const rows = await select<{ status: string; hit: number | string }>(
        sequelize,
        `SELECT o.current_status AS status, ${cancelledOrReturnedSql('o')} AS hit
         FROM (${statuses
           .map(
             () =>
               `SELECT CAST(? AS CHAR(64) CHARACTER SET utf8mb4) COLLATE ${collation} AS current_status`,
           )
           .join(' UNION ALL ')}) o`,
        statuses,
      );
      expect(rows.map((r) => [r.status, Number(r.hit) === 1])).toEqual(
        statuses.map((s) => [s, isCancelledOrReturned(s)]),
      );
      expect(rows.filter((r) => Number(r.hit) === 1)).toHaveLength(8);
    },
  );
});
