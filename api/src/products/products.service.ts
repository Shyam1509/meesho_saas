import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuditService, changedFields } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { inAccountTransaction } from '../authorization/account-transaction';
import {
  PRODUCT_NOT_FOUND_MESSAGE,
  WorkspaceAccessService,
  type AccountAccess,
} from '../authorization/workspace-access.service';
import { FieldConflictException } from '../common/errors/field-conflict.exception';
import { uniqueConflictDetails } from '../common/errors/unique-conflict';
import { listWindow } from '../common/http/list-query';
import { canonicalDecimal, UNIT_COST_RULE } from '../common/http/value-rules';
import { scopeOf, type AccountScope } from '../common/sql/account-scope';
import { readSnapshot } from '../common/sql/read-snapshot';
import { todayInIndia } from '../common/time/india-date';
import {
  Product,
  ProductCostHistory,
  type ProductStatus,
  type WorkspaceRole,
} from '../database/models';
import type {
  AddCostDto,
  CostEntryDto,
  CreateProductDto,
  ListProductsQueryDto,
  ProductDetailDto,
  ProductListDto,
  ProductSyncResultDto,
  UpdateProductDto,
} from './dto/product.dto';
import { ProductMappingService } from './product-mapping.service';
import {
  costHistoryOf,
  findCostEntry,
  findProductSummary,
  pageOfProducts,
  productListFilter,
} from './product-queries';

export const PRODUCTS_ACCOUNT_DISABLED_MESSAGE =
  'This seller account is disabled: enable it before changing its products.';
export const DUPLICATE_SKU_MESSAGE =
  'This seller account already has a product with this SKU.';
export const DUPLICATE_SKU_REASON =
  'A product with this SKU already exists in this seller account.';
export const DUPLICATE_COST_DATE_MESSAGE =
  'This product already has a cost starting on this date.';
export const DUPLICATE_COST_DATE_REASON =
  'A cost starting on this date already exists: delete it first to correct it.';
export const COST_NOT_FOUND_MESSAGE = 'Cost entry not found.';

const SKU_KEY = {
  uq_products_account_sku: { field: 'sku', reason: DUPLICATE_SKU_REASON },
} as const;
const COST_DATE_KEY = {
  uq_product_cost_history_product_effective_from: {
    field: 'effectiveFrom',
    reason: DUPLICATE_COST_DATE_REASON,
  },
} as const;

interface EditableFields {
  name?: string | null;
  status?: ProductStatus;
}

/** Audit payload of a cost row (ids as strings, amounts as stored). */
function costAudit(
  product: Product,
  cost: { effectiveFrom: string; unitCost: string; note: string | null },
): Record<string, unknown> {
  return {
    productId: String(product.id),
    sku: product.sku,
    effectiveFrom: cost.effectiveFrom,
    unitCost: cost.unitCost,
    note: cost.note,
  };
}

/**
 * Products (one per SKU of a seller account) and their effective-dated unit costs (Milestone 6).
 * Reads, create, edit and sync: members; cost rows: owner. Account routes resolve through requireAccount,
 * /products/:id routes through requireProduct (one query each; not a member → 404). Every write runs in
 * inAccountTransaction (account row locked first, as the import confirm does), so it is serialised with
 * imports and with every other product write of the account, and is refused on a disabled account (409).
 */
@Injectable()
export class ProductsService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
    private readonly mapping: ProductMappingService,
  ) {}

  async list(
    userId: number,
    accountId: string,
    query: ListProductsQueryDto,
  ): Promise<ProductListDto> {
    const { account } = await this.access.requireAccount(
      userId,
      accountId,
      'member',
    );
    const scope = scopeOf(account);
    const filter = productListFilter(scope, todayInIndia(), query);
    // Ids, total and summaries from ONE snapshot: they cannot disagree if an import commits meanwhile.
    const { items, total } = await readSnapshot(this.sequelize, (transaction) =>
      pageOfProducts(
        this.sequelize,
        scope,
        filter,
        query.sort,
        listWindow(query),
        transaction,
      ),
    );
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  /**
   * Members. A product for a SKU not seen yet (or seen before products existed): 409 when the account
   * already has that SKU. Links the account's existing orders with exactly that SKU. Audit product.created.
   */
  async create(
    actor: Actor,
    accountId: string,
    dto: CreateProductDto,
  ): Promise<ProductDetailDto> {
    return this.mapUniqueKey(SKU_KEY, DUPLICATE_SKU_MESSAGE, () =>
      this.inAccount(actor, accountId, 'member', async (scope, transaction) => {
        const existing = await Product.findOne({
          attributes: ['id'],
          where: { sellerAccountId: scope.sellerAccountId, sku: dto.sku },
          transaction,
        });
        if (existing) {
          throw new FieldConflictException(DUPLICATE_SKU_MESSAGE, [
            { field: 'sku', reasons: [DUPLICATE_SKU_REASON] },
          ]);
        }
        const product = await Product.create(
          {
            workspaceId: scope.workspaceId,
            sellerAccountId: scope.sellerAccountId,
            sku: dto.sku,
            name: dto.name ?? null,
            catalogId: dto.catalogId ?? null,
          },
          { transaction },
        );
        const linkedOrders = await this.mapping.linkSku(
          scope,
          product.id,
          product.sku,
          transaction,
        );
        await this.audit.record(
          {
            action: 'product.created',
            entityType: 'product',
            entityId: product.id,
            workspaceId: scope.workspaceId,
            sellerAccountId: scope.sellerAccountId,
            actorUserId: actor.userId,
            requestId: actor.requestId,
            after: {
              sku: product.sku,
              name: product.name,
              catalogId: product.catalogId,
              status: product.status,
              linkedOrders,
            },
          },
          transaction,
        );
        return this.detailIn(scope, product.id, transaction);
      }),
    );
  }

  /**
   * Members. For data imported before M6 (idempotent): creates the missing products for every SKU of the
   * account's orders and re-links every order by SKU. Audit products.synced only when something changed.
   */
  async sync(actor: Actor, accountId: string): Promise<ProductSyncResultDto> {
    return this.inAccount(
      actor,
      accountId,
      'member',
      async (scope, transaction) => {
        const result = await this.mapping.syncAccount(scope, transaction);
        if (result.createdProducts > 0 || result.linkedOrders > 0) {
          await this.audit.record(
            {
              action: 'products.synced',
              entityType: 'seller_account',
              entityId: scope.sellerAccountId,
              workspaceId: scope.workspaceId,
              sellerAccountId: scope.sellerAccountId,
              actorUserId: actor.userId,
              requestId: actor.requestId,
              after: { ...result },
            },
            transaction,
          );
        }
        return result;
      },
    );
  }

  async detail(userId: number, productId: string): Promise<ProductDetailDto> {
    const { product } = await this.access.requireProduct(
      userId,
      productId,
      'member',
    );
    const scope = scopeOf({
      id: product.sellerAccountId,
      workspaceId: product.workspaceId,
    });
    return readSnapshot(this.sequelize, (transaction) =>
      this.detailIn(scope, product.id, transaction),
    );
  }

  /** Members. Name and / or status; no change → 200 without a write. Audit product.updated (changed fields). */
  async update(
    actor: Actor,
    productId: string,
    dto: UpdateProductDto,
  ): Promise<ProductDetailDto> {
    return this.inProduct(
      actor,
      productId,
      'member',
      async (product, scope, transaction) => {
        const fields = changedFields<EditableFields>(
          { name: product.name, status: product.status },
          { name: dto.name, status: dto.status },
        );
        if (Object.keys(fields.after).length > 0) {
          await Product.update(fields.after, {
            where: { id: product.id },
            transaction,
          });
          await this.audit.record(
            {
              action: 'product.updated',
              entityType: 'product',
              entityId: product.id,
              workspaceId: scope.workspaceId,
              sellerAccountId: scope.sellerAccountId,
              actorUserId: actor.userId,
              requestId: actor.requestId,
              before: fields.before,
              after: fields.after,
            },
            transaction,
          );
        }
        return this.detailIn(scope, product.id, transaction);
      },
    );
  }

  /** Owner. One cost per start date (same date → 409). Audit product_cost.created. */
  async addCost(
    actor: Actor,
    productId: string,
    dto: AddCostDto,
  ): Promise<CostEntryDto> {
    return this.mapUniqueKey(COST_DATE_KEY, DUPLICATE_COST_DATE_MESSAGE, () =>
      this.inProduct(
        actor,
        productId,
        'owner',
        async (product, scope, transaction) => {
          const taken = await ProductCostHistory.count({
            where: { productId: product.id, effectiveFrom: dto.effectiveFrom },
            transaction,
          });
          if (taken > 0) {
            throw new FieldConflictException(DUPLICATE_COST_DATE_MESSAGE, [
              { field: 'effectiveFrom', reasons: [DUPLICATE_COST_DATE_REASON] },
            ]);
          }
          const values = {
            effectiveFrom: dto.effectiveFrom,
            unitCost: canonicalDecimal(dto.unitCost, UNIT_COST_RULE),
            note: dto.note ?? null,
          };
          const cost = await ProductCostHistory.create(
            {
              productId: product.id,
              ...values,
              createdByUserId: actor.userId,
            },
            { transaction },
          );
          await this.audit.record(
            {
              action: 'product_cost.created',
              entityType: 'product_cost',
              entityId: cost.id,
              workspaceId: scope.workspaceId,
              sellerAccountId: scope.sellerAccountId,
              actorUserId: actor.userId,
              requestId: actor.requestId,
              after: costAudit(product, values),
            },
            transaction,
          );
          const entry = await findCostEntry(
            this.sequelize,
            cost.id,
            transaction,
          );
          if (!entry) throw new Error(`cost entry ${cost.id} vanished`);
          return entry;
        },
      ),
    );
  }

  /** Owner. Deletes a cost row of THIS product (to correct a mistake). Audit product_cost.deleted. */
  async deleteCost(
    actor: Actor,
    productId: string,
    costId: string,
  ): Promise<void> {
    await this.inProduct(
      actor,
      productId,
      'owner',
      async (product, scope, transaction) => {
        const cost = await ProductCostHistory.findOne({
          where: { id: costId, productId: product.id },
          transaction,
        });
        if (!cost) throw new NotFoundException(COST_NOT_FOUND_MESSAGE);
        const before = costAudit(product, cost);
        await cost.destroy({ transaction });
        await this.audit.record(
          {
            action: 'product_cost.deleted',
            entityType: 'product_cost',
            entityId: cost.id,
            workspaceId: scope.workspaceId,
            sellerAccountId: scope.sellerAccountId,
            actorUserId: actor.userId,
            requestId: actor.requestId,
            before,
          },
          transaction,
        );
      },
    );
  }

  /** Summary + cost history, read in the caller's transaction (a snapshot, or the write transaction). */
  private async detailIn(
    scope: AccountScope,
    productId: number,
    transaction: Transaction,
  ): Promise<ProductDetailDto> {
    const summary = await findProductSummary(
      this.sequelize,
      scope,
      productId,
      todayInIndia(),
      transaction,
    );
    if (!summary) throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
    return {
      ...summary,
      costHistory: await costHistoryOf(this.sequelize, productId, transaction),
    };
  }

  /** An account-scoped write: account row locked first; disabled account → 409. */
  private inAccount<T>(
    actor: Actor,
    accountId: string,
    minRole: WorkspaceRole,
    work: (scope: AccountScope, transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    return inAccountTransaction(
      this.sequelize,
      this.access,
      actor,
      accountId,
      minRole,
      PRODUCTS_ACCOUNT_DISABLED_MESSAGE,
      (account: AccountAccess['account'], transaction) =>
        work(scopeOf(account), transaction),
    );
  }

  /**
   * A write on one product: resolve it for the caller (404 / 403), then lock its ACCOUNT row first (the
   * lock order every account writer uses) and re-read the product inside that transaction.
   */
  private async inProduct<T>(
    actor: Actor,
    productId: string,
    minRole: WorkspaceRole,
    work: (
      product: Product,
      scope: AccountScope,
      transaction: Transaction,
    ) => Promise<T>,
  ): Promise<T> {
    const { product: resolved } = await this.access.requireProduct(
      actor.userId,
      productId,
      minRole,
    );
    return this.inAccount(
      actor,
      String(resolved.sellerAccountId),
      minRole,
      async (scope, transaction) => {
        const product = await Product.findOne({
          where: {
            id: resolved.id,
            sellerAccountId: scope.sellerAccountId,
            workspaceId: scope.workspaceId,
          },
          transaction,
        });
        if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
        return work(product, scope, transaction);
      },
    );
  }

  /** A concurrent insert can still hit the unique key after the explicit check: the same 409. */
  private async mapUniqueKey<T>(
    keys: Readonly<Record<string, { field: string; reason: string }>>,
    message: string,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (err) {
      const details = uniqueConflictDetails(err, keys);
      if (details) throw new FieldConflictException(message, details);
      throw err;
    }
  }
}
