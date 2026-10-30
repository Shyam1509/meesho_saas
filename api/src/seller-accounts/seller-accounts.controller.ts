import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
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
import { ParseIdPipe } from '../common/http/parse-id.pipe';
import {
  CreateSellerAccountDto,
  SellerAccountDto,
  SellerAccountListDto,
  UpdateSellerAccountDto,
} from './dto/seller-account.dto';
import { SellerAccountsService } from './seller-accounts.service';

const WORKSPACE_ID_PARAM = {
  name: 'workspaceId',
  description: 'Workspace id (positive integer, as a string)',
  example: '1',
};
const ACCOUNT_ID_PARAM = {
  name: 'accountId',
  description: 'Seller account id (positive integer, as a string)',
  example: '1',
};
const NOT_FOUND_DOC = {
  type: ErrorResponseDto,
  description:
    'No such workspace/account, or the caller is not a member of its workspace',
};
const OWNER_FORBIDDEN_DOC = {
  type: ErrorResponseDto,
  description: 'Caller is a member but not the owner, or CSRF check failed',
};
const CONFLICT_DOC = {
  type: ErrorResponseDto,
  description:
    'displayName or meeshoSupplierId already used in the workspace (details name the field)',
};

@ApiTags('seller-accounts')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid session',
})
@Controller()
export class SellerAccountsController {
  constructor(private readonly accounts: SellerAccountsService) {}

  @Get('workspaces/:workspaceId/accounts')
  @ApiParam(WORKSPACE_ID_PARAM)
  @ApiOperation({
    summary: "A workspace's seller accounts, all statuses (members)",
  })
  @ApiOkResponse({ type: SellerAccountListDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseIdPipe) workspaceId: string,
  ): Promise<SellerAccountListDto> {
    return { items: await this.accounts.list(user.id, workspaceId) };
  }

  @Post('workspaces/:workspaceId/accounts')
  @ApiSecurity('xsrf')
  @ApiParam(WORKSPACE_ID_PARAM)
  @ApiOperation({ summary: 'Add a seller account to a workspace (owner)' })
  @ApiCreatedResponse({ type: SellerAccountDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse(OWNER_FORBIDDEN_DOC)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse(CONFLICT_DOC)
  create(
    @CurrentActor() actor: Actor,
    @Param('workspaceId', ParseIdPipe) workspaceId: string,
    @Body() body: CreateSellerAccountDto,
  ): Promise<SellerAccountDto> {
    return this.accounts.create(actor, workspaceId, body);
  }

  @Get('accounts/:accountId')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({ summary: 'One seller account (members of its workspace)' })
  @ApiOkResponse({ type: SellerAccountDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', ParseIdPipe) accountId: string,
  ): Promise<SellerAccountDto> {
    return this.accounts.get(user.id, accountId);
  }

  @Patch('accounts/:accountId')
  @ApiSecurity('xsrf')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary: 'Edit, disable or re-enable a seller account (owner)',
  })
  @ApiOkResponse({ type: SellerAccountDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse(OWNER_FORBIDDEN_DOC)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse(CONFLICT_DOC)
  update(
    @CurrentActor() actor: Actor,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Body() body: UpdateSellerAccountDto,
  ): Promise<SellerAccountDto> {
    return this.accounts.update(actor, accountId, body);
  }

  @Delete('accounts/:accountId')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('xsrf')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary: 'Disable a seller account (owner; idempotent, never deletes data)',
  })
  @ApiOkResponse({
    type: SellerAccountDto,
    description: 'The account, now with status "disabled"',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiForbiddenResponse(OWNER_FORBIDDEN_DOC)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  disable(
    @CurrentActor() actor: Actor,
    @Param('accountId', ParseIdPipe) accountId: string,
  ): Promise<SellerAccountDto> {
    return this.accounts.disable(actor, accountId);
  }
}
