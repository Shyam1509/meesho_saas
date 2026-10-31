import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { UserRefDto } from '../../common/http/refs.dto';
import { ID_PATTERN } from '../../common/http/parse-id.pipe';
import {
  RECONCILIATION_RUN_STATUSES,
  RECONCILIATION_TRIGGER_TYPES,
  type ReconciliationRunStatus,
  type ReconciliationTriggerType,
} from '../../database/models';
import { OrderStatusCountDto } from '../../orders/dto/order.dto';

const ID_MESSAGE = (field: string) => ({
  message: `${field} must be a positive integer id (as a string)`,
});

export class ManualUnmatchDto {
  @ApiProperty({
    example: '501',
    description: 'Settlement entry id of this account',
  })
  @IsString(ID_MESSAGE('settlementEntryId'))
  @Matches(ID_PATTERN, ID_MESSAGE('settlementEntryId'))
  settlementEntryId!: string;
}

export class ManualMatchDto extends ManualUnmatchDto {
  @ApiProperty({ example: '41', description: 'Order id of this account' })
  @IsString(ID_MESSAGE('orderId'))
  @Matches(ID_PATTERN, ID_MESSAGE('orderId'))
  orderId!: string;
}

// Response-shape classes for Swagger: never constructed with `new`, instances are typed object literals, hence `!`.

export class RunSummaryDto {
  @ApiProperty({ example: '9' })
  id!: string;

  @ApiProperty({
    enum: RECONCILIATION_TRIGGER_TYPES,
    description:
      'import = ran inside an import confirm; manual = POST .../reconciliation/runs',
  })
  triggerType!: ReconciliationTriggerType;

  @ApiProperty({ enum: RECONCILIATION_RUN_STATUSES })
  status!: ReconciliationRunStatus;

  @ApiProperty({ type: String, nullable: true, example: '12' })
  importJobId!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  triggeredBy!: UserRefDto | null;

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  finishedAt!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Entries this run matched automatically',
  })
  matchedCount!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'After the run: entries with a sub order no but no order (not superseded)',
  })
  unmatchedSettlementCount!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'After the run: orders with no matched, non-superseded entry',
  })
  unmatchedOrderCount!: number | null;

  @ApiProperty({ type: String, nullable: true })
  failureMessage!: string | null;
}

export class RunListDto {
  @ApiProperty({ type: [RunSummaryDto], description: 'Newest first' })
  items!: RunSummaryDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 25 })
  pageSize!: number;

  @ApiProperty({ example: 4 })
  total!: number;
}

export class SettlementsOverviewDto {
  @ApiProperty({ description: 'Entries that are not superseded' })
  total!: number;

  @ApiProperty()
  matched!: number;

  @ApiProperty({ description: 'With a sub order no but no order (exceptions)' })
  unmatched!: number;

  @ApiProperty({
    description: 'No sub order no (ads, referral, …): never exceptions',
  })
  accountLevel!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'As reported; null when there are no such entries',
  })
  matchedAmount!: string | null;

  @ApiProperty({ type: String, nullable: true })
  unmatchedAmount!: string | null;

  @ApiProperty({ type: String, nullable: true })
  accountLevelAmount!: string | null;
}

export class OrdersOverviewDto {
  @ApiProperty()
  total!: number;

  @ApiProperty({
    description: 'With at least one matched, non-superseded entry',
  })
  withSettlement!: number;

  @ApiProperty()
  withoutSettlement!: number;
}

export class ReconciliationOverviewDto {
  @ApiProperty({ type: RunSummaryDto, nullable: true })
  lastRun!: RunSummaryDto | null;

  @ApiProperty({ type: SettlementsOverviewDto })
  settlements!: SettlementsOverviewDto;

  @ApiProperty({ type: OrdersOverviewDto })
  orders!: OrdersOverviewDto;

  @ApiProperty({
    type: [OrderStatusCountDto],
    description: 'Orders without settlement by raw current status, most first',
  })
  withoutSettlementByStatus!: OrderStatusCountDto[];
}
