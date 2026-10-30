import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';

import { API_BASE_URL } from '../api/api-base-url';
import { toApiError } from '../api/api-error';
import {
  ConfirmImportRequest,
  ImportConfig,
  ImportDetail,
  ImportRow,
  ImportRowsQuery,
  ImportSummary,
  PageQuery,
  PagedResponse,
} from './import.models';

/**
 * Import endpoints (any member of the account's workspace). Every failure is an `ApiError`:
 * 400 for a malformed id or `dataAsOf`; 404 for an import or account the caller cannot see; 409 for
 * a duplicate file, a wrong status, row errors not acknowledged, or a confirm with no valid rows;
 * 413 for a file over the size limit; 422 `PARSE_ERROR` (with `details`) for a file that cannot be
 * read; 429 `RATE_LIMITED` when the server is busy parsing other uploads.
 */
@Injectable({ providedIn: 'root' })
export class ImportsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** `GET /imports/config`: `{ maxFileMb, maxRows }`. */
  config(): Observable<ImportConfig> {
    return this.http
      .get<ImportConfig>(`${this.baseUrl}/imports/config`)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /**
   * `POST /accounts/:accountId/imports` as `multipart/form-data`: `file`, plus `dataAsOf` when
   * given: a date-only `YYYY-MM-DD` (the end of that day in India), required for an orders CSV and
   * never sent for a workbook. The browser sets the multipart Content-Type and boundary itself.
   * Returns the new job, status `previewed`.
   */
  upload(accountId: string, file: File, dataAsOf: string | null = null): Observable<ImportDetail> {
    const body = new FormData();
    body.append('file', file, file.name);
    if (dataAsOf !== null) {
      body.append('dataAsOf', dataAsOf);
    }
    return this.http
      .post<ImportDetail>(this.accountImportsUrl(accountId), body)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `GET /accounts/:accountId/imports?page&pageSize`: newest first. */
  list(accountId: string, query: PageQuery = {}): Observable<PagedResponse<ImportSummary>> {
    return this.http
      .get<PagedResponse<ImportSummary>>(this.accountImportsUrl(accountId), {
        params: pageParams(query),
      })
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `GET /imports/:importId`. */
  get(importId: string): Observable<ImportDetail> {
    return this.http
      .get<ImportDetail>(this.importUrl(importId))
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `GET /imports/:importId/rows?status&page&pageSize`: by sheet, then row number. */
  rows(importId: string, query: ImportRowsQuery = {}): Observable<PagedResponse<ImportRow>> {
    let params = pageParams(query);
    if (query.status !== undefined) {
      params = params.set('status', query.status);
    }
    return this.http
      .get<PagedResponse<ImportRow>>(`${this.importUrl(importId)}/rows`, { params })
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /**
   * `GET /imports/:importId/errors?page&pageSize`: the rows with errors, whether still `error` or
   * already `skipped` by a confirm. Empty for a cancelled import (its rows are deleted).
   */
  errors(importId: string, query: PageQuery = {}): Observable<PagedResponse<ImportRow>> {
    return this.http
      .get<PagedResponse<ImportRow>>(`${this.importUrl(importId)}/errors`, {
        params: pageParams(query),
      })
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `POST /imports/:importId/confirm`. Imports the valid rows in one transaction. */
  confirm(importId: string, body: ConfirmImportRequest = {}): Observable<ImportDetail> {
    return this.http
      .post<ImportDetail>(`${this.importUrl(importId)}/confirm`, body)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `POST /imports/:importId/retry` (`failed`, or a stale `importing`): re-runs the staged rows. */
  retry(importId: string): Observable<ImportDetail> {
    return this.http
      .post<ImportDetail>(`${this.importUrl(importId)}/retry`, {})
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /**
   * `POST /imports/:importId/cancel` (`previewed`, `failed` or a stale `importing` → `cancelled`).
   * The staged rows are deleted; the job and its counts stay.
   */
  cancel(importId: string): Observable<ImportDetail> {
    return this.http
      .post<ImportDetail>(`${this.importUrl(importId)}/cancel`, {})
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  private accountImportsUrl(accountId: string): string {
    return `${this.baseUrl}/accounts/${encodeURIComponent(accountId)}/imports`;
  }

  private importUrl(importId: string): string {
    return `${this.baseUrl}/imports/${encodeURIComponent(importId)}`;
  }
}

/** Only the paging values that were given; the API defaults the rest (page 1, size 20). */
function pageParams(query: PageQuery): HttpParams {
  let params = new HttpParams();
  if (query.page !== undefined) {
    params = params.set('page', query.page);
  }
  if (query.pageSize !== undefined) {
    params = params.set('pageSize', query.pageSize);
  }
  return params;
}
