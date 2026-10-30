import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';

import { API_BASE_URL } from '../api/api-base-url';
import { toApiError } from '../api/api-error';
import { AuthConfig, LoginRequest, MeResponse, RegisterRequest } from './auth.models';

/**
 * `/auth/*` endpoints. One method, one request; every failure is an `ApiError`.
 * The session cookie is HttpOnly, so `me()` is the only way to learn who is signed in.
 */
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** `GET /auth/config`: whether self-registration is open. */
  config(): Observable<AuthConfig> {
    return this.http
      .get<AuthConfig>(`${this.baseUrl}/auth/config`)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `GET /auth/csrf` (204): makes the API set the `msaas_xsrf` cookie. */
  csrf(): Observable<void> {
    return this.http.get(`${this.baseUrl}/auth/csrf`).pipe(
      map(() => undefined),
      catchError((error: unknown) => throwError(() => toApiError(error))),
    );
  }

  /** `GET /auth/me`: 200 when signed in, `ApiError` with status 401 when not. */
  me(): Observable<MeResponse> {
    return this.http
      .get<MeResponse>(`${this.baseUrl}/auth/me`)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `POST /auth/login`. */
  login(body: LoginRequest): Observable<MeResponse> {
    return this.http
      .post<MeResponse>(`${this.baseUrl}/auth/login`, body)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `POST /auth/register`: creates the user, their first workspace and a session. */
  register(body: RegisterRequest): Observable<MeResponse> {
    return this.http
      .post<MeResponse>(`${this.baseUrl}/auth/register`, body)
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /** `POST /auth/logout` (204): revokes the current session and clears the cookie. */
  logout(): Observable<void> {
    return this.http.post(`${this.baseUrl}/auth/logout`, null).pipe(
      map(() => undefined),
      catchError((error: unknown) => throwError(() => toApiError(error))),
    );
  }
}
