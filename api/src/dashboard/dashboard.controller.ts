import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import {
  ACCOUNT_ID_PARAM,
  ACCOUNT_NOT_FOUND_DOC,
} from '../common/http/account-docs';
import { ParseIdPipe } from '../common/http/parse-id.pipe';
import { CONTRIBUTION_FORMULA } from './contribution';
import { DashboardService } from './dashboard.service';
import { DashboardDto, DashboardQueryDto } from './dto/dashboard.dto';

const WORKSPACE_ID_PARAM = {
  name: 'workspaceId',
  description: 'Workspace id (positive integer, as a string)',
  example: '1',
};
const BAD_REQUEST_DOC = {
  type: ErrorResponseDto,
  description:
    'Invalid id, date (not a real YYYY-MM-DD), to before from, range longer than 731 days, unknown basis / granularity, or an unknown parameter',
};
const DESCRIPTION = `Metric definitions: api/README.md "Dashboard and reports". Amounts are DECIMAL strings, null = no rows. Estimated contribution = ${CONTRIBUTION_FORMULA}: not profit, not a bank payout, not tax advice.`;

@ApiTags('dashboard')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid session',
})
@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('accounts/:accountId/dashboard')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary: "One seller account's dashboard (members)",
    description: DESCRIPTION,
  })
  @ApiOkResponse({ type: DashboardDto })
  @ApiBadRequestResponse(BAD_REQUEST_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  forAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Query() query: DashboardQueryDto,
  ): Promise<DashboardDto> {
    return this.dashboard.forAccount(user.id, accountId, query);
  }

  @Get('workspaces/:workspaceId/dashboard')
  @ApiParam(WORKSPACE_ID_PARAM)
  @ApiOperation({
    summary:
      'Dashboard of every seller account of a workspace, plus workspace-wide expenses and a per-account comparison (members)',
    description: DESCRIPTION,
  })
  @ApiOkResponse({ type: DashboardDto })
  @ApiBadRequestResponse(BAD_REQUEST_DOC)
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such workspace, or the caller is not a member',
  })
  forWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseIdPipe) workspaceId: string,
    @Query() query: DashboardQueryDto,
  ): Promise<DashboardDto> {
    return this.dashboard.forWorkspace(user.id, workspaceId, query);
  }
}
