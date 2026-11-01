import { HttpClient, HttpErrorResponse, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, map, switchMap, throwError } from 'rxjs';

import { API_BASE_URL } from '../api/api-base-url';
import { toApiError } from '../api/api-error';
import { toHttpParams } from '../api/query-params';
import {
  CsvFile,
  ExpensesCsvQuery,
  OrdersCsvQuery,
  SettlementsCsvQuery,
  WorkspaceExpensesCsvQuery,
} from './report.models';

/**
 * CSV exports (any member). The file is fetched as a Blob (not opened as a plain link) so a refusal
 * can be shown on the page: 422 when the filters select more than 100 000 rows ("narrow the
 * filters"), 400 for an invalid filter, 404 for an account or workspace the caller cannot see.
 * Every failure is an `ApiError` built from the server's JSON envelope.
 */
@Injectable({ providedIn: 'root' })
export class ReportsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** `GET /accounts/:accountId/reports/orders.csv?status…&from&to&paymentFrom&paymentTo&q&settlement`. */
  ordersCsv(accountId: string, query: OrdersCsvQuery = {}): Observable<CsvFile> {
    const params = toHttpParams({
      status: query.status,
      from: query.from,
      to: query.to,
      paymentFrom: query.paymentFrom,
      paymentTo: query.paymentTo,
      q: query.q,
      settlement: query.settlement,
    });
    return this.download(`${this.accountUrl(accountId)}/orders.csv`, params, 'orders.csv');
  }

  /**
   * `GET /accounts/:accountId/reports/settlements.csv?entryType…&from&to&dateBasis&q&match&includeSuperseded`.
   * `includeSuperseded` is sent only when true.
   */
  settlementsCsv(accountId: string, query: SettlementsCsvQuery = {}): Observable<CsvFile> {
    const params = toHttpParams({
      entryType: query.entryType,
      from: query.from,
      to: query.to,
      dateBasis: query.dateBasis,
      q: query.q,
      match: query.match,
      includeSuperseded: query.includeSuperseded === true ? 'true' : undefined,
    });
    return this.download(`${this.accountUrl(accountId)}/settlements.csv`, params, 'settlements.csv');
  }

  /** `GET /accounts/:accountId/reports/expenses.csv?from&to&category…`: that account's expenses. */
  accountExpensesCsv(accountId: string, query: ExpensesCsvQuery = {}): Observable<CsvFile> {
    return this.download(
      `${this.accountUrl(accountId)}/expenses.csv`,
      toHttpParams({ from: query.from, to: query.to, category: query.category }),
      'expenses.csv',
    );
  }

  /**
   * `GET /workspaces/:workspaceId/reports/expenses.csv?from&to&category…&scope`: workspace-wide
   * expenses, or with `scope=all` every one of the workspace.
   */
  workspaceExpensesCsv(
    workspaceId: string,
    query: WorkspaceExpensesCsvQuery = {},
  ): Observable<CsvFile> {
    return this.download(
      `${this.baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/reports/expenses.csv`,
      toHttpParams({
        from: query.from,
        to: query.to,
        category: query.category,
        scope: query.scope,
      }),
      'expenses.csv',
    );
  }

  private accountUrl(accountId: string): string {
    return `${this.baseUrl}/accounts/${encodeURIComponent(accountId)}/reports`;
  }

  private download(url: string, params: HttpParams, fallbackName: string): Observable<CsvFile> {
    return this.http.get(url, { params, responseType: 'blob', observe: 'response' }).pipe(
      map((response: HttpResponse<Blob>) => ({
        blob: response.body ?? new Blob([], { type: 'text/csv' }),
        filename: filenameFromDisposition(response.headers.get('Content-Disposition')) ?? fallbackName,
      })),
      catchError((error: unknown) =>
        from(readBlobError(error)).pipe(switchMap((apiError) => throwError(() => apiError))),
      ),
    );
  }
}

/**
 * The file name in a `Content-Disposition` header (`filename*=UTF-8''…` preferred, then
 * `filename="…"`), without any path; `null` when there is none.
 */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }
  let name: string | null = null;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (extended) {
    try {
      name = decodeURIComponent(extended[1].trim());
    } catch {
      name = null;
    }
  }
  if (name === null) {
    const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/.exec(header);
    name = plain ? (plain[1] ?? plain[2] ?? '').trim() : null;
  }
  const base = name?.split(/[\\/]/).pop()?.trim() ?? '';
  return base.length > 0 ? base : null;
}

/**
 * A failed Blob request carries its JSON error envelope as a Blob: read it, so the `ApiError` has
 * the server's message (e.g. the 422 "narrow the filters").
 */
async function readBlobError(error: unknown): Promise<unknown> {
  if (!(error instanceof HttpErrorResponse) || !(error.error instanceof Blob)) {
    return toApiError(error);
  }
  let body: unknown;
  try {
    const text = await blobText(error.error);
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    // Not JSON: the generic "unexpected response" message is used.
    body = null;
  }
  return toApiError(
    new HttpErrorResponse({
      error: body,
      headers: error.headers,
      status: error.status,
      statusText: error.statusText,
      url: error.url ?? undefined,
    }),
  );
}

function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') {
    return blob.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}
