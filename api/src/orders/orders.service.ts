import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WorkspaceAccessService } from '../authorization/workspace-access.service';
import { listWindow } from '../common/http/list-query';
import { isoTimestamp, toImportRef } from '../common/http/refs.dto';
import {
  scopeOf,
  type AccountScope,
  type SqlFilter,
} from '../common/sql/account-scope';
import { LIKE_ESCAPE, likeContains, likePrefix } from '../common/sql/like';
import { readSnapshot } from '../common/sql/read-snapshot';
import {
  entryScope,
  selectEntries,
} from '../settlements/settlement-entry-queries';
import type {
  ListOrdersQueryDto,
  OrderDetailDto,
  OrderListDto,
  OrderStatusListDto,
  StatusEventListDto,
} from './dto/order.dto';
import {
  addStatusFilter,
  firstPaymentInRangeSql,
  HAS_SETTLEMENT_SQL,
  ORDER_SUMMARY_COLUMNS,
  ORDER_SUMMARY_JOINS,
  orderOrderBy,
  orderScope,
  pageOfOrders,
  settlementSummaries,
  statusCounts,
  statusEventsOf,
  toOrderSummaryDto,
  type OrderSummaryRow,
} from './order-queries';

export const ORDER_NOT_FOUND_MESSAGE = 'Order not found.';

interface OrderDetailRow extends OrderSummaryRow {
  catalogId: string | null;
  packetId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  firstImportId: number | string;
  firstImportFilename: string;
  firstImportCreatedAt: Date | string;
  lastImportId: number | string;
  lastImportFilename: string;
  lastImportCreatedAt: Date | string;
}

/** The filter values of GET .../orders (also used by the orders CSV and the M7 dashboard). */
export type OrderListFilterValues = Pick<
  ListOrdersQueryDto,
  'status' | 'from' | 'to' | 'q' | 'settlement' | 'paymentFrom' | 'paymentTo'
>;

/** The ListOrdersQueryDto filters as SQL conditions on `orders o` (values bound, never spliced). */
export function orderListFilter(
  scope: AccountScope,
  query: OrderListFilterValues,
): SqlFilter {
  return addOrderListFilters(orderScope(scope), query);
}

/**
 * Adds the orders-list filters to `filter` (an account scope, or a workspace scope for the M7 workspace
 * dashboard). The dashboard selects its orders through this same function, so a dashboard count and the
 * filtered list total always come from the same SQL.
 */
export function addOrderListFilters(
  filter: SqlFilter,
  query: OrderListFilterValues,
): SqlFilter {
  addStatusFilter(filter, query.status);
  if (query.from) {
    filter.conditions.push('o.order_date >= :from');
    filter.replacements.from = query.from;
  }
  if (query.to) {
    filter.conditions.push('o.order_date <= :to');
    filter.replacements.to = query.to;
  }
  // M7: orders whose FIRST payment date (earliest matched, non-superseded entry) is in the range.
  if (query.paymentFrom || query.paymentTo) {
    filter.conditions.push(
      firstPaymentInRangeSql(
        query,
        filter.replacements.sellerAccountId !== undefined,
      ),
    );
    if (query.paymentFrom) filter.replacements.paymentFrom = query.paymentFrom;
    if (query.paymentTo) filter.replacements.paymentTo = query.paymentTo;
  }
  if (query.q) {
    filter.conditions.push(
      `(o.sub_order_no LIKE :qPrefix ${LIKE_ESCAPE} OR o.sku LIKE :qPrefix ${LIKE_ESCAPE}` +
        ` OR o.product_name LIKE :qContains ${LIKE_ESCAPE})`,
    );
    filter.replacements.qPrefix = likePrefix(query.q);
    filter.replacements.qContains = likeContains(query.q);
  }
  if (query.settlement === 'matched') {
    filter.conditions.push(HAS_SETTLEMENT_SQL);
  } else if (query.settlement === 'unmatched') {
    filter.conditions.push(`NOT ${HAS_SETTLEMENT_SQL}`);
  }
  return filter;
}

/**
 * Orders of a seller account (members). Every query filters on the workspace + account ids resolved by
 * requireAccount; an order id of another account (even in the same workspace) is "not found".
 */
@Injectable()
export class OrdersService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly access: WorkspaceAccessService,
  ) {}

  async list(
    userId: number,
    accountId: string,
    query: ListOrdersQueryDto,
  ): Promise<OrderListDto> {
    const scope = await this.scope(userId, accountId);
    const { items, total } = await readSnapshot(this.sequelize, (transaction) =>
      pageOfOrders(
        this.sequelize,
        scope,
        orderListFilter(scope, query),
        orderOrderBy(query.sort),
        listWindow(query),
        transaction,
      ),
    );
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async statuses(
    userId: number,
    accountId: string,
  ): Promise<OrderStatusListDto> {
    const scope = await this.scope(userId, accountId);
    return { items: await statusCounts(this.sequelize, orderScope(scope)) };
  }

  async detail(
    userId: number,
    accountId: string,
    orderId: string,
  ): Promise<OrderDetailDto> {
    const scope = await this.scope(userId, accountId);
    return readSnapshot(this.sequelize, (transaction) =>
      this.detailIn(scope, orderId, transaction),
    );
  }

  /** The detail's reads, all in the caller's snapshot transaction. */
  private async detailIn(
    scope: AccountScope,
    orderId: string,
    transaction: Transaction,
  ): Promise<OrderDetailDto> {
    const [row] = await this.sequelize.query<OrderDetailRow>(
      `SELECT ${ORDER_SUMMARY_COLUMNS},
              o.catalog_id AS catalogId, o.packet_id AS packetId,
              o.created_at AS createdAt, o.updated_at AS updatedAt,
              fj.id AS firstImportId, fj.original_filename AS firstImportFilename,
              fj.created_at AS firstImportCreatedAt,
              lj.id AS lastImportId, lj.original_filename AS lastImportFilename,
              lj.created_at AS lastImportCreatedAt
       FROM orders o
       JOIN import_jobs fj ON fj.seller_account_id = o.seller_account_id AND fj.id = o.first_import_job_id
       JOIN import_jobs lj ON lj.seller_account_id = o.seller_account_id AND lj.id = o.last_import_job_id
       ${ORDER_SUMMARY_JOINS}
       WHERE o.seller_account_id = :sellerAccountId AND o.workspace_id = :workspaceId
         AND o.id = CAST(:orderId AS UNSIGNED)`,
      {
        type: QueryTypes.SELECT,
        replacements: { ...scope, orderId },
        transaction,
      },
    );
    if (!row) throw new NotFoundException(ORDER_NOT_FOUND_MESSAGE);

    const summaries = await settlementSummaries(
      this.sequelize,
      scope,
      [row.id],
      transaction,
    );
    const entries = entryScope(scope);
    entries.conditions.push('se.order_id = :orderId');
    entries.replacements.orderId = String(row.id);
    const statusHistory = await statusEventsOf(
      this.sequelize,
      scope,
      row.id,
      transaction,
    );
    const settlements = await selectEntries(this.sequelize, entries, {
      orderBy: 'se.payment_date ASC, se.id ASC',
      transaction,
    });
    return {
      ...toOrderSummaryDto(
        row,
        summaries.get(String(row.id)) ?? { entryCount: 0, amount: null },
      ),
      catalogId: row.catalogId,
      packetId: row.packetId,
      createdAt: isoTimestamp(row.createdAt),
      updatedAt: isoTimestamp(row.updatedAt),
      firstImport: toImportRef(
        row.firstImportId,
        row.firstImportFilename,
        row.firstImportCreatedAt,
      ),
      lastImport: toImportRef(
        row.lastImportId,
        row.lastImportFilename,
        row.lastImportCreatedAt,
      ),
      statusHistory,
      settlements,
    };
  }

  async statusHistory(
    userId: number,
    accountId: string,
    orderId: string,
  ): Promise<StatusEventListDto> {
    const scope = await this.scope(userId, accountId);
    return readSnapshot(this.sequelize, async (transaction) => {
      const [order] = await this.sequelize.query<{ id: number | string }>(
        `SELECT o.id FROM orders o
         WHERE o.seller_account_id = :sellerAccountId AND o.workspace_id = :workspaceId
           AND o.id = CAST(:orderId AS UNSIGNED)`,
        {
          type: QueryTypes.SELECT,
          replacements: { ...scope, orderId },
          transaction,
        },
      );
      if (!order) throw new NotFoundException(ORDER_NOT_FOUND_MESSAGE);
      return {
        items: await statusEventsOf(
          this.sequelize,
          scope,
          order.id,
          transaction,
        ),
      };
    });
  }

  private async scope(
    userId: number,
    accountId: string,
  ): Promise<AccountScope> {
    const { account } = await this.access.requireAccount(
      userId,
      accountId,
      'member',
    );
    return scopeOf(account);
  }
}
