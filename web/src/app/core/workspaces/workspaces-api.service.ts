import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';

import { API_BASE_URL } from '../api/api-base-url';
import { toApiError } from '../api/api-error';
import { ListResponse, WorkspaceMember, WorkspaceSummary } from './workspace.models';

/**
 * `/workspaces/*` endpoints. Every failure is an `ApiError`: 404 when the workspace does not exist
 * or the caller is not a member, 403 when a member tries an owner action.
 */
@Injectable({ providedIn: 'root' })
export class WorkspacesApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** `GET /workspaces`: the caller's workspaces. */
  list(): Observable<WorkspaceSummary[]> {
    return this.http.get<ListResponse<WorkspaceSummary>>(`${this.baseUrl}/workspaces`).pipe(
      map((body) => body.items),
      catchError((error: unknown) => throwError(() => toApiError(error))),
    );
  }

  /** `GET /workspaces/:workspaceId` (member). */
  get(workspaceId: string): Observable<WorkspaceSummary> {
    return this.http
      .get<WorkspaceSummary>(this.workspaceUrl(workspaceId))
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `PATCH /workspaces/:workspaceId { name }` (owner). */
  rename(workspaceId: string, name: string): Observable<WorkspaceSummary> {
    return this.http
      .patch<WorkspaceSummary>(this.workspaceUrl(workspaceId), { name })
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `GET /workspaces/:workspaceId/members` (member). */
  members(workspaceId: string): Observable<WorkspaceMember[]> {
    return this.http
      .get<ListResponse<WorkspaceMember>>(`${this.workspaceUrl(workspaceId)}/members`)
      .pipe(
        map((body) => body.items),
        catchError((error: unknown) => throwError(() => toApiError(error))),
      );
  }

  private workspaceUrl(workspaceId: string): string {
    return `${this.baseUrl}/workspaces/${encodeURIComponent(workspaceId)}`;
  }
}
