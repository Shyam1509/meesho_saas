import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';

import { API_BASE_URL } from '../api/api-base-url';
import { toApiError } from '../api/api-error';
import { PagedResponse } from '../api/paged-response';
import { toHttpParams } from '../api/query-params';
import {
  CostEntry,
  CreateCostEntryRequest,
  CreateProductRequest,
  ProductDetail,
  ProductListQuery,
  ProductSummary,
  ProductSyncResult,
  UpdateProductRequest,
} from './product.models';

/**
 * Product and unit-cost endpoints. Reads and product changes: any member; cost rows: owners only.
 * Every failure is an `ApiError`: 400 for a malformed id or invalid value; 403 for a member adding
 * or deleting a cost; 404 for a product or account the caller cannot see; 409 for a SKU that
 * already has a product, or a second cost on the same effective date.
 */
@Injectable({ providedIn: 'root' })
export class ProductsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** `GET /accounts/:accountId/products?page&pageSize&sort&q&status&cost`. */
  list(accountId: string, query: ProductListQuery = {}): Observable<PagedResponse<ProductSummary>> {
    const params = toHttpParams({
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      q: query.q,
      status: query.status,
      cost: query.cost,
    });
    return this.http
      .get<PagedResponse<ProductSummary>>(this.accountProductsUrl(accountId), { params })
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `POST /accounts/:accountId/products`: a product for a SKU not seen yet (links its orders). */
  create(accountId: string, body: CreateProductRequest): Observable<ProductDetail> {
    return this.http
      .post<ProductDetail>(this.accountProductsUrl(accountId), body)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `POST /accounts/:accountId/products/sync`: products for every SKU in the orders (idempotent). */
  sync(accountId: string): Observable<ProductSyncResult> {
    return this.http
      .post<ProductSyncResult>(`${this.accountProductsUrl(accountId)}/sync`, {})
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `GET /products/:productId`: with its cost history, newest first. */
  get(productId: string): Observable<ProductDetail> {
    return this.http
      .get<ProductDetail>(this.productUrl(productId))
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `PATCH /products/:productId`: rename (`name: null` clears it), archive or restore. */
  update(productId: string, body: UpdateProductRequest): Observable<ProductDetail> {
    return this.http
      .patch<ProductDetail>(this.productUrl(productId), body)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `POST /products/:productId/cost-history` (owner). */
  addCost(productId: string, body: CreateCostEntryRequest): Observable<CostEntry> {
    return this.http
      .post<CostEntry>(`${this.productUrl(productId)}/cost-history`, body)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `DELETE /products/:productId/cost-history/:costId` (owner). Answers 204. */
  deleteCost(productId: string, costId: string): Observable<void> {
    return this.http
      .delete<unknown>(
        `${this.productUrl(productId)}/cost-history/${encodeURIComponent(costId)}`,
      )
      .pipe(
        map(() => undefined),
        catchError((error: unknown) => throwError(() => toApiError(error))),
      );
  }

  private accountProductsUrl(accountId: string): string {
    return `${this.baseUrl}/accounts/${encodeURIComponent(accountId)}/products`;
  }

  private productUrl(productId: string): string {
    return `${this.baseUrl}/products/${encodeURIComponent(productId)}`;
  }
}
