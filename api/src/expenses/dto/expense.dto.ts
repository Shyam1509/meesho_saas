import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import {
  IsCalendarDate,
  IsNotBefore,
  ListPageQueryDto,
  MAX_FILTER_VALUES,
  sortValues,
  toArray,
} from '../../common/http/list-query';
import { UserRefDto } from '../../common/http/refs.dto';
import { trimNullableText } from '../../common/http/transforms';
import {
  EXPENSE_AMOUNT_RULE,
  IsDecimalText,
  IsNotAfterIndiaToday,
  toDecimalText,
} from '../../common/http/value-rules';
import { EXPENSE_SCOPES, type ExpenseScope } from '../../database/models';
import {
  categoryRequiresDescription,
  DESCRIPTION_REQUIRED_REASON,
  EXPENSE_CATEGORY_KEYS,
  type ExpenseCategoryKey,
} from '../expense-categories';

export const EXPENSE_DESCRIPTION_MAX_LENGTH = 255;

/** One reason per problem (missing, not text, too long); never echoes the value. */
export function descriptionProblem(value: unknown): string | null {
  if (value === undefined || value === null) return DESCRIPTION_REQUIRED_REASON;
  if (typeof value !== 'string') return 'description must be a string';
  if ([...value].length > EXPENSE_DESCRIPTION_MAX_LENGTH) {
    return `description must be at most ${EXPENSE_DESCRIPTION_MAX_LENGTH} characters`;
  }
  return null;
}

function IsExpenseDescription(): PropertyDecorator {
  return ValidateBy({
    name: 'isExpenseDescription',
    validator: {
      validate: (value: unknown) => descriptionProblem(value) === null,
      defaultMessage: (args?: ValidationArguments) =>
        descriptionProblem(args?.value) ?? 'description is invalid',
    },
  });
}

export const EXPENSE_SORT_KEYS = [
  'expenseDate',
  'amount',
  'category',
  'createdAt',
] as const;
export type ExpenseSortKey = (typeof EXPENSE_SORT_KEYS)[number];
export const EXPENSE_SORTS = sortValues(EXPENSE_SORT_KEYS);
export type ExpenseSort = (typeof EXPENSE_SORTS)[number];
export const DEFAULT_EXPENSE_SORT: ExpenseSort = '-expenseDate';

export const WORKSPACE_EXPENSE_SCOPE_FILTERS = ['workspace', 'all'] as const;
export type WorkspaceExpenseScopeFilter =
  (typeof WORKSPACE_EXPENSE_SCOPE_FILTERS)[number];

/** `?page&pageSize&sort&from&to&category` of an account's expenses. */
export class ListExpensesQueryDto extends ListPageQueryDto {
  @ApiPropertyOptional({
    enum: EXPENSE_SORTS,
    default: DEFAULT_EXPENSE_SORT,
    description:
      'category sorts by the category label (as GET /expenses/categories shows it), not the key. Ties break on id in the same direction',
  })
  @IsOptional()
  @IsIn(EXPENSE_SORTS)
  sort: ExpenseSort = DEFAULT_EXPENSE_SORT;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-01',
    description: 'Expense date from (inclusive), YYYY-MM-DD',
  })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-31',
    description: 'Expense date to (inclusive), YYYY-MM-DD; not before from',
  })
  @IsOptional()
  @IsCalendarDate()
  @IsNotBefore('from')
  to?: string;

  @ApiPropertyOptional({
    enum: EXPENSE_CATEGORY_KEYS,
    isArray: true,
    description: 'Repeatable (?category=packaging&category=staff)',
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsIn(EXPENSE_CATEGORY_KEYS, { each: true })
  category?: ExpenseCategoryKey[];
}

/** Workspace list: `scope=workspace` (default, workspace-wide expenses only) or `all` (also every account's). */
export class ListWorkspaceExpensesQueryDto extends ListExpensesQueryDto {
  @ApiPropertyOptional({
    enum: WORKSPACE_EXPENSE_SCOPE_FILTERS,
    default: 'workspace',
    description:
      "workspace = workspace-wide expenses only; all = also every seller account's expenses",
  })
  @IsOptional()
  @IsIn(WORKSPACE_EXPENSE_SCOPE_FILTERS)
  scope: WorkspaceExpenseScopeFilter = 'workspace';
}

export class CreateExpenseDto {
  @ApiProperty({
    format: 'date',
    example: '2026-10-05',
    description: 'YYYY-MM-DD, not after today (India)',
  })
  @IsCalendarDate()
  @IsNotAfterIndiaToday()
  expenseDate!: string;

  @ApiProperty({
    enum: EXPENSE_CATEGORY_KEYS,
    description:
      'GET /expenses/categories lists them with labels and help. Excludes everything the settlement workbook already deducts and product purchase cost',
  })
  @IsIn(EXPENSE_CATEGORY_KEYS)
  category!: ExpenseCategoryKey;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: EXPENSE_DESCRIPTION_MAX_LENGTH,
    description: 'Required for category "other"; blank = none',
  })
  @ValidateIf(
    (dto: CreateExpenseDto) =>
      (dto.description !== undefined && dto.description !== null) ||
      categoryRequiresDescription(dto.category),
  )
  @Transform(trimNullableText)
  @IsExpenseDescription()
  description?: string | null;

  @ApiProperty({
    type: String,
    example: '1200.50',
    description:
      'INR, decimal string (a JSON number is accepted): 0 < amount < 10000000000, at most 2 decimals',
  })
  @Transform(toDecimalText)
  @IsDecimalText(EXPENSE_AMOUNT_RULE)
  amount!: string;
}

/**
 * Every field optional; omitted = unchanged. The scope and the account never change (unknown fields such as
 * `scope` are rejected). When the resulting category is "other" the resulting description must be set.
 */
export class UpdateExpenseDto {
  @ApiPropertyOptional({
    format: 'date',
    description: 'Not after today (India)',
  })
  @ValidateIf((dto: UpdateExpenseDto) => dto.expenseDate !== undefined)
  @IsCalendarDate()
  @IsNotAfterIndiaToday()
  expenseDate?: string;

  @ApiPropertyOptional({ enum: EXPENSE_CATEGORY_KEYS })
  @ValidateIf((dto: UpdateExpenseDto) => dto.category !== undefined)
  @IsIn(EXPENSE_CATEGORY_KEYS)
  category?: ExpenseCategoryKey;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: EXPENSE_DESCRIPTION_MAX_LENGTH,
    description: 'null or blank clears it (not allowed for category "other")',
  })
  @IsOptional()
  @Transform(trimNullableText)
  @IsExpenseDescription()
  description?: string | null;

  @ApiPropertyOptional({ type: String, example: '1300.00' })
  @ValidateIf((dto: UpdateExpenseDto) => dto.amount !== undefined)
  @Transform(toDecimalText)
  @IsDecimalText(EXPENSE_AMOUNT_RULE)
  amount?: string;
}

// Response-shape classes for Swagger: never constructed with `new`, instances are typed object literals, hence `!`.

export class ExpenseCategoryDto {
  @ApiProperty({ example: 'packaging' })
  key!: string;

  @ApiProperty({ example: 'Packaging & labels' })
  label!: string;

  @ApiProperty()
  help!: string;

  @ApiProperty({ description: 'true for "other"' })
  descriptionRequired!: boolean;
}

export class ExpenseCategoryListDto {
  @ApiProperty({ type: [ExpenseCategoryDto] })
  items!: ExpenseCategoryDto[];
}

export class ExpenseDto {
  @ApiProperty({ example: '31' })
  id!: string;

  @ApiProperty({ example: '1' })
  workspaceId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2',
    description: 'null for a workspace-wide expense',
  })
  sellerAccountId!: string | null;

  @ApiProperty({ enum: EXPENSE_SCOPES })
  scope!: ExpenseScope;

  @ApiProperty({ format: 'date', example: '2026-10-05' })
  expenseDate!: string;

  @ApiProperty({ example: 'packaging' })
  category!: string;

  @ApiProperty({ example: 'Packaging & labels' })
  categoryLabel!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ example: '1200.50', description: 'INR, 2 decimals' })
  amount!: string;

  @ApiProperty({ type: UserRefDto })
  createdBy!: UserRefDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ExpenseTotalsDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '16300.49',
    description:
      'SUM(amount) of ALL rows matching the filters (not just this page), in DECIMAL; null when none',
  })
  amount!: string | null;

  @ApiProperty({ example: 3, description: 'Rows included in the sum' })
  count!: number;
}

export class ExpenseListDto {
  @ApiProperty({ type: [ExpenseDto] })
  items!: ExpenseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 25 })
  pageSize!: number;

  @ApiProperty({ example: 3, description: 'All rows matching the filters' })
  total!: number;

  @ApiProperty({ type: ExpenseTotalsDto })
  totals!: ExpenseTotalsDto;
}
