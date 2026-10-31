import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';

import { API_BASE_URL } from '../api/api-base-url';
import { toApiError } from '../api/api-error';
import { toHttpParams } from '../api/query-params';
import { SettlementListQuery, SettlementListResponse } from './settlement.models';

/**
 * Settlement ledger endpoints (any member of the account's workspace). Every failure is an
 * `ApiError`: 400 for an invalid filter / sort / page value; 404 for an account the caller cannot
 * see.
 */
@Injectable({ providedIn: 'root' })
export class SettlementsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /**
   * `GET /accounts/:accountId/settlements?page&pageSize&sort&entryType…&from&to&q&match&includeSuperseded`.
   * Only the given values are sent; each entry type is its own `entryType` parameter and
   * `includeSuperseded` is sent only when true. `totals` cover every filtered row, not the page.
   */
  list(accountId: string, query: SettlementListQuery = {}): Observable<SettlementListResponse> {
    const params = toHttpParams({
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      entryType: query.entryType,
      from: query.from,
      to: query.to,
      q: query.q,
      match: query.match,
      includeSuperseded: query.includeSuperseded === true ? 'true' : undefined,
    });
    return this.http
      .get<SettlementListResponse>(
        `${this.baseUrl}/accounts/${encodeURIComponent(accountId)}/settlements`,
        { params },
      )
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }
}
