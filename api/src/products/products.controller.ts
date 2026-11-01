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
  AddCostDto,
  CostEntryDto,
  CreateProductDto,
  ListProductsQueryDto,
  ProductDetailDto,
  ProductListDto,
  ProductSyncResultDto,
  UpdateProductDto,
} from './dto/product.dto';
import { ProductsService } from './products.service';

const PRODUCT_ID_PARAM = {
  name: 'productId',
  description: 'Product id (positive integer, as a string)',
  example: '7',
};
const COST_ID_PARAM = {
  name: 'costId',
  description: 'Cost history entry id of this product',
  example: '15',
};
const PRODUCT_NOT_FOUND_DOC = {
  type: ErrorResponseDto,
  description:
    'No such product, or the caller is not a member of its workspace',
};
const MEMBER_FORBIDDEN_DOC = {
  type: ErrorResponseDto,
  description: 'CSRF check failed',
};
const OWNER_FORBIDDEN_DOC = {
  type: ErrorResponseDto,
  description: 'Caller is a member but not the owner, or CSRF check failed',
};
const DISABLED_OR_BUSY =
  'the account is disabled, or an import holds the account (retry)';

@ApiTags('products')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid session',
})
@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('accounts/:accountId/products')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary:
      "An account's products with order counts and the cost effective today: filters, search, sort, pagination (members)",
  })
  @ApiOkResponse({ type: ProductListDto })
  @ApiBadRequestResponse(LIST_BAD_REQUEST_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Query() query: ListProductsQueryDto,
  ): Promise<ProductListDto> {
    return this.products.list(user.id, accountId, query);
  }

  @Post('accounts/:accountId/products')
  @ApiSecurity('xsrf')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary:
      "Add a product for a SKU (members); links the account's existing orders with that SKU",
  })
  @ApiCreatedResponse({ type: ProductDetailDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse(MEMBER_FORBIDDEN_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: `The SKU already has a product (details name sku), or ${DISABLED_OR_BUSY}`,
  })
  create(
    @CurrentActor() actor: Actor,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Body() body: CreateProductDto,
  ): Promise<ProductDetailDto> {
    return this.products.create(actor, accountId, body);
  }

  @Post('accounts/:accountId/products/sync')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('xsrf')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({
    summary:
      'Create products for SKUs that have none and re-link every order by SKU (members; idempotent: for data imported before products existed)',
  })
  @ApiOkResponse({ type: ProductSyncResultDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiForbiddenResponse(MEMBER_FORBIDDEN_DOC)
  @ApiNotFoundResponse(ACCOUNT_NOT_FOUND_DOC)
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: `409 when ${DISABLED_OR_BUSY}`,
  })
  sync(
    @CurrentActor() actor: Actor,
    @Param('accountId', ParseIdPipe) accountId: string,
  ): Promise<ProductSyncResultDto> {
    return this.products.sync(actor, accountId);
  }

  @Get('products/:productId')
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiOperation({
    summary: 'One product with its cost history, newest first (members)',
  })
  @ApiOkResponse({ type: ProductDetailDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiNotFoundResponse(PRODUCT_NOT_FOUND_DOC)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseIdPipe) productId: string,
  ): Promise<ProductDetailDto> {
    return this.products.detail(user.id, productId);
  }

  @Patch('products/:productId')
  @ApiSecurity('xsrf')
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiOperation({
    summary:
      'Rename, archive or restore a product (members). The SKU never changes',
  })
  @ApiOkResponse({ type: ProductDetailDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse(MEMBER_FORBIDDEN_DOC)
  @ApiNotFoundResponse(PRODUCT_NOT_FOUND_DOC)
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: `409 when ${DISABLED_OR_BUSY}`,
  })
  update(
    @CurrentActor() actor: Actor,
    @Param('productId', ParseIdPipe) productId: string,
    @Body() body: UpdateProductDto,
  ): Promise<ProductDetailDto> {
    return this.products.update(actor, productId, body);
  }

  @Post('products/:productId/cost-history')
  @ApiSecurity('xsrf')
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiOperation({
    summary:
      'Add a unit cost from a date (owner). It applies to orders dated on/after effectiveFrom until the next cost starts',
  })
  @ApiCreatedResponse({ type: CostEntryDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse(OWNER_FORBIDDEN_DOC)
  @ApiNotFoundResponse(PRODUCT_NOT_FOUND_DOC)
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: `A cost already starts on that date (details name effectiveFrom), or ${DISABLED_OR_BUSY}`,
  })
  addCost(
    @CurrentActor() actor: Actor,
    @Param('productId', ParseIdPipe) productId: string,
    @Body() body: AddCostDto,
  ): Promise<CostEntryDto> {
    return this.products.addCost(actor, productId, body);
  }

  @Delete('products/:productId/cost-history/:costId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiSecurity('xsrf')
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiParam(COST_ID_PARAM)
  @ApiOperation({ summary: 'Delete a cost entry to correct a mistake (owner)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiForbiddenResponse(OWNER_FORBIDDEN_DOC)
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'No such product / not a member, or the cost entry is not one of this product',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: `409 when ${DISABLED_OR_BUSY}`,
  })
  async deleteCost(
    @CurrentActor() actor: Actor,
    @Param('productId', ParseIdPipe) productId: string,
    @Param('costId', ParseIdPipe) costId: string,
  ): Promise<void> {
    await this.products.deleteCost(actor, productId, costId);
  }
}
