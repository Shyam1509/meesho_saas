import { OmitType } from '@nestjs/swagger';
import {
  ListExpensesQueryDto,
  ListWorkspaceExpensesQueryDto,
} from '../../expenses/dto/expense.dto';
import { ListOrdersQueryDto } from '../../orders/dto/order.dto';
import { ListSettlementsQueryDto } from '../../settlements/dto/settlement.dto';

/**
 * CSV export queries (Milestone 7): exactly the filters and sort of the matching list, without `page` /
 * `pageSize` (an export is never paged; sending them is an unknown parameter → 400). OmitType keeps the
 * list DTO's validation, transforms and defaults, so a list URL's filters can be reused as they are.
 */
export class OrdersExportQueryDto extends OmitType(ListOrdersQueryDto, [
  'page',
  'pageSize',
] as const) {}

export class SettlementsExportQueryDto extends OmitType(
  ListSettlementsQueryDto,
  ['page', 'pageSize'] as const,
) {}

export class ExpensesExportQueryDto extends OmitType(ListExpensesQueryDto, [
  'page',
  'pageSize',
] as const) {}

export class WorkspaceExpensesExportQueryDto extends OmitType(
  ListWorkspaceExpensesQueryDto,
  ['page', 'pageSize'] as const,
) {}

export const REPORT_TYPES = ['orders', 'settlements', 'expenses'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
