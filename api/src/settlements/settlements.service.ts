import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WorkspaceAccessService } from '../authorization/workspace-access.service';
import { listWindow } from '../common/http/list-query';
import {
  scopeOf,
  type AccountScope,
  type SqlFilter,
} from '../common/sql/account-scope';
import { LIKE_ESCAPE, likePrefix } from '../common/sql/like';
import { readSnapshot } from '../common/sql/read-snapshot';
import type {
  ListSettlementsQueryDto,
  SettlementListDto,
} from './dto/settlement.dto';
import {
  addEntryDateRange,
  countAndSumEntries,
  entryOrderBy,
  entryScope,
  MATCH_STATE_SQL,
  NOT_SUPERSEDED_SQL,
  selectEntries,
} from './settlement-entry-queries';

/** The filter values of GET .../settlements (also used by the settlements CSV). */
export type SettlementListFilterValues = Pick<
  ListSettlementsQueryDto,
  | 'entryType'
  | 'from'
  | 'to'
  | 'q'
  | 'match'
  | 'includeSuperseded'
  | 'dateBasis'
>;

/**
 * The ListSettlementsQueryDto filters as SQL conditions on `settlement_entries se` (values bound).
 * `from` / `to` apply to the payment date unless `dateBasis=order_date` (M7: the dashboard's order-date
 * basis, through the same addEntryDateRange the dashboard uses).
 */
export function settlementListFilter(
  scope: AccountScope,
  query: SettlementListFilterValues,
): SqlFilter {
  const filter = entryScope(scope);
  if (query.entryType && query.entryType.length > 0) {
    filter.conditions.push('se.entry_type IN (:entryTypes)');
    filter.replacements.entryTypes = [...new Set(query.entryType)];
  }
  addEntryDateRange(filter, query.dateBasis ?? 'payment_date', query);
  if (query.q) {
    filter.conditions.push(
      `(se.sub_order_no LIKE :qPrefix ${LIKE_ESCAPE} OR se.transaction_id LIKE :qPrefix ${LIKE_ESCAPE})`,
    );
    filter.replacements.qPrefix = likePrefix(query.q);
  }
  if (query.match) {
    filter.conditions.push(`(${MATCH_STATE_SQL[query.match]})`);
  }
  if (!query.includeSuperseded) {
    filter.conditions.push(NOT_SUPERSEDED_SQL);
  }
  return filter;
}

/**
 * Settlement entries of a seller account (members), every row as reported (repeated transaction IDs are
 * separate rows). Totals = SUM(settlement_amount) of all filtered rows that are not superseded, in SQL.
 */
@Injectable()
export class SettlementsService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly access: WorkspaceAccessService,
  ) {}

  async list(
    userId: number,
    accountId: string,
    query: ListSettlementsQueryDto,
  ): Promise<SettlementListDto> {
    const { account } = await this.access.requireAccount(
      userId,
      accountId,
      'member',
    );
    const filter = settlementListFilter(scopeOf(account), query);
    const { limit, offset } = listWindow(query);
    // Page, total and totals from ONE snapshot: they cannot disagree if an import commits meanwhile.
    const [items, counts] = await readSnapshot(
      this.sequelize,
      async (transaction) =>
        [
          await selectEntries(this.sequelize, filter, {
            orderBy: entryOrderBy(query.sort),
            limit,
            offset,
            transaction,
          }),
          await countAndSumEntries(this.sequelize, filter, transaction),
        ] as const,
    );
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: counts.total,
      totals: {
        settlementAmount: counts.summedAmount,
        count: counts.summedCount,
      },
    };
  }
}
