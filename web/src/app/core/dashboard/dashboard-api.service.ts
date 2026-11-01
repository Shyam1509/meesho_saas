import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';

import { API_BASE_URL } from '../api/api-base-url';
import { toApiError } from '../api/api-error';
import { toHttpParams } from '../api/query-params';
import { Dashboard, DashboardQuery } from './dashboard.models';

/**
 * Dashboard endpoints (any member of the workspace). Every failure is an `ApiError`: 400 for a bad
 * date, a range over 731 days, `to` before `from`, or a bad basis / granularity; 404 for an account
 * or workspace the caller cannot see.
 */
@Injectable({ providedIn: 'root' })
export class DashboardApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** `GET /accounts/:accountId/dashboard?from&to&basis&status…&granularity`. */
  forAccount(accountId: string, query: DashboardQuery = {}): Observable<Dashboard> {
    return this.get(`${this.baseUrl}/accounts/${encodeURIComponent(accountId)}/dashboard`, query);
  }

  /**
   * `GET /workspaces/:workspaceId/dashboard?…`: every seller account of the workspace (with an
   * `accounts` row each) plus the workspace-wide expenses.
   */
  forWorkspace(workspaceId: string, query: DashboardQuery = {}): Observable<Dashboard> {
    return this.get(
      `${this.baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/dashboard`,
      query,
    );
  }

  private get(url: string, query: DashboardQuery): Observable<Dashboard> {
    const params = toHttpParams({
      from: query.from,
      to: query.to,
      basis: query.basis,
      status: query.status,
      granularity: query.granularity,
    });
    return this.http
      .get<Dashboard>(url, { params })
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }
}
