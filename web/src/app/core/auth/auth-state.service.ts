import { HttpXsrfTokenExtractor } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, defer, firstValueFrom, map, of, switchMap, tap } from 'rxjs';

import { describeApiError, toApiError } from '../api/api-error';
import { SelectedWorkspaceStore } from '../workspaces/selected-workspace.store';
import { AuthApiService } from './auth-api.service';
import { LoginRequest, MeResponse, RegisterRequest } from './auth.models';

/** `unknown` until the first `GET /auth/me` answers. */
export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

/**
 * Who is signed in, as signals. Loaded once at startup (`provideAppInitializer` in `app.config.ts`)
 * and updated by sign-in, registration, sign-out and the 401 interceptor.
 */
@Injectable({ providedIn: 'root' })
export class AuthStateService {
  private readonly api = inject(AuthApiService);
  private readonly xsrfTokens = inject(HttpXsrfTokenExtractor);
  private readonly selectedWorkspace = inject(SelectedWorkspaceStore);

  private readonly statusState = signal<AuthStatus>('unknown');
  private readonly session = signal<MeResponse | null>(null);
  private readonly sessionCheckErrorState = signal<string | null>(null);
  private readonly registrationEnabledState = signal<boolean | null>(null);
  private pendingLoad: Promise<void> | null = null;

  readonly status = this.statusState.asReadonly();
  readonly isAuthenticated = computed(() => this.statusState() === 'authenticated');
  readonly user = computed(() => this.session()?.user ?? null);
  readonly workspaces = computed(() => this.session()?.workspaces ?? []);
  /**
   * Why the last session check could not tell whether anyone is signed in (network error, 5xx).
   * The app then treats the visitor as signed out, and the sign-in page explains why.
   */
  readonly sessionCheckError = this.sessionCheckErrorState.asReadonly();
  /** `GET /auth/config` result; `null` until {@link loadConfig} has answered. */
  readonly registrationEnabled = this.registrationEnabledState.asReadonly();

  /**
   * `GET /auth/me`. 200 → authenticated; 401 → anonymous (not an error) and the session ends;
   * anything else → anonymous with {@link sessionCheckError} set (stored choices are kept, the
   * API may just be unreachable). Never rejects; concurrent calls share one request.
   */
  load(): Promise<void> {
    this.pendingLoad ??= firstValueFrom(
      this.api.me().pipe(
        map((me) => this.setSession(me)),
        catchError((error: unknown) => {
          const apiError = toApiError(error);
          if (apiError.status === 401) {
            this.endSession();
            this.sessionCheckErrorState.set(null);
          } else {
            this.clear();
            this.sessionCheckErrorState.set(describeApiError(apiError));
          }
          return of(undefined);
        }),
      ),
    ).finally(() => (this.pendingLoad = null));
    return this.pendingLoad;
  }

  /** Resolves once the status is known, loading it first if nothing has yet. */
  ensureLoaded(): Promise<void> {
    return this.statusState() === 'unknown' ? this.load() : Promise.resolve();
  }

  /** `GET /auth/config`, cached after the first answer. A failure counts as "registration closed". */
  loadConfig(): Promise<boolean> {
    const cached = this.registrationEnabledState();
    if (cached !== null) {
      return Promise.resolve(cached);
    }
    return firstValueFrom(
      this.api.config().pipe(
        map((config) => {
          const enabled = config.registrationEnabled === true;
          this.registrationEnabledState.set(enabled);
          return enabled;
        }),
        catchError(() => of(false)),
      ),
    );
  }

  /** `POST /auth/login`; on success the app is signed in as the returned user. */
  login(credentials: LoginRequest): Observable<MeResponse> {
    return this.withCsrfToken(() => this.api.login(credentials)).pipe(
      tap((me) => this.setSession(me)),
    );
  }

  /** `POST /auth/register`; on success the app is signed in as the new user. */
  register(request: RegisterRequest): Observable<MeResponse> {
    return this.withCsrfToken(() => this.api.register(request)).pipe(
      tap((me) => this.setSession(me)),
    );
  }

  /** `POST /auth/logout`; local state is cleared only once the server has revoked the session. */
  logout(): Observable<void> {
    return this.withCsrfToken(() => this.api.logout()).pipe(tap(() => this.endSession()));
  }

  setSession(me: MeResponse): void {
    this.session.set(me);
    this.sessionCheckErrorState.set(null);
    this.statusState.set('authenticated');
  }

  /** Forgets the user (signed out). Per-user browser state is left alone; see {@link endSession}. */
  clear(): void {
    this.session.set(null);
    this.statusState.set('anonymous');
  }

  /**
   * The session is over (sign-out, or a 401 from the API): forget the user and the per-user state
   * kept in the browser (the selected workspace), so the next person on a shared machine starts
   * clean.
   */
  endSession(): void {
    this.clear();
    this.selectedWorkspace.clear();
  }

  /** Applies a rename to the cached memberships, keeping the API's order (name, then id). */
  renameWorkspace(workspaceId: string, name: string): void {
    this.session.update((me) => {
      if (!me) {
        return me;
      }
      const workspaces = me.workspaces
        .map((w) => (w.id === workspaceId ? { ...w, name } : w))
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
            compareIds(a.id, b.id),
        );
      return { ...me, workspaces };
    });
  }

  /**
   * Unsafe requests must echo the `msaas_xsrf` cookie. Any API response sets it, so it is normally
   * there already; if not (cookies cleared, first request failed), fetch it first.
   */
  private withCsrfToken<T>(request: () => Observable<T>): Observable<T> {
    return defer(() =>
      this.xsrfTokens.getToken() ? request() : this.api.csrf().pipe(switchMap(request)),
    );
  }
}

/** Numeric order for the API's decimal string ids. */
function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}
