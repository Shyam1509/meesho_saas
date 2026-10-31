import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';

import { API_BASE_URL } from '../api/api-base-url';
import { toApiError } from '../api/api-error';
import { PagedResponse } from '../api/paged-response';
import { toHttpParams } from '../api/query-params';
import { ListResponse } from '../workspaces/workspace.models';
import {
  OrderDetail,
  OrderListQuery,
  OrderStatusCount,
  OrderSummary,
  StatusEvent,
} from './order.models';

/**
 * Order endpoints (any member of the account's workspace). Every failure is an `ApiError`: 400 for
 * a malformed id or an invalid filter / sort / page value; 404 for an account or order the caller
 * cannot see, including an order id that belongs to another account.
 */
@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /**
   * `GET /accounts/:accountId/orders?page&pageSize&sort&status…&from&to&q&settlement`. Only the
   * given values are sent; each status is its own `status` parameter.
   */
  list(accountId: string, query: OrderListQuery = {}): Observable<PagedResponse<OrderSummary>> {
    const params = toHttpParams({
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      status: query.status,
      from: query.from,
      to: query.to,
      q: query.q,
      settlement: query.settlement,
    });
    return this.http
      .get<PagedResponse<OrderSummary>>(this.ordersUrl(accountId), { params })
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `GET /accounts/:accountId/orders/statuses`: the raw statuses in use, most common first. */
  statuses(accountId: string): Observable<ListResponse<OrderStatusCount>> {
    return this.http
      .get<ListResponse<OrderStatusCount>>(`${this.ordersUrl(accountId)}/statuses`)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `GET /accounts/:accountId/orders/:orderId`: with status history and matched settlements. */
  get(accountId: string, orderId: string): Observable<OrderDetail> {
    return this.http
      .get<OrderDetail>(this.orderUrl(accountId, orderId))
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `GET /accounts/:accountId/orders/:orderId/status-history`: oldest first. */
  statusHistory(accountId: string, orderId: string): Observable<ListResponse<StatusEvent>> {
    return this.http
      .get<ListResponse<StatusEvent>>(`${this.orderUrl(accountId, orderId)}/status-history`)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  private ordersUrl(accountId: string): string {
    return `${this.baseUrl}/accounts/${encodeURIComponent(accountId)}/orders`;
  }

  private orderUrl(accountId: string, orderId: string): string {
    return `${this.ordersUrl(accountId)}/${encodeURIComponent(orderId)}`;
  }
}
