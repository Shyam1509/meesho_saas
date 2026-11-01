import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';

import { API_BASE_URL } from '../api/api-base-url';
import { toApiError } from '../api/api-error';
import { toHttpParams } from '../api/query-params';
import { ListResponse } from '../workspaces/workspace.models';
import {
  CreateExpenseRequest,
  Expense,
  ExpenseCategory,
  ExpenseListQuery,
  ExpenseListResponse,
  UpdateExpenseRequest,
  WorkspaceExpenseListQuery,
} from './expense.models';

/**
 * Expense endpoints. Lists: any member; create / update / delete: owners only. Every failure is
 * an `ApiError`: 400 for an invalid value (with field `details`); 403 for a member writing; 404 for
 * an account, workspace or expense the caller cannot see.
 */
@Injectable({ providedIn: 'root' })
export class ExpensesApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** `GET /expenses/categories`: the allowed categories, in display order. */
  categories(): Observable<ListResponse<ExpenseCategory>> {
    return this.http
      .get<ListResponse<ExpenseCategory>>(`${this.baseUrl}/expenses/categories`)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `GET /accounts/:accountId/expenses?page&pageSize&sort&from&to&category…`. */
  listForAccount(accountId: string, query: ExpenseListQuery = {}): Observable<ExpenseListResponse> {
    return this.http
      .get<ExpenseListResponse>(this.accountUrl(accountId), { params: listParams(query) })
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `GET /workspaces/:workspaceId/expenses?…&scope`: workspace-wide, or with `scope=all` every one. */
  listForWorkspace(
    workspaceId: string,
    query: WorkspaceExpenseListQuery = {},
  ): Observable<ExpenseListResponse> {
    return this.http
      .get<ExpenseListResponse>(this.workspaceUrl(workspaceId), {
        params: listParams(query, query.scope),
      })
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `POST /accounts/:accountId/expenses` (owner): an expense of that seller account. */
  createForAccount(accountId: string, body: CreateExpenseRequest): Observable<Expense> {
    return this.http
      .post<Expense>(this.accountUrl(accountId), body)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `POST /workspaces/:workspaceId/expenses` (owner): a workspace-wide expense. */
  createForWorkspace(workspaceId: string, body: CreateExpenseRequest): Observable<Expense> {
    return this.http
      .post<Expense>(this.workspaceUrl(workspaceId), body)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `PATCH /expenses/:expenseId` (owner). The scope never changes. */
  update(expenseId: string, body: UpdateExpenseRequest): Observable<Expense> {
    return this.http
      .patch<Expense>(this.expenseUrl(expenseId), body)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `DELETE /expenses/:expenseId` (owner): deletes it for good. Answers 204. */
  delete(expenseId: string): Observable<void> {
    return this.http.delete<unknown>(this.expenseUrl(expenseId)).pipe(
      map(() => undefined),
      catchError((error: unknown) => throwError(() => toApiError(error))),
    );
  }

  private accountUrl(accountId: string): string {
    return `${this.baseUrl}/accounts/${encodeURIComponent(accountId)}/expenses`;
  }

  private workspaceUrl(workspaceId: string): string {
    return `${this.baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/expenses`;
  }

  private expenseUrl(expenseId: string): string {
    return `${this.baseUrl}/expenses/${encodeURIComponent(expenseId)}`;
  }
}

function listParams(query: ExpenseListQuery, scope?: string) {
  return toHttpParams({
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
    from: query.from,
    to: query.to,
    category: query.category,
    scope,
  });
}
