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
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import { ParseIdPipe } from '../common/http/parse-id.pipe';
import {
  CreateExpenseDto,
  ExpenseCategoryListDto,
  ExpenseDto,
  ExpenseListDto,
  ListExpensesQueryDto,
  ListWorkspaceExpensesQueryDto,
  UpdateExpenseDto,
} from './dto/expense.dto';
import { DOUBLE_COUNTING_NOTE } from './expense-categories';
import { ExpensesService } from './expenses.service';

const WORKSPACE_ID_PARAM = {
  name: 'workspaceId',
  description: 'Workspace id (positive integer, as a string)',
  example: '1',
};
const EXPENSE_ID_PARAM = {
  name: 'expenseId',
  description: 'Expense id (positive integer, as a string)',
  example: '31',
};
const WORKSPACE_NOT_FOUND_DOC = {
  type: ErrorResponseDto,
  description: 'No such workspace, or the caller is not a member',
};
const EXPENSE_NOT_FOUND_DOC = {
  type: ErrorResponseDto,
  description:
    'No such expense, or the caller is not a member of its workspace',
};
const OWNER_FORBIDDEN_DOC = {
  type: ErrorResponseDto,
  description: 'Caller is a member but not the owner, or CSRF check failed',
};
const DISABLED_DOC = {
  type: ErrorResponseDto,
  description: "The expense's seller account is disabled",
};
const BODY_BAD_REQUEST_DOC = {
  type: ErrorResponseDto,
  description:
    'Invalid field: date in the future, amount not > 0 / more than 2 decimals, unknown category, "other" without a description, or an unknown field (such as scope)',
};

@ApiTags('expenses')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid session',
})
@Controller()
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('expenses/categories')
  @ApiOperation({
    summary: 'Expense categories with labels and help (signed in)',
    description: DOUBLE_COUNTING_NOTE,
  })
  @ApiOkResponse({ type: ExpenseCategoryListDto })
  categories(): ExpenseCategoryListDto {
    return this.expenses.categories();
  }

  @Get('accounts/:accountId/expenses')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary:
      "A seller account's expenses with the DECIMAL total of all filtered rows (members)",
  })
  @ApiOkResponse({ type: ExpenseListDto })
  @ApiBadRequestResponse(LIST_BAD_REQUEST_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  listForAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Query() query: ListExpensesQueryDto,
  ): Promise<ExpenseListDto> {
    return this.expenses.listForAccount(user.id, accountId, query);
  }

  @Post('accounts/:accountId/expenses')
  @ApiSecurity('xsrf')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary: 'Add an expense of one seller account (owner)',
    description: DOUBLE_COUNTING_NOTE,
  })
  @ApiCreatedResponse({ type: ExpenseDto })
  @ApiBadRequestResponse(BODY_BAD_REQUEST_DOC)
  @ApiForbiddenResponse(OWNER_FORBIDDEN_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  @ApiConflictResponse(DISABLED_DOC)
  createForAccount(
    @CurrentActor() actor: Actor,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Body() body: CreateExpenseDto,
  ): Promise<ExpenseDto> {
    return this.expenses.createForAccount(actor, accountId, body);
  }

  @Get('workspaces/:workspaceId/expenses')
  @ApiParam(WORKSPACE_ID_PARAM)
  @ApiOperation({
    summary:
      "A workspace's expenses (workspace-wide only by default; scope=all adds every account's) with the DECIMAL total (members)",
  })
  @ApiOkResponse({ type: ExpenseListDto })
  @ApiBadRequestResponse(LIST_BAD_REQUEST_DOC)
  @ApiNotFoundResponse(WORKSPACE_NOT_FOUND_DOC)
  listForWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseIdPipe) workspaceId: string,
    @Query() query: ListWorkspaceExpensesQueryDto,
  ): Promise<ExpenseListDto> {
    return this.expenses.listForWorkspace(user.id, workspaceId, query);
  }

  @Post('workspaces/:workspaceId/expenses')
  @ApiSecurity('xsrf')
  @ApiParam(WORKSPACE_ID_PARAM)
  @ApiOperation({
    summary: 'Add a workspace-wide expense (owner)',
    description: DOUBLE_COUNTING_NOTE,
  })
  @ApiCreatedResponse({ type: ExpenseDto })
  @ApiBadRequestResponse(BODY_BAD_REQUEST_DOC)
  @ApiForbiddenResponse(OWNER_FORBIDDEN_DOC)
  @ApiNotFoundResponse(WORKSPACE_NOT_FOUND_DOC)
  createForWorkspace(
    @CurrentActor() actor: Actor,
    @Param('workspaceId', ParseIdPipe) workspaceId: string,
    @Body() body: CreateExpenseDto,
  ): Promise<ExpenseDto> {
    return this.expenses.createForWorkspace(actor, workspaceId, body);
  }

  @Patch('expenses/:expenseId')
  @ApiSecurity('xsrf')
  @ApiParam(EXPENSE_ID_PARAM)
  @ApiOperation({
    summary:
      'Edit an expense (owner): date, category, description, amount. The scope never changes',
  })
  @ApiOkResponse({ type: ExpenseDto })
  @ApiBadRequestResponse(BODY_BAD_REQUEST_DOC)
  @ApiForbiddenResponse(OWNER_FORBIDDEN_DOC)
  @ApiNotFoundResponse(EXPENSE_NOT_FOUND_DOC)
  @ApiConflictResponse(DISABLED_DOC)
  update(
    @CurrentActor() actor: Actor,
    @Param('expenseId', ParseIdPipe) expenseId: string,
    @Body() body: UpdateExpenseDto,
  ): Promise<ExpenseDto> {
    return this.expenses.update(actor, expenseId, body);
  }

  @Delete('expenses/:expenseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiSecurity('xsrf')
  @ApiParam(EXPENSE_ID_PARAM)
  @ApiOperation({ summary: 'Delete an expense (owner)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiForbiddenResponse(OWNER_FORBIDDEN_DOC)
  @ApiNotFoundResponse(EXPENSE_NOT_FOUND_DOC)
  @ApiConflictResponse(DISABLED_DOC)
  async remove(
    @CurrentActor() actor: Actor,
    @Param('expenseId', ParseIdPipe) expenseId: string,
  ): Promise<void> {
    await this.expenses.remove(actor, expenseId);
  }
}
