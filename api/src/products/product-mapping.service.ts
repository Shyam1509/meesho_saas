import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { AccountScope } from '../common/sql/account-scope';
import { utcDatetime } from '../common/sql/datetime';
import { toCount } from '../common/sql/values';

/** What a mapping pass changed. */
export interface MappingResult {
  /** Products created for SKUs that had none. */
  createdProducts: number;
  /** Orders whose product_id was set or corrected (already-correct orders are not touched or counted). */
  linkedOrders: number;
}

/** Restricts a pass to the orders observed by one import (a status event of that job), or none. */
const JOB_ORDERS_JOIN = `JOIN order_status_events je
         ON je.seller_account_id = o.seller_account_id AND je.order_id = o.id
        AND je.import_job_id = :importJobId`;

/**
 * One product per SKU of the selected orders that has none in the account. Name and catalog id come from
 * one of those orders: the latest order date (then highest id) among those with a product name. Products
 * are inserted in SKU order so their ids are deterministic. Never touches an existing product, so a name a
 * user edited is never overwritten. `products` in the SELECT is in its FROM clause (allowed by MySQL: the
 * rows are materialised before the insert).
 */
export function createMissingProductsSql(jobOrdersOnly: boolean): string {
  return `INSERT INTO products
         (workspace_id, seller_account_id, sku, catalog_id, name, status, created_at, updated_at)
       SELECT :workspaceId, :sellerAccountId, src.sku, src.catalogId, src.name, 'active', :now, :now
       FROM (
         SELECT o.sku, o.catalog_id AS catalogId, o.product_name AS name,
                ROW_NUMBER() OVER (PARTITION BY o.sku
                                   ORDER BY o.product_name IS NULL, o.order_date DESC, o.id DESC) AS pick
         FROM orders o
         ${jobOrdersOnly ? JOB_ORDERS_JOIN : ''}
         LEFT JOIN products ep ON ep.seller_account_id = o.seller_account_id AND ep.sku = o.sku
         WHERE o.seller_account_id = :sellerAccountId AND o.workspace_id = :workspaceId
           AND o.sku IS NOT NULL AND ep.id IS NULL
       ) src
       WHERE src.pick = 1
       ORDER BY src.sku`;
}

/**
 * The mapping rule: orders.product_id = the product with the same SKU in the account (exact, both columns
 * utf8mb4_bin), or NULL when the order has no SKU or the SKU has no product. Only rows that differ are
 * written (`<=>` is NULL-safe), so a second pass changes nothing and reports 0.
 */
export function relinkOrdersSql(jobOrdersOnly: boolean): string {
  return `UPDATE orders o
         ${jobOrdersOnly ? JOB_ORDERS_JOIN : ''}
         LEFT JOIN products p ON p.seller_account_id = o.seller_account_id AND p.sku = o.sku
       SET o.product_id = p.id, o.updated_at = :now
       WHERE o.seller_account_id = :sellerAccountId AND o.workspace_id = :workspaceId
         AND NOT (o.product_id <=> p.id)`;
}

/** The distinct non-NULL SKUs of the orders one import observed. */
export const JOB_SKUS_SQL = `SELECT DISTINCT o.sku
       FROM orders o
       ${JOB_ORDERS_JOIN}
       WHERE o.seller_account_id = :sellerAccountId AND o.workspace_id = :workspaceId
         AND o.sku IS NOT NULL`;

/**
 * The same rule for EVERY order of the account carrying one of `:skus` (in or out of the job): orders
 * imported earlier (before M6, or by a job that predates the product) get the product this import created.
 * Uses ix_orders_account_sku.
 */
export const RELINK_SKUS_SQL = `UPDATE orders o
         LEFT JOIN products p ON p.seller_account_id = o.seller_account_id AND p.sku = o.sku
       SET o.product_id = p.id, o.updated_at = :now
       WHERE o.seller_account_id = :sellerAccountId AND o.workspace_id = :workspaceId
         AND o.sku IN (:skus) AND NOT (o.product_id <=> p.id)`;

/** SKUs per RELINK_SKUS_SQL statement. */
const SKU_BATCH = 500;

/** Links the orders carrying exactly this SKU to the (new) product. */
export const LINK_SKU_SQL = `UPDATE orders o
       SET o.product_id = :productId, o.updated_at = :now
       WHERE o.seller_account_id = :sellerAccountId AND o.workspace_id = :workspaceId
         AND o.sku = :sku AND NOT (o.product_id <=> :productId)`;

/**
 * Product ↔ order mapping (Milestone 6). Every method runs inside the CALLER's transaction, which must
 * already hold the seller account row lock (import confirm, products sync / create): every writer of an
 * account's orders and products is serialised by that lock, so two passes never race.
 */
@Injectable()
export class ProductMappingService {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  /**
   * Import confirm (orders CSV), after the order upserts: creates the missing products for the SKUs of the
   * job's orders, re-links those orders by SKU (an order whose SKU changed in a newer report moves to the
   * right product), then re-links every other order of the account carrying one of those SKUs.
   */
  mapImportedOrders(
    scope: AccountScope,
    importJobId: number,
    transaction: Transaction,
  ): Promise<MappingResult> {
    return this.pass(scope, importJobId, transaction);
  }

  /** The whole account (data imported before M6): same rule, idempotent. */
  syncAccount(
    scope: AccountScope,
    transaction: Transaction,
  ): Promise<MappingResult> {
    return this.pass(scope, null, transaction);
  }

  /** A product created by hand: links the account's orders with exactly its SKU. Returns how many. */
  async linkSku(
    scope: AccountScope,
    productId: number,
    sku: string,
    transaction: Transaction,
  ): Promise<number> {
    const [, affected] = await this.sequelize.query(LINK_SKU_SQL, {
      type: QueryTypes.UPDATE,
      replacements: {
        ...scope,
        productId,
        sku,
        now: utcDatetime(new Date()),
      },
      transaction,
    });
    return toCount(affected);
  }

  private async pass(
    scope: AccountScope,
    importJobId: number | null,
    transaction: Transaction,
  ): Promise<MappingResult> {
    const jobOnly = importJobId !== null;
    const replacements = {
      ...scope,
      importJobId,
      now: utcDatetime(new Date()),
    };
    const [, created] = await this.sequelize.query(
      createMissingProductsSql(jobOnly),
      { type: QueryTypes.INSERT, replacements, transaction },
    );
    const [, linked] = await this.sequelize.query(relinkOrdersSql(jobOnly), {
      type: QueryTypes.UPDATE,
      replacements,
      transaction,
    });
    let linkedOrders = toCount(linked);
    if (jobOnly) {
      // The job's orders are right now; also every OTHER order of the account with one of the job's SKUs
      // (e.g. imported before M6, when no product existed). Rows fixed above no longer differ: not recounted.
      const skus = (
        await this.sequelize.query<{ sku: string }>(JOB_SKUS_SQL, {
          type: QueryTypes.SELECT,
          replacements,
          transaction,
        })
      ).map((row) => row.sku);
      for (let i = 0; i < skus.length; i += SKU_BATCH) {
        const [, more] = await this.sequelize.query(RELINK_SKUS_SQL, {
          type: QueryTypes.UPDATE,
          replacements: { ...replacements, skus: skus.slice(i, i + SKU_BATCH) },
          transaction,
        });
        linkedOrders += toCount(more);
      }
    }
    return { createdProducts: toCount(created), linkedOrders };
  }
}
