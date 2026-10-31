import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  IsCalendarDate,
  IsNotBefore,
  ListPageQueryDto,
  MAX_FILTER_VALUES,
  MAX_SEARCH_LENGTH,
  sortValues,
  toArray,
  toBooleanFlag,
  toSearchText,
} from '../../common/http/list-query';
import { ImportRefDto, UserRefDto } from '../../common/http/refs.dto';
import {
  SETTLEMENT_ENTRY_TYPES,
  SETTLEMENT_MATCH_METHODS,
  type SettlementEntryType,
  type SettlementMatchMethod,
} from '../../database/models';

export const SETTLEMENT_SORT_KEYS = [
  'paymentDate',
  'settlementAmount',
  'orderDate',
  'createdAt',
] as const;
export type SettlementSortKey = (typeof SETTLEMENT_SORT_KEYS)[number];
export const SETTLEMENT_SORTS = sortValues(SETTLEMENT_SORT_KEYS);
export type SettlementSort = (typeof SETTLEMENT_SORTS)[number];
export const DEFAULT_SETTLEMENT_SORT: SettlementSort = '-paymentDate';

/**
 * Match state of an entry: matched (has an order), unmatched (has a sub order no but no order: an
 * exception), account_level (no sub order no: ads, referral, …; never an exception).
 */
export const SETTLEMENT_MATCH_STATES = [
  'matched',
  'unmatched',
  'account_level',
] as const;
export type SettlementMatchState = (typeof SETTLEMENT_MATCH_STATES)[number];

/** `?page&pageSize&sort` for settlement entry lists (sort keys and default as GET .../settlements). */
export class SettlementSortQueryDto extends ListPageQueryDto {
  @ApiPropertyOptional({
    enum: SETTLEMENT_SORTS,
    default: DEFAULT_SETTLEMENT_SORT,
    description:
      'Ties break on id in the same direction; missing dates sort first ascending, last descending',
  })
  @IsOptional()
  @IsIn(SETTLEMENT_SORTS)
  sort: SettlementSort = DEFAULT_SETTLEMENT_SORT;
}

export class ListSettlementsQueryDto extends SettlementSortQueryDto {
  @ApiPropertyOptional({
    enum: SETTLEMENT_ENTRY_TYPES,
    isArray: true,
    description: 'Repeatable (?entryType=ads_cost&entryType=referral_payment)',
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsIn(SETTLEMENT_ENTRY_TYPES, { each: true })
  entryType?: SettlementEntryType[];

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-01',
    description: 'Payment date from (inclusive), YYYY-MM-DD',
  })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-31',
    description: 'Payment date to (inclusive), YYYY-MM-DD; not before from',
  })
  @IsOptional()
  @IsCalendarDate()
  @IsNotBefore('from')
  to?: string;

  @ApiPropertyOptional({
    maxLength: MAX_SEARCH_LENGTH,
    description:
      'Search: sub order no or transaction id starting with the text (exact case). % and _ match themselves. Blank = no search.',
  })
  @IsOptional()
  @Transform(toSearchText)
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  q?: string;

  @ApiPropertyOptional({ enum: SETTLEMENT_MATCH_STATES })
  @IsOptional()
  @IsIn(SETTLEMENT_MATCH_STATES)
  match?: SettlementMatchState;

  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description:
      'true also lists superseded entries; they are never included in totals',
  })
  @IsOptional()
  @Transform(toBooleanFlag)
  @IsBoolean()
  includeSuperseded: boolean = false;
}

// Response-shape classes for Swagger: never constructed with `new`, instances are typed object literals, hence `!`.

export class SettlementMatchDto {
  @ApiProperty({ enum: SETTLEMENT_MATCH_STATES })
  state!: SettlementMatchState;

  @ApiProperty({ enum: SETTLEMENT_MATCH_METHODS, nullable: true })
  method!: SettlementMatchMethod | null;

  @ApiProperty({ type: String, nullable: true, example: '41' })
  orderId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '1234567890_1' })
  orderSubOrderNo!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  matchedAt!: string | null;

  @ApiProperty({
    type: UserRefDto,
    nullable: true,
    description: 'Who matched it (manual matches only)',
  })
  matchedBy!: UserRefDto | null;

  @ApiProperty({
    description:
      'Set by a manual unmatch: automatic matching skips the entry until someone matches it manually',
  })
  autoMatchBlocked!: boolean;
}

export class SettlementEntryDto {
  @ApiProperty({ example: '501' })
  id!: string;

  @ApiProperty({ enum: SETTLEMENT_ENTRY_TYPES })
  entryType!: SettlementEntryType;

  @ApiProperty({ example: 'Order Payments' })
  sheetName!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Not unique: Meesho repeats transaction IDs',
  })
  transactionId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  subOrderNo!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  orderDate!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  paymentDate!: string | null;

  @ApiProperty({
    example: '420.15',
    description: 'Final settlement amount of the row, as reported',
  })
  settlementAmount!: string;

  @ApiProperty({ type: String, nullable: true })
  saleAmount!: string | null;

  @ApiProperty({ type: String, nullable: true })
  returnAmount!: string | null;

  @ApiProperty({ type: String, nullable: true })
  commissionAmount!: string | null;

  @ApiProperty({ type: String, nullable: true })
  shippingCharge!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Shown separately, never netted',
  })
  tcsAmount!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Shown separately, never netted',
  })
  tdsAmount!: string | null;

  @ApiProperty({ type: String, nullable: true })
  recoveryAmount!: string | null;

  @ApiProperty({ type: String, nullable: true })
  compensationAmount!: string | null;

  @ApiProperty()
  isEstimate!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Set when a later entry replaces this one (never summed)',
  })
  supersededByEntryId!: string | null;

  @ApiProperty({ type: ImportRefDto })
  importJob!: ImportRefDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: SettlementMatchDto })
  match!: SettlementMatchDto;
}

export class SettlementTotalsDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '775.70',
    description:
      'SUM(settlement_amount) of ALL rows matching the filters (not just this page), superseded rows excluded; as reported by Meesho, not profit. null when no row is summed',
  })
  settlementAmount!: string | null;

  @ApiProperty({ example: 7, description: 'Rows included in the sum' })
  count!: number;
}

export class SettlementListDto {
  @ApiProperty({ type: [SettlementEntryDto] })
  items!: SettlementEntryDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 25 })
  pageSize!: number;

  @ApiProperty({
    example: 7,
    description:
      'All rows matching the filters (superseded ones too when includeSuperseded=true)',
  })
  total!: number;

  @ApiProperty({ type: SettlementTotalsDto })
  totals!: SettlementTotalsDto;
}

/** Entry lists without totals (reconciliation exceptions). */
export class SettlementEntryPageDto {
  @ApiProperty({ type: [SettlementEntryDto] })
  items!: SettlementEntryDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 25 })
  pageSize!: number;

  @ApiProperty({ example: 3 })
  total!: number;
}
