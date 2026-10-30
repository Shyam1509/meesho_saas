import type { Model as SequelizeModel, ModelStatic } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import {
  ImportJob,
  ImportRow,
  MODELS,
  Order,
  OrderStatusEvent,
  Product,
  ProductCostHistory,
  SellerAccount,
  SettlementEntry,
  User,
  Workspace,
  WorkspaceMember,
} from '../../src/database/models';
import {
  createOrder,
  createSettlement,
  createStatusEvent,
  createTestSequelize,
  DOMAIN_TABLES,
  inRollback,
  seedTenant,
  select,
} from './db-helpers';

interface ColumnRow {
  tbl: string;
  col: string;
  columnType: string;
  nullable: 'YES' | 'NO';
}

interface ColumnShape {
  column: string;
  nullable: boolean;
  type: string;
}

/** Sequelize's SQL for a model attribute type, in information_schema COLUMN_TYPE spelling. */
function sqlType(type: unknown): string {
  const sql =
    typeof type === 'string' ? type : (type as { toSql(): string }).toSql();
  return sql.toLowerCase().replace(/^integer\b/, 'int');
}

function tableOf(model: (typeof MODELS)[number]): string {
  const name = (model as unknown as ModelStatic<SequelizeModel>).getTableName();
  return typeof name === 'string' ? name : name.tableName;
}

describe('models <-> migrated schema', () => {
  let sequelize: Sequelize;
  let columns: ColumnRow[];

  beforeAll(async () => {
    sequelize = createTestSequelize();
    columns = await select<ColumnRow>(
      sequelize,
      `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`,
    );
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('drift', () => {
    it('every table has exactly one model and every model has a table', () => {
      const tables = MODELS.map(tableOf).sort();
      expect(tables).toEqual([...DOMAIN_TABLES].sort());
    });

    it.each(MODELS.map((m) => [m.name, m] as const))(
      '%s: attributes == columns (name, nullability, type)',
      (_name, model) => {
        const m = model as unknown as ModelStatic<SequelizeModel>;
        const table = tableOf(model);
        const byColumn = (a: ColumnShape, b: ColumnShape) =>
          a.column.localeCompare(b.column);

        const fromModel: ColumnShape[] = Object.values(m.getAttributes())
          .map((attr) => ({
            column: attr.field ?? '',
            nullable: attr.primaryKey ? false : attr.allowNull !== false,
            type: sqlType(attr.type),
          }))
          .sort(byColumn);
        const fromDb: ColumnShape[] = columns
          .filter((c) => c.tbl === table)
          .map((c) => ({
            column: c.col,
            nullable: c.nullable === 'YES',
            type: c.columnType,
          }))
          .sort(byColumn);

        expect(fromModel).toEqual(fromDb);
      },
    );
  });

  describe('associations', () => {
    it('reads a user -> workspace -> account -> product -> order -> status event / settlement graph back', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('assoc', t);
        await ProductCostHistory.create(
          {
            productId: a.product.id,
            unitCost: '45.50',
            effectiveFrom: '2026-09-01',
            createdByUserId: a.user.id,
          },
          { transaction: t },
        );
        const order = await createOrder(a, t, {
          productId: a.product.id,
          sku: 'SKU-1',
          supplierDiscountedPrice: '199.00',
        });
        const observedAt = new Date('2026-10-03T08:15:30.123Z');
        await createStatusEvent(a, order, t, { observedAt });
        await createSettlement(a, t, {
          subOrderNo: order.subOrderNo,
          orderId: order.id,
          matchMethod: 'manual',
          matchedAt: new Date('2026-10-04T00:00:00.000Z'),
          matchedByUserId: a.user.id,
        });

        const user = await User.findByPk(a.user.id, {
          include: [
            {
              model: Workspace,
              as: 'workspaces',
              include: [{ model: SellerAccount, as: 'sellerAccounts' }],
            },
          ],
          transaction: t,
        });
        expect(user?.workspaces?.map((w) => w.id)).toEqual([a.workspace.id]);
        expect(
          user?.workspaces?.[0].sellerAccounts?.map((s) => s.displayName),
        ).toEqual(['Account assoc']);

        const workspace = await Workspace.findByPk(a.workspace.id, {
          include: [
            { model: User, as: 'createdBy' },
            { model: User, as: 'members' },
            { model: WorkspaceMember, as: 'memberships' },
          ],
          transaction: t,
        });
        expect(workspace?.createdBy?.email).toBe('assoc@example.test');
        expect(workspace?.members?.map((m) => m.id)).toEqual([a.user.id]);
        expect(workspace?.memberships?.map((m) => m.role)).toEqual(['owner']);

        const loaded = await Order.findByPk(order.id, {
          include: [
            {
              model: SellerAccount,
              as: 'sellerAccount',
              include: [{ model: Workspace, as: 'workspace' }],
            },
            {
              model: Product,
              as: 'product',
              include: [{ model: ProductCostHistory, as: 'costHistory' }],
            },
            { model: ImportJob, as: 'firstImportJob' },
            { model: ImportRow, as: 'lastImportRow' },
            {
              model: OrderStatusEvent,
              as: 'statusEvents',
              include: [{ model: ImportRow, as: 'importRow' }],
            },
            {
              model: SettlementEntry,
              as: 'settlementEntries',
              include: [{ model: User, as: 'matchedBy' }],
            },
          ],
          transaction: t,
        });
        expect(loaded).not.toBeNull();
        expect({
          subOrderNo: loaded?.subOrderNo,
          orderDate: loaded?.orderDate,
          price: loaded?.supplierDiscountedPrice,
          listed: loaded?.supplierListedPrice,
          workspace: loaded?.sellerAccount?.workspace?.name,
          sku: loaded?.product?.sku,
          cost: loaded?.product?.costHistory?.map((c) => [
            c.effectiveFrom,
            c.unitCost,
          ]),
          firstJob: loaded?.firstImportJob?.originalFilename,
          lastRow: loaded?.lastImportRow?.sheetName,
          events: loaded?.statusEvents?.map((e) => [
            e.status,
            e.observedAt.toISOString(),
            e.importRow?.sourceRowNumber,
          ]),
          settlements: loaded?.settlementEntries?.map((s) => [
            s.matchMethod,
            s.settlementAmount,
            s.matchedBy?.id,
          ]),
        }).toEqual({
          subOrderNo: 'SO-1001',
          orderDate: '2026-10-01',
          price: '199.00',
          listed: null,
          workspace: 'Workspace assoc',
          sku: 'SKU-1',
          cost: [['2026-09-01', '45.5000']],
          firstJob: 'assoc.xlsx',
          lastRow: 'Order Payments',
          events: [['SHIPPED', '2026-10-03T08:15:30.123Z', 2]],
          settlements: [['manual', '100.00', a.user.id]],
        });

        // Stored as UTC with milliseconds (DATETIME(3), connection timezone +00:00).
        const [stored] = await select<{ observed: string }>(
          sequelize,
          `SELECT DATE_FORMAT(observed_at, '%Y-%m-%d %H:%i:%s.%f') AS observed
           FROM order_status_events WHERE order_id = ?`,
          [order.id],
          t,
        );
        expect(stored.observed).toBe('2026-10-03 08:15:30.123000');
      }));

    it('attributes are served by Sequelize getters, not shadowed by class fields', () =>
      inRollback(sequelize, async (t) => {
        const a = await seedTenant('shadow', t);
        const order = await createOrder(a, t);
        const reloaded = await Order.findByPk(order.id, { transaction: t });
        expect(reloaded?.subOrderNo).toBe('SO-1001');
        expect(
          Object.prototype.hasOwnProperty.call(reloaded, 'subOrderNo'),
        ).toBe(false);
        expect(typeof reloaded?.createdAt.getTime()).toBe('number');
      }));
  });
});
