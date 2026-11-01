import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Actor } from '../auth/auth.types';
import { CurrentActor } from '../auth/current-user.decorator';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import {
  ACCOUNT_ID_PARAM,
  ACCOUNT_NOT_FOUND_DOC,
  LIST_BAD_REQUEST_DOC,
} from '../common/http/account-docs';
import { ParseIdPipe } from '../common/http/parse-id.pipe';
import {
  ExpensesExportQueryDto,
  OrdersExportQueryDto,
  SettlementsExportQueryDto,
  WorkspaceExpensesExportQueryDto,
} from './dto/report.dto';
import { ReportsService } from './reports.service';

const WORKSPACE_ID_PARAM = {
  name: 'workspaceId',
  description: 'Workspace id (positive integer, as a string)',
  example: '1',
};
const CSV_OK = {
  description:
    "text/csv; charset=utf-8 download (UTF-8 BOM, CRLF, header row; Content-Disposition attachment with an ASCII filename and an RFC 5987 filename*). Amounts as plain numbers, empty cell = missing; text cells starting with TAB / CR, or with = + - @ (or full-width ＝ ＋ － ＠) after leading spaces / TAB / CR / LF, are prefixed with '. A client that accepts no data for 60 s is cut off. HEAD runs only the row-count check and returns the headers (no audit row)",
  schema: { type: 'string' },
};
const TOO_LARGE = {
  type: ErrorResponseDto,
  description:
    'EXPORT_TOO_LARGE: more rows than REPORT_MAX_ROWS (default 100000); narrow the filters',
};
const BUSY = {
  type: ErrorResponseDto,
  description:
    'RATE_LIMITED "Exports are busy, try again in a moment." (2 exports already streaming in this process); Retry-After: 5',
};
const NOTE =
  'Members. Same filters and sort as the list, no page/pageSize. Audit row report.exported (type, filters, row count).';

@ApiTags('reports')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid session',
})
@ApiProduces('text/csv', 'application/json')
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('accounts/:accountId/reports/orders.csv')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary: 'Orders CSV (filters of GET .../orders)',
    description: NOTE,
  })
  @ApiOkResponse(CSV_OK)
  @ApiBadRequestResponse(LIST_BAD_REQUEST_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  @ApiUnprocessableEntityResponse(TOO_LARGE)
  @ApiTooManyRequestsResponse(BUSY)
  orders(
    @CurrentActor() actor: Actor,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Query() query: OrdersExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.reports.orders(
      { actor, res, headOnly: req.method === 'HEAD' },
      accountId,
      query,
    );
  }

  @Get('accounts/:accountId/reports/settlements.csv')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary:
      'Settlement entries CSV (filters of GET .../settlements, incl. dateBasis)',
    description: NOTE,
  })
  @ApiOkResponse(CSV_OK)
  @ApiBadRequestResponse(LIST_BAD_REQUEST_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  @ApiUnprocessableEntityResponse(TOO_LARGE)
  @ApiTooManyRequestsResponse(BUSY)
  settlements(
    @CurrentActor() actor: Actor,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Query() query: SettlementsExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.reports.settlements(
      { actor, res, headOnly: req.method === 'HEAD' },
      accountId,
      query,
    );
  }

  @Get('accounts/:accountId/reports/expenses.csv')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary: "A seller account's expenses CSV (from, to, category, sort)",
    description: NOTE,
  })
  @ApiOkResponse(CSV_OK)
  @ApiBadRequestResponse(LIST_BAD_REQUEST_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  @ApiUnprocessableEntityResponse(TOO_LARGE)
  @ApiTooManyRequestsResponse(BUSY)
  accountExpenses(
    @CurrentActor() actor: Actor,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Query() query: ExpensesExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.reports.accountExpenses(
      { actor, res, headOnly: req.method === 'HEAD' },
      accountId,
      query,
    );
  }

  @Get('workspaces/:workspaceId/reports/expenses.csv')
  @ApiParam(WORKSPACE_ID_PARAM)
  @ApiOperation({
    summary:
      "A workspace's expenses CSV: scope=workspace (default, workspace-wide only) or all (also every account's)",
    description: NOTE,
  })
  @ApiOkResponse(CSV_OK)
  @ApiBadRequestResponse(LIST_BAD_REQUEST_DOC)
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such workspace, or the caller is not a member',
  })
  @ApiUnprocessableEntityResponse(TOO_LARGE)
  @ApiTooManyRequestsResponse(BUSY)
  workspaceExpenses(
    @CurrentActor() actor: Actor,
    @Param('workspaceId', ParseIdPipe) workspaceId: string,
    @Query() query: WorkspaceExpensesExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.reports.workspaceExpenses(
      { actor, res, headOnly: req.method === 'HEAD' },
      workspaceId,
      query,
    );
  }
}
