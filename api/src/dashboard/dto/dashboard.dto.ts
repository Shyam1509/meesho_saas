import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { DATE_BASES, type DateBasis } from '../../common/http/date-basis';
import {
  IsCalendarDate,
  IsNotBefore,
  MAX_FILTER_VALUES,
  toArray,
} from '../../common/http/list-query';
import {
  SETTLEMENT_ENTRY_TYPES,
  type SettlementEntryType,
} from '../../database/models';
import { STATUS_MAX_LENGTH } from '../../orders/dto/order.dto';
import { CANCELLED_OR_RETURNED_KEYWORDS } from '../../orders/order-status-classes';
import { CONTRIBUTION_FORMULA } from '../contribution';
import {
  DASHBOARD_MAX_RANGE_DAYS,
  GRANULARITIES,
  type Granularity,
} from '../dashboard-range';

const MONEY = (description: string, example = '1234.50') =>
  ({ type: String, nullable: true, example, description }) as const;

/** `?from&to&basis&status&granularity` of both dashboards (unknown parameters → 400). */
export class DashboardQueryDto {
  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-01',
    description:
      'From (inclusive), YYYY-MM-DD. Default: `to` − 29 days (last 30 days ending `to`)',
  })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-31',
    description: `To (inclusive), YYYY-MM-DD, not before from; default today (India). At most ${DASHBOARD_MAX_RANGE_DAYS} days from from to to, both included`,
  })
  @IsOptional()
  @IsCalendarDate()
  @IsNotBefore('from')
  to?: string;

  @ApiPropertyOptional({
    enum: DATE_BASES,
    default: 'order_date',
    description:
      'order_date: orders by order date, their settlements whatever the payment date. payment_date: orders by the payment date of their FIRST matched settlement entry, settlements by payment date',
  })
  @IsOptional()
  @IsIn(DATE_BASES)
  basis?: DateBasis;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_FILTER_VALUES,
    description:
      "Repeatable raw order statuses (exact). Applies to the order metrics; in the order_date basis also to which orders' settlements and costs are included",
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsString({ each: true })
  @Length(1, STATUS_MAX_LENGTH, { each: true })
  status?: string[];

  @ApiPropertyOptional({
    enum: GRANULARITIES,
    description:
      'Trend buckets: day, week (ISO, starting Monday) or month. Default: day up to 62 days, week up to 366, else month',
  })
  @IsOptional()
  @IsIn(GRANULARITIES)
  granularity?: Granularity;
}

// Response-shape classes for Swagger: never constructed with `new`, instances are typed object literals, hence `!`.

export class DashboardScopeDto {
  @ApiProperty({ enum: ['account', 'workspace'] })
  kind!: 'account' | 'workspace';

  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({
    example: 'Shop One',
    description: 'Account display name / workspace name',
  })
  name!: string;
}

export class DashboardFiltersDto {
  @ApiProperty({ format: 'date' })
  from!: string;

  @ApiProperty({ format: 'date' })
  to!: string;

  @ApiProperty({ enum: DATE_BASES })
  basis!: DateBasis;

  @ApiProperty({
    type: [String],
    description: 'De-duplicated; [] = no status filter',
  })
  statuses!: string[];

  @ApiProperty({ enum: GRANULARITIES })
  granularity!: Granularity;
}

export class DashboardStatusCountDto {
  @ApiProperty({ example: 'DELIVERED' })
  status!: string;

  @ApiProperty({ example: 4 })
  count!: number;
}

export class DashboardOrdersDto {
  @ApiProperty({ example: 6, description: 'Orders in scope' })
  count!: number;

  @ApiProperty({ example: 9, description: 'Σ quantity of the orders in scope' })
  units!: number;

  @ApiProperty({
    type: [DashboardStatusCountDto],
    description:
      'Orders in scope by raw current status (exact), most first, then by status',
  })
  statusCounts!: DashboardStatusCountDto[];

  @ApiProperty(
    MONEY(
      'Order value (as reported by Meesho — whether this is per unit or per order line is not confirmed yet): Σ supplier_discounted_price of the orders in scope; null when none has one. Not sales or revenue',
    ),
  )
  orderValueDiscounted!: string | null;

  @ApiProperty(
    MONEY(
      'The same for supplier_listed_price (as reported; per unit vs per line not confirmed)',
    ),
  )
  orderValueListed!: string | null;

  @ApiProperty({
    example: 1,
    description:
      'Orders in scope without a discounted price (shown, never treated as 0)',
  })
  pricesMissing!: number;
}

export class DashboardSettlementTypeDto {
  @ApiProperty({ enum: SETTLEMENT_ENTRY_TYPES })
  entryType!: SettlementEntryType;

  @ApiProperty(MONEY('Σ settlement_amount of this type; null when none'))
  amount!: string | null;

  @ApiProperty({ example: 2 })
  count!: number;
}

export class DashboardSettlementComponentsDto {
  @ApiProperty(MONEY('Σ sale amount', '1910.00'))
  sale!: string | null;

  @ApiProperty(MONEY('Σ return amount', '-450.00'))
  return!: string | null;

  @ApiProperty(MONEY('Σ Meesho commission', '-160.00'))
  commission!: string | null;

  @ApiProperty(MONEY('Σ shipping charge', '-90.00'))
  shipping!: string | null;

  @ApiProperty(MONEY('Σ TCS — not tax advice or a filed liability', '-4.50'))
  tcs!: string | null;

  @ApiProperty(MONEY('Σ TDS — not tax advice or a filed liability', '-9.00'))
  tds!: string | null;

  @ApiProperty(MONEY('Σ recovery column', '-5.00'))
  recovery!: string | null;

  @ApiProperty(MONEY('Σ compensation column', '10.00'))
  compensation!: string | null;
}

export class DashboardSettlementsDto {
  @ApiProperty(
    MONEY(
      'Settlement amount (as reported): Σ settlement_amount of the non-superseded entries in scope. order_date basis: entries matched to an order in scope + unmatched entries whose own order date is in range + account-level entries whose payment date is in range. payment_date basis: entries whose payment date is in range',
      '829.00',
    ),
  )
  amount!: string | null;

  @ApiProperty({ example: 11, description: 'Entries summed' })
  count!: number;

  @ApiProperty({
    example: 1,
    description:
      'Non-superseded entries of the scope without the date the basis needs, regardless of the date range (all time; excluded from every sum)',
  })
  undatedEntries!: number;

  @ApiProperty({
    type: [DashboardSettlementTypeDto],
    description:
      'Every entry type, always in the same order (amount null and count 0 when none)',
  })
  byType!: DashboardSettlementTypeDto[];

  @ApiProperty({
    type: DashboardSettlementComponentsDto,
    description:
      'Informational sums over the same entries: already included in the settlement amount — not deducted again',
  })
  components!: DashboardSettlementComponentsDto;
}

export class DashboardProductCostDto {
  @ApiProperty(
    MONEY(
      'Product cost (known): Σ (effective unit cost on the order date × quantity) of the orders in scope whose cost is known, rounded half-up to 2 dp; null when none',
      '986.67',
    ),
  )
  known!: string | null;

  @ApiProperty(MONEY('The same sum, exact (4 dp)', '986.6666'))
  knownExact!: string | null;

  @ApiProperty({ example: 4 })
  ordersKnown!: number;

  @ApiProperty({
    example: 1,
    description: 'Orders whose product has no cost on the order date',
  })
  ordersCostUnknown!: number;

  @ApiProperty({
    example: 1,
    description: 'Orders mapped to no product (no SKU, or SKU without product)',
  })
  ordersNoProduct!: number;

  @ApiProperty({
    example: 1,
    description: `Orders in scope whose raw status contains, case-insensitively, ${CANCELLED_OR_RETURNED_KEYWORDS.join(' / ')} (keyword match until the real Meesho statuses are confirmed). Their known cost is still deducted`,
  })
  cancelledOrReturnedOrders!: number;

  @ApiProperty(
    MONEY(
      'Known product cost of those orders (2 dp), already included in `known`; null when none of them has a known cost',
      '120.00',
    ),
  )
  cancelledOrReturnedCost!: string | null;
}

export class DashboardExpensesDto {
  @ApiProperty(
    MONEY(
      'Expenses: Σ amount with expense date in range (regardless of basis); account dashboard: that account’s expenses; workspace: every account expense + the workspace-wide ones',
      '1100.00',
    ),
  )
  amount!: string | null;

  @ApiProperty({ example: 2 })
  count!: number;

  @ApiProperty(
    MONEY(
      'Seller-account expenses (the account’s own on an account dashboard)',
    ),
  )
  accountAmount!: string | null;

  @ApiProperty(
    MONEY(
      'Workspace-wide expenses (workspace dashboard only, else null)',
      '300.00',
    ),
  )
  workspaceAmount!: string | null;
}

export class DashboardFlagsDto {
  @ApiProperty({
    example: 2,
    description: 'Orders in scope with unknown cost or no product',
  })
  costUnknown!: number;

  @ApiProperty({
    example: 2,
    description:
      'Orders in scope with no matched, non-superseded settlement entry (not settled yet, or unmatched)',
  })
  ordersWithoutSettlement!: number;

  @ApiProperty({
    example: 1,
    description: 'Unmatched entries included in the settlement amount',
  })
  unmatchedSettlements!: number;

  @ApiProperty({
    example: 1,
    description: 'Orders in scope without a discounted price',
  })
  pricesMissing!: number;

  @ApiProperty({
    example: 1,
    description:
      'Orders in scope that look cancelled / RTO / returned (productCost.cancelledOrReturnedOrders): their known product cost is still deducted, so the estimate may be too low',
  })
  cancelledOrReturned!: number;
}

export class DashboardContributionDto {
  @ApiProperty(
    MONEY(
      'Estimated contribution = settlement amount − known product cost (2 dp) − expenses. Not profit, not a bank payout, not tax advice. null when all three are null',
      '-1257.67',
    ),
  )
  amount!: string | null;

  @ApiProperty({ description: 'true when no flag is raised' })
  complete!: boolean;

  @ApiProperty({
    type: DashboardFlagsDto,
    description: 'Each > 0 makes it "Incomplete because …"',
  })
  flags!: DashboardFlagsDto;

  @ApiProperty({ example: CONTRIBUTION_FORMULA })
  formula!: string;
}

export class DashboardTrendPointDto {
  @ApiProperty({
    format: 'date',
    description:
      'First day of the bucket (the day, the ISO Monday, or the 1st of the month); the first and last buckets may be partial',
  })
  bucketStart!: string;

  @ApiProperty({ example: 2, description: '0 when none' })
  orders!: number;

  @ApiProperty(MONEY('null when the bucket has no value (a gap, not 0)'))
  orderValueDiscounted!: string | null;

  @ApiProperty(MONEY('By each entry’s basis date; null when no entry'))
  settlementAmount!: string | null;

  @ApiProperty(MONEY('2 dp per bucket; null when no known cost'))
  productCostKnown!: string | null;

  @ApiProperty(MONEY('By expense date; null when none'))
  expenses!: string | null;
}

export class DashboardAccountRowDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'Shop One' })
  displayName!: string;

  @ApiProperty({
    enum: ['active', 'disabled'],
    description: 'Disabled accounts are included',
  })
  status!: string;

  @ApiProperty({ example: 6 })
  orders!: number;

  @ApiProperty(MONEY('As in orders.orderValueDiscounted'))
  orderValueDiscounted!: string | null;

  @ApiProperty(MONEY('As in settlements.amount'))
  settlementAmount!: string | null;

  @ApiProperty(MONEY('As in productCost.known (rounded per account)'))
  productCostKnown!: string | null;

  @ApiProperty(MONEY('The account’s own expenses (no workspace-wide ones)'))
  expenses!: string | null;

  @ApiProperty(
    MONEY('settlementAmount − productCostKnown − expenses of this account'),
  )
  contribution!: string | null;

  @ApiProperty({ description: 'No flag raised for this account' })
  complete!: boolean;

  @ApiProperty({
    example: 1,
    description: 'As productCost.cancelledOrReturnedOrders, for this account',
  })
  cancelledOrReturnedOrders!: number;
}

export class DashboardDto {
  @ApiProperty({ type: DashboardScopeDto })
  scope!: DashboardScopeDto;

  @ApiProperty({ type: DashboardFiltersDto })
  filters!: DashboardFiltersDto;

  @ApiProperty({ type: DashboardOrdersDto })
  orders!: DashboardOrdersDto;

  @ApiProperty({ type: DashboardSettlementsDto })
  settlements!: DashboardSettlementsDto;

  @ApiProperty({ type: DashboardProductCostDto })
  productCost!: DashboardProductCostDto;

  @ApiProperty({ type: DashboardExpensesDto })
  expenses!: DashboardExpensesDto;

  @ApiProperty({ type: DashboardContributionDto })
  contribution!: DashboardContributionDto;

  @ApiProperty({ type: [DashboardTrendPointDto] })
  trend!: DashboardTrendPointDto[];

  @ApiPropertyOptional({
    type: [DashboardAccountRowDto],
    description:
      'Workspace dashboard only: one row per seller account. Σ rows + workspace-wide expenses = the workspace totals',
  })
  accounts?: DashboardAccountRowDto[];

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;
}
