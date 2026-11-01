import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
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
  toSearchText,
} from '../../common/http/list-query';
import { ImportRefDto } from '../../common/http/refs.dto';
import {
  PRODUCT_COST_STATES,
  type ProductCostState,
} from '../../products/effective-cost';
import { SettlementEntryDto } from '../../settlements/dto/settlement.dto';

export const ORDER_SORT_KEYS = [
  'orderDate',
  'subOrderNo',
  'currentStatus',
  'updatedAt',
] as const;
export type OrderSortKey = (typeof ORDER_SORT_KEYS)[number];
export const ORDER_SORTS = sortValues(ORDER_SORT_KEYS);
export type OrderSort = (typeof ORDER_SORTS)[number];
export const DEFAULT_ORDER_SORT: OrderSort = '-orderDate';

export const ORDER_SETTLEMENT_FILTERS = ['matched', 'unmatched'] as const;
export type OrderSettlementFilter = (typeof ORDER_SETTLEMENT_FILTERS)[number];

/** Longest raw status (orders.current_status is VARCHAR(64)). */
const STATUS_MAX_LENGTH = 64;

/** `status` (repeatable): raw statuses as returned by GET .../orders/statuses, matched exactly. */
export class OrderStatusFilterQueryDto extends ListPageQueryDto {
  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_FILTER_VALUES,
    description:
      'Repeatable (?status=A&status=B). Raw statuses exactly as reported (case-sensitive), as listed by GET .../orders/statuses',
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsString({ each: true })
  @Length(1, STATUS_MAX_LENGTH, { each: true })
  status?: string[];

  @ApiPropertyOptional({ enum: ORDER_SORTS, default: DEFAULT_ORDER_SORT })
  @IsOptional()
  @IsIn(ORDER_SORTS)
  sort: OrderSort = DEFAULT_ORDER_SORT;
}

export class ListOrdersQueryDto extends OrderStatusFilterQueryDto {
  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-01',
    description: 'Order date from (inclusive), YYYY-MM-DD',
  })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-31',
    description: 'Order date to (inclusive), YYYY-MM-DD; not before from',
  })
  @IsOptional()
  @IsCalendarDate()
  @IsNotBefore('from')
  to?: string;

  @ApiPropertyOptional({
    maxLength: MAX_SEARCH_LENGTH,
    description:
      'Search: sub order no or SKU starting with the text (exact case), or product name containing it (any case). % and _ match themselves. Blank = no search.',
  })
  @IsOptional()
  @Transform(toSearchText)
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  q?: string;

  @ApiPropertyOptional({
    enum: ORDER_SETTLEMENT_FILTERS,
    description:
      'matched = at least one matched, non-superseded settlement entry; unmatched = none',
  })
  @IsOptional()
  @IsIn(ORDER_SETTLEMENT_FILTERS)
  settlement?: OrderSettlementFilter;
}

// Response-shape classes for Swagger: never constructed with `new`, instances are typed object literals, hence `!`.

export class OrderSettlementSummaryDto {
  @ApiProperty({
    example: 2,
    description: 'Matched settlement entries that are not superseded',
  })
  entryCount!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '400.80',
    description:
      'SUM(settlement_amount) of those entries, as reported by Meesho (not profit); null when there are none',
  })
  amount!: string | null;
}

/** Product cost of an order line (M6): effective unit cost on the ORDER date × quantity. */
export class OrderProductCostDto {
  @ApiProperty({
    enum: PRODUCT_COST_STATES,
    description:
      'known: a cost is effective on the order date; unknown: the product has no cost on that date (profit incomplete, never 0); no_product: the order is mapped to no product (no SKU, or data imported before M6 not yet synced)',
  })
  state!: ProductCostState;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '549.5000',
    description: 'Unit cost (4 decimals) effective on the order date',
  })
  unitCost!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date',
    example: '2026-10-02',
    description: 'effectiveFrom of that cost row',
  })
  effectiveFrom!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1099.0000',
    description:
      'unitCost × quantity, exact (4 decimals, computed in DECIMAL by MySQL); null unless state is known',
  })
  total!: string | null;
}

export class OrderSummaryDto {
  @ApiProperty({ example: '41' })
  id!: string;

  @ApiProperty({ example: '1234567890_1' })
  subOrderNo!: string;

  @ApiProperty({ type: String, nullable: true })
  orderNo!: string | null;

  @ApiProperty({ format: 'date', example: '2026-10-01' })
  orderDate!: string;

  @ApiProperty({ type: String, nullable: true })
  productName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  sku!: string | null;

  @ApiProperty({ type: String, nullable: true })
  size!: string | null;

  @ApiProperty({ example: 1 })
  quantity!: number;

  @ApiProperty({ type: String, nullable: true })
  customerState!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '499.00',
    description: 'As reported (per unit vs line total not yet known)',
  })
  supplierListedPrice!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '449.00',
    description: 'As reported (per unit vs line total not yet known)',
  })
  supplierDiscountedPrice!: string | null;

  @ApiProperty({
    example: 'DELIVERED',
    description: 'Raw status of the latest observation',
  })
  currentStatus!: string;

  @ApiProperty({ format: 'date-time' })
  currentStatusObservedAt!: string;

  @ApiProperty({ type: OrderSettlementSummaryDto })
  settlement!: OrderSettlementSummaryDto;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '7',
    description:
      'Product with the same SKU in this account (M6 mapping rule); null when the order has no SKU or the SKU has no product yet',
  })
  productId!: string | null;

  @ApiProperty({ type: OrderProductCostDto })
  productCost!: OrderProductCostDto;
}

export class OrderListDto {
  @ApiProperty({ type: [OrderSummaryDto] })
  items!: OrderSummaryDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 25 })
  pageSize!: number;

  @ApiProperty({ example: 120, description: 'All rows matching the filters' })
  total!: number;
}

export class OrderStatusCountDto {
  @ApiProperty({ example: 'DELIVERED', description: 'Raw status, exact' })
  status!: string;

  @ApiProperty({ example: 42 })
  count!: number;
}

export class OrderStatusListDto {
  @ApiProperty({
    type: [OrderStatusCountDto],
    description: 'Current statuses of the account, most orders first',
  })
  items!: OrderStatusCountDto[];
}

export class StatusEventDto {
  @ApiProperty({ example: '301' })
  id!: string;

  @ApiProperty({ example: 'SHIPPED', description: 'Raw status as observed' })
  status!: string;

  @ApiProperty({
    format: 'date-time',
    description:
      "When the status was current: the import's dataAsOf (orders CSV) or upload time",
  })
  observedAt!: string;

  @ApiProperty({ type: ImportRefDto })
  importJob!: ImportRefDto;
}

export class StatusEventListDto {
  @ApiProperty({
    type: [StatusEventDto],
    description: 'Oldest observation first (observedAt, then id)',
  })
  items!: StatusEventDto[];
}

export class OrderDetailDto extends OrderSummaryDto {
  @ApiProperty({ type: String, nullable: true })
  catalogId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  packetId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: ImportRefDto })
  firstImport!: ImportRefDto;

  @ApiProperty({
    type: ImportRefDto,
    description: 'Import the current values came from',
  })
  lastImport!: ImportRefDto;

  @ApiProperty({ type: [StatusEventDto] })
  statusHistory!: StatusEventDto[];

  @ApiProperty({
    type: [SettlementEntryDto],
    description:
      'Every entry matched to this order (payment date, then id); superseded ones carry supersededByEntryId and are not in settlement.amount',
  })
  settlements!: SettlementEntryDto[];
}
