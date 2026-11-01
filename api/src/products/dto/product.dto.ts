import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  IsCalendarDate,
  ListPageQueryDto,
  MAX_SEARCH_LENGTH,
  sortValues,
  toSearchText,
} from '../../common/http/list-query';
import { UserRefDto } from '../../common/http/refs.dto';
import {
  cleanNullableText,
  cleanText,
  trimNullableText,
} from '../../common/http/transforms';
import {
  IsDecimalText,
  IsNotAfterIndiaToday,
  toDecimalText,
  UNIT_COST_RULE,
} from '../../common/http/value-rules';
import { PRODUCT_STATUSES, type ProductStatus } from '../../database/models';

export const SKU_MAX_LENGTH = 128;
export const PRODUCT_NAME_MAX_LENGTH = 512;
export const CATALOG_ID_MAX_LENGTH = 64;
export const COST_NOTE_MAX_LENGTH = 255;
/** A cost may start up to this many days after today (India): planned price changes. */
export const COST_MAX_DAYS_AHEAD = 366;

export const PRODUCT_SORT_KEYS = [
  'sku',
  'name',
  'orderCount',
  'currentUnitCost',
] as const;
export type ProductSortKey = (typeof PRODUCT_SORT_KEYS)[number];
export const PRODUCT_SORTS = sortValues(PRODUCT_SORT_KEYS);
export type ProductSort = (typeof PRODUCT_SORTS)[number];
export const DEFAULT_PRODUCT_SORT: ProductSort = 'sku';

export const PRODUCT_STATUS_FILTERS = ['active', 'archived', 'all'] as const;
export type ProductStatusFilter = (typeof PRODUCT_STATUS_FILTERS)[number];

export const PRODUCT_COST_FILTERS = ['missing', 'known', 'incomplete'] as const;
export type ProductCostFilter = (typeof PRODUCT_COST_FILTERS)[number];

export class ListProductsQueryDto extends ListPageQueryDto {
  @ApiPropertyOptional({
    enum: PRODUCT_SORTS,
    default: DEFAULT_PRODUCT_SORT,
    description:
      'Ties break on id in the same direction. name and currentUnitCost put products without a value last in both directions',
  })
  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort: ProductSort = DEFAULT_PRODUCT_SORT;

  @ApiPropertyOptional({
    maxLength: MAX_SEARCH_LENGTH,
    description:
      'Search: SKU starting with the text (exact case) or name containing it (any case). % and _ match themselves. Blank = no search.',
  })
  @IsOptional()
  @Transform(toSearchText)
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  q?: string;

  @ApiPropertyOptional({ enum: PRODUCT_STATUS_FILTERS, default: 'active' })
  @IsOptional()
  @IsIn(PRODUCT_STATUS_FILTERS)
  status: ProductStatusFilter = 'active';

  @ApiPropertyOptional({
    enum: PRODUCT_COST_FILTERS,
    description:
      'missing = no cost effective today (India), i.e. currentCost is null; known = currentCost set; incomplete = at least one order without a cost on its order date (ordersWithoutCost > 0)',
  })
  @IsOptional()
  @IsIn(PRODUCT_COST_FILTERS)
  cost?: ProductCostFilter;
}

export class CreateProductDto {
  @ApiProperty({
    minLength: 1,
    maxLength: SKU_MAX_LENGTH,
    example: 'KUR-RED-M',
    description:
      'Exactly as in the Meesho reports (case-sensitive). Invisible format characters are removed and spaces collapsed, like the importer does',
  })
  @Transform(cleanText)
  @IsString()
  @Length(1, SKU_MAX_LENGTH)
  sku!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: PRODUCT_NAME_MAX_LENGTH,
    description: 'Blank = none',
  })
  @IsOptional()
  @Transform(cleanNullableText)
  @IsString()
  @MaxLength(PRODUCT_NAME_MAX_LENGTH)
  name?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: CATALOG_ID_MAX_LENGTH,
    description: 'Meesho catalog id; blank = none',
  })
  @IsOptional()
  @Transform(cleanNullableText)
  @IsString()
  @MaxLength(CATALOG_ID_MAX_LENGTH)
  catalogId?: string | null;
}

/** Every field optional; omitted = unchanged. The SKU never changes (the order mapping depends on it). */
export class UpdateProductDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: PRODUCT_NAME_MAX_LENGTH,
    description: 'null or blank clears the name',
  })
  @IsOptional()
  @Transform(cleanNullableText)
  @IsString()
  @MaxLength(PRODUCT_NAME_MAX_LENGTH)
  name?: string | null;

  @ApiPropertyOptional({
    enum: PRODUCT_STATUSES,
    description:
      'archived hides the product from the default list; its orders stay mapped',
  })
  @ValidateIf((dto: UpdateProductDto) => dto.status !== undefined)
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;
}

export class AddCostDto {
  @ApiProperty({
    format: 'date',
    example: '2026-10-01',
    description: `First day this unit cost applies (YYYY-MM-DD); at most ${COST_MAX_DAYS_AHEAD} days after today (India). One cost per date`,
  })
  @IsCalendarDate()
  @IsNotAfterIndiaToday(COST_MAX_DAYS_AHEAD)
  effectiveFrom!: string;

  @ApiProperty({
    type: String,
    example: '549.50',
    description:
      'Unit purchase cost in INR, decimal string (a JSON number is accepted): 0 ≤ cost < 100000000, at most 4 decimals. 0 is a real cost of zero',
  })
  @Transform(toDecimalText)
  @IsDecimalText(UNIT_COST_RULE)
  unitCost!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: COST_NOTE_MAX_LENGTH,
    description: 'Blank = none',
  })
  @IsOptional()
  @Transform(trimNullableText)
  @IsString()
  @MaxLength(COST_NOTE_MAX_LENGTH)
  note?: string | null;
}

// Response-shape classes for Swagger: never constructed with `new`, instances are typed object literals, hence `!`.

export class CurrentCostDto {
  @ApiProperty({ example: '549.5000', description: '4 decimals' })
  unitCost!: string;

  @ApiProperty({ format: 'date', example: '2026-10-01' })
  effectiveFrom!: string;
}

export class ProductSummaryDto {
  @ApiProperty({ example: '7' })
  id!: string;

  @ApiProperty({
    example: '1',
    description:
      'Workspace of the seller account (match it against GET /auth/me workspaces for the caller role)',
  })
  workspaceId!: string;

  @ApiProperty({ example: '1' })
  sellerAccountId!: string;

  @ApiProperty({ example: 'KUR-RED-M' })
  sku!: string;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  catalogId!: string | null;

  @ApiProperty({ enum: PRODUCT_STATUSES })
  status!: ProductStatus;

  @ApiProperty({ example: 12, description: 'Orders mapped to this product' })
  orderCount!: number;

  @ApiProperty({
    example: 3,
    description:
      'Of those, orders with no cost effective on their order date (product cost unknown)',
  })
  ordersWithoutCost!: number;

  @ApiProperty({
    type: CurrentCostDto,
    nullable: true,
    description:
      'Cost effective TODAY (India); null when none is (no cost yet, or only future-dated ones)',
  })
  currentCost!: CurrentCostDto | null;

  @ApiProperty({ example: 2, description: 'Cost history rows' })
  costCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CostEntryDto {
  @ApiProperty({ example: '15' })
  id!: string;

  @ApiProperty({ example: '549.5000', description: '4 decimals' })
  unitCost!: string;

  @ApiProperty({ format: 'date', example: '2026-10-01' })
  effectiveFrom!: string;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: UserRefDto })
  createdBy!: UserRefDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ProductDetailDto extends ProductSummaryDto {
  @ApiProperty({
    type: [CostEntryDto],
    description: 'Newest effectiveFrom first',
  })
  costHistory!: CostEntryDto[];
}

export class ProductListDto {
  @ApiProperty({ type: [ProductSummaryDto] })
  items!: ProductSummaryDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 25 })
  pageSize!: number;

  @ApiProperty({
    example: 40,
    description: 'All products matching the filters',
  })
  total!: number;
}

export class ProductSyncResultDto {
  @ApiProperty({
    example: 3,
    description: 'Products created for SKUs of this account that had none',
  })
  createdProducts!: number;

  @ApiProperty({
    example: 25,
    description:
      'Orders whose product link was set or corrected (orders already linked correctly are not counted)',
  })
  linkedOrders!: number;
}
