import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';

import { API_BASE_URL } from '../api/api-base-url';
import { toApiError } from '../api/api-error';
import { ListResponse } from '../workspaces/workspace.models';
import {
  CreateSellerAccountRequest,
  SellerAccount,
  UpdateSellerAccountRequest,
} from './seller-account.models';

/**
 * Seller-account endpoints. Every failure is an `ApiError`: 404 for a missing account or one in a
 * workspace the caller is not in, 403 for a member doing an owner action, 409 (with field
 * `details`) for a duplicate display name or supplier id within the workspace.
 */
@Injectable({ providedIn: 'root' })
export class SellerAccountsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** `GET /workspaces/:workspaceId/accounts` (member): all statuses, sorted by display name. */
  list(workspaceId: string): Observable<SellerAccount[]> {
    return this.http.get<ListResponse<SellerAccount>>(this.workspaceAccountsUrl(workspaceId)).pipe(
      map((body) => body.items),
      catchError((error: unknown) => throwError(() => toApiError(error))),
    );
  }

  /** `GET /accounts/:accountId` (member). */
  get(accountId: string): Observable<SellerAccount> {
    return this.http
      .get<SellerAccount>(this.accountUrl(accountId))
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `POST /workspaces/:workspaceId/accounts` (owner). */
  create(workspaceId: string, body: CreateSellerAccountRequest): Observable<SellerAccount> {
    return this.http
      .post<SellerAccount>(this.workspaceAccountsUrl(workspaceId), body)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `PATCH /accounts/:accountId` (owner). Also re-enables: `{ status: 'active' }`. */
  update(accountId: string, body: UpdateSellerAccountRequest): Observable<SellerAccount> {
    return this.http
      .patch<SellerAccount>(this.accountUrl(accountId), body)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `DELETE /accounts/:accountId` (owner): marks the account disabled; nothing is deleted. */
  disable(accountId: string): Observable<SellerAccount> {
    return this.http
      .delete<SellerAccount>(this.accountUrl(accountId))
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  private workspaceAccountsUrl(workspaceId: string): string {
    return `${this.baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/accounts`;
  }

  private accountUrl(accountId: string): string {
    return `${this.baseUrl}/accounts/${encodeURIComponent(accountId)}`;
  }
}
