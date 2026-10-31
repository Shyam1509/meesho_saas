import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';

import { API_BASE_URL } from '../api/api-base-url';
import { toApiError } from '../api/api-error';
import { PagedResponse } from '../api/paged-response';
import { toHttpParams } from '../api/query-params';
import { OrderSummary, OrdersWithoutSettlementQuery } from '../orders/order.models';
import { SettlementEntry, UnmatchedSettlementsQuery } from '../settlements/settlement.models';
import {
  ManualMatchRequest,
  ManualUnmatchRequest,
  ReconciliationOverview,
  RunSummary,
  RunsQuery,
} from './reconciliation.models';

/**
 * Reconciliation endpoints. Reads and "run matching now" are open to any member; manual match and
 * unmatch are owner-only (403 for a member). Every failure is an `ApiError`: 400 for an invalid
 * value; 404 for an account, entry or order the caller cannot see (an entry or order of another
 * account included); 409 for a manual match of a superseded entry.
 */
@Injectable({ providedIn: 'root' })
export class ReconciliationApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** `GET /accounts/:accountId/reconciliation`: counts and as-reported sums, plus the last run. */
  overview(accountId: string): Observable<ReconciliationOverview> {
    return this.http
      .get<ReconciliationOverview>(this.url(accountId))
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `GET …/reconciliation/unmatched-settlements?page&pageSize&sort`. */
  unmatchedSettlements(
    accountId: string,
    query: UnmatchedSettlementsQuery = {},
  ): Observable<PagedResponse<SettlementEntry>> {
    const params = toHttpParams({ page: query.page, pageSize: query.pageSize, sort: query.sort });
    return this.http
      .get<PagedResponse<SettlementEntry>>(`${this.url(accountId)}/unmatched-settlements`, {
        params,
      })
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `GET …/reconciliation/orders-without-settlement?page&pageSize&status…&sort`. */
  ordersWithoutSettlement(
    accountId: string,
    query: OrdersWithoutSettlementQuery = {},
  ): Observable<PagedResponse<OrderSummary>> {
    const params = toHttpParams({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      sort: query.sort,
    });
    return this.http
      .get<PagedResponse<OrderSummary>>(`${this.url(accountId)}/orders-without-settlement`, {
        params,
      })
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `GET …/reconciliation/runs?page&pageSize`: newest first. */
  runs(accountId: string, query: RunsQuery = {}): Observable<PagedResponse<RunSummary>> {
    const params = toHttpParams({ page: query.page, pageSize: query.pageSize });
    return this.http
      .get<PagedResponse<RunSummary>>(`${this.url(accountId)}/runs`, { params })
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `POST …/reconciliation/runs` (member+): matches now; 201 with the finished run. */
  run(accountId: string): Observable<RunSummary> {
    return this.http
      .post<RunSummary>(`${this.url(accountId)}/runs`, {})
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `POST …/reconciliation/manual-match` (owner): links the entry to the order. */
  manualMatch(accountId: string, body: ManualMatchRequest): Observable<SettlementEntry> {
    return this.http
      .post<SettlementEntry>(`${this.url(accountId)}/manual-match`, body)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /**
   * `POST …/reconciliation/manual-unmatch` (owner): removes the link; automatic matching then skips
   * the entry until it is matched by hand.
   */
  manualUnmatch(accountId: string, body: ManualUnmatchRequest): Observable<SettlementEntry> {
    return this.http
      .post<SettlementEntry>(`${this.url(accountId)}/manual-unmatch`, body)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  private url(accountId: string): string {
    return `${this.baseUrl}/accounts/${encodeURIComponent(accountId)}/reconciliation`;
  }
}
