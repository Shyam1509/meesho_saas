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
  LIST_BAD_REQUEST_DOC,
} from '../common/http/account-docs';
import { ParseIdPipe } from '../common/http/parse-id.pipe';
import {
  ListSettlementsQueryDto,
  SettlementListDto,
} from './dto/settlement.dto';
import { SettlementsService } from './settlements.service';

@ApiTags('settlements')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid session',
})
@Controller('accounts/:accountId/settlements')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get()
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary:
      "An account's settlement entries with as-reported totals over all filtered rows (members)",
  })
  @ApiOkResponse({ type: SettlementListDto })
  @ApiBadRequestResponse(LIST_BAD_REQUEST_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Query() query: ListSettlementsQueryDto,
  ): Promise<SettlementListDto> {
    return this.settlements.list(user.id, accountId, query);
  }
}
