import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Actor, AuthenticatedUser } from '../auth/auth.types';
import { CurrentActor, CurrentUser } from '../auth/current-user.decorator';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import {
  ACCOUNT_ID_PARAM,
  ACCOUNT_NOT_FOUND_DOC,
  LIST_BAD_REQUEST_DOC,
} from '../common/http/account-docs';
import { ListPageQueryDto } from '../common/http/list-query';
import { ParseIdPipe } from '../common/http/parse-id.pipe';
import {
  OrderListDto,
  OrderStatusFilterQueryDto,
} from '../orders/dto/order.dto';
import {
  SettlementEntryDto,
  SettlementEntryPageDto,
  SettlementSortQueryDto,
} from '../settlements/dto/settlement.dto';
import {
  ManualMatchDto,
  ManualUnmatchDto,
  ReconciliationOverviewDto,
  RunListDto,
  RunSummaryDto,
} from './dto/reconciliation.dto';
import { ReconciliationService } from './reconciliation.service';

const MEMBER_FORBIDDEN_DOC = {
  type: ErrorResponseDto,
  description: 'CSRF check failed',
};
const OWNER_FORBIDDEN_DOC = {
  type: ErrorResponseDto,
  description: 'Caller is a member but not the owner, or CSRF check failed',
};
const MATCH_NOT_FOUND_DOC = {
  type: ErrorResponseDto,
  description:
    'No such account / the caller is not a member, or the entry (or order) is not in this account',
};

@ApiTags('reconciliation')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid session',
})
@Controller('accounts/:accountId/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get()
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary:
      'Counts and as-reported sums of matched / unmatched / account-level entries, orders with and without settlement, last run (members)',
  })
  @ApiOkResponse({ type: ReconciliationOverviewDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', ParseIdPipe) accountId: string,
  ): Promise<ReconciliationOverviewDto> {
    return this.reconciliation.overview(user.id, accountId);
  }

  @Get('unmatched-settlements')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary:
      'Entries with a sub order no that match no order (not superseded; account-level entries never appear) (members)',
  })
  @ApiOkResponse({ type: SettlementEntryPageDto })
  @ApiBadRequestResponse(LIST_BAD_REQUEST_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  unmatchedSettlements(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Query() query: SettlementSortQueryDto,
  ): Promise<SettlementEntryPageDto> {
    return this.reconciliation.unmatchedSettlements(user.id, accountId, query);
  }

  @Get('orders-without-settlement')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary:
      'Orders with no matched, non-superseded settlement entry, filterable by raw status (members)',
  })
  @ApiOkResponse({ type: OrderListDto })
  @ApiBadRequestResponse(LIST_BAD_REQUEST_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  ordersWithoutSettlement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Query() query: OrderStatusFilterQueryDto,
  ): Promise<OrderListDto> {
    return this.reconciliation.ordersWithoutSettlement(
      user.id,
      accountId,
      query,
    );
  }

  @Get('runs')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({ summary: 'Matching runs, newest first (members)' })
  @ApiOkResponse({ type: RunListDto })
  @ApiBadRequestResponse(LIST_BAD_REQUEST_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  runs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Query() query: ListPageQueryDto,
  ): Promise<RunListDto> {
    return this.reconciliation.runs(user.id, accountId, query);
  }

  @Post('runs')
  @ApiSecurity('xsrf')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary:
      'Run automatic matching now (members): matches entries to orders by sub order no and records the counts',
  })
  @ApiCreatedResponse({ type: RunSummaryDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiForbiddenResponse(MEMBER_FORBIDDEN_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The account is disabled',
  })
  runNow(
    @CurrentActor() actor: Actor,
    @Param('accountId', ParseIdPipe) accountId: string,
  ): Promise<RunSummaryDto> {
    return this.reconciliation.runNow(actor, accountId);
  }

  @Post('manual-match')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('xsrf')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary:
      'Match a settlement entry to an order by hand (owner); clears the auto-match block. Same order again = no change.',
  })
  @ApiOkResponse({ type: SettlementEntryDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse(OWNER_FORBIDDEN_DOC)
  @ApiNotFoundResponse(MATCH_NOT_FOUND_DOC)
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'Entry superseded, entry has no sub order no (account-level), or the account is disabled',
  })
  manualMatch(
    @CurrentActor() actor: Actor,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Body() body: ManualMatchDto,
  ): Promise<SettlementEntryDto> {
    return this.reconciliation.manualMatch(actor, accountId, body);
  }

  @Post('manual-unmatch')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('xsrf')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary:
      'Remove a match (owner); automatic matching then skips the entry until it is matched by hand',
  })
  @ApiOkResponse({ type: SettlementEntryDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse(OWNER_FORBIDDEN_DOC)
  @ApiNotFoundResponse(MATCH_NOT_FOUND_DOC)
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'Entry not matched, entry superseded, or the account is disabled',
  })
  manualUnmatch(
    @CurrentActor() actor: Actor,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Body() body: ManualUnmatchDto,
  ): Promise<SettlementEntryDto> {
    return this.reconciliation.manualUnmatch(actor, accountId, body);
  }
}
