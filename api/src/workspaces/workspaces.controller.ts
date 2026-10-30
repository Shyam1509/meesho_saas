import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
  WorkspaceListDto,
  WorkspaceMemberListDto,
  WorkspaceNameDto,
  WorkspaceSummaryDto,
} from './dto/workspace.dto';
import { WorkspacesService } from './workspaces.service';

const WORKSPACE_ID_PARAM = {
  name: 'workspaceId',
  description: 'Workspace id (positive integer, as a string)',
  example: '1',
};

@ApiTags('workspaces')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid session',
})
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: "The caller's workspaces with the caller's role" })
  @ApiOkResponse({ type: WorkspaceListDto })
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceListDto> {
    return { items: await this.workspaces.listForUser(user.id) };
  }

  @Post()
  @ApiSecurity('xsrf')
  @ApiOperation({ summary: 'Create a workspace; the caller becomes its owner' })
  @ApiCreatedResponse({ type: WorkspaceSummaryDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'CSRF check failed',
  })
  create(
    @CurrentActor() actor: Actor,
    @Body() body: WorkspaceNameDto,
  ): Promise<WorkspaceSummaryDto> {
    return this.workspaces.create(actor, body.name);
  }

  @Get(':workspaceId')
  @ApiParam(WORKSPACE_ID_PARAM)
  @ApiOperation({ summary: 'One workspace (members only)' })
  @ApiOkResponse({ type: WorkspaceSummaryDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such workspace, or the caller is not a member',
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseIdPipe) workspaceId: string,
  ): Promise<WorkspaceSummaryDto> {
    return this.workspaces.get(user.id, workspaceId);
  }

  @Patch(':workspaceId')
  @ApiSecurity('xsrf')
  @ApiParam(WORKSPACE_ID_PARAM)
  @ApiOperation({ summary: 'Rename a workspace (owner only)' })
  @ApiOkResponse({ type: WorkspaceSummaryDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Caller is a member but not the owner, or CSRF check failed',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such workspace, or the caller is not a member',
  })
  rename(
    @CurrentActor() actor: Actor,
    @Param('workspaceId', ParseIdPipe) workspaceId: string,
    @Body() body: WorkspaceNameDto,
  ): Promise<WorkspaceSummaryDto> {
    return this.workspaces.rename(actor, workspaceId, body.name);
  }

  @Get(':workspaceId/members')
  @ApiParam(WORKSPACE_ID_PARAM)
  @ApiOperation({ summary: 'Members of a workspace (members only)' })
  @ApiOkResponse({ type: WorkspaceMemberListDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such workspace, or the caller is not a member',
  })
  async members(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseIdPipe) workspaceId: string,
  ): Promise<WorkspaceMemberListDto> {
    return {
      items: await this.workspaces.listMembers(user.id, workspaceId),
    };
  }
}
