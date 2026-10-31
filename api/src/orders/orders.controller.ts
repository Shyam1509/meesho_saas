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
  ListOrdersQueryDto,
  OrderDetailDto,
  OrderListDto,
  OrderStatusListDto,
  StatusEventListDto,
} from './dto/order.dto';
import { OrdersService } from './orders.service';

const ORDER_ID_PARAM = {
  name: 'orderId',
  description: 'Order id (positive integer, as a string)',
  example: '41',
};
const ORDER_NOT_FOUND_DOC = {
  type: ErrorResponseDto,
  description:
    'No such account / the caller is not a member, or the order is not in this account',
};

@ApiTags('orders')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid session',
})
@Controller('accounts/:accountId/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary:
      "An account's orders: filters, search, sort, pagination (members). Settlement amounts as reported.",
  })
  @ApiOkResponse({ type: OrderListDto })
  @ApiBadRequestResponse(LIST_BAD_REQUEST_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Query() query: ListOrdersQueryDto,
  ): Promise<OrderListDto> {
    return this.orders.list(user.id, accountId, query);
  }

  // Declared before :orderId so "statuses" is never read as an id.
  @Get('statuses')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary:
      'Raw current statuses of the account with order counts, most orders first (members)',
  })
  @ApiOkResponse({ type: OrderStatusListDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  statuses(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', ParseIdPipe) accountId: string,
  ): Promise<OrderStatusListDto> {
    return this.orders.statuses(user.id, accountId);
  }

  @Get(':orderId')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiParam(ORDER_ID_PARAM)
  @ApiOperation({
    summary:
      'One order with its status history and matched settlement entries (members)',
  })
  @ApiOkResponse({ type: OrderDetailDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiNotFoundResponse(ORDER_NOT_FOUND_DOC)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Param('orderId', ParseIdPipe) orderId: string,
  ): Promise<OrderDetailDto> {
    return this.orders.detail(user.id, accountId, orderId);
  }

  @Get(':orderId/status-history')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiParam(ORDER_ID_PARAM)
  @ApiOperation({
    summary: "An order's status observations, oldest first (members)",
  })
  @ApiOkResponse({ type: StatusEventListDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiNotFoundResponse(ORDER_NOT_FOUND_DOC)
  statusHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Param('orderId', ParseIdPipe) orderId: string,
  ): Promise<StatusEventListDto> {
    return this.orders.statusHistory(user.id, accountId, orderId);
  }
}
