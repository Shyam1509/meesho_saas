import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, Subject, catchError, map, of, switchMap } from 'rxjs';

import { describeApiError } from '../api/api-error';
import { WorkspaceContextService } from '../workspaces/workspace-context.service';
import { SellerAccount } from './seller-account.models';
import { SellerAccountsApiService } from './seller-accounts-api.service';

/** localStorage key prefix for the seller account last picked on any page, per workspace. */
export const SELECTED_ACCOUNT_STORAGE_PREFIX = 'msaas.selectedAccountId.';

/**
 * The key the Imports page used before the choice was shared (Milestone 4). Still read when the
 * shared key is not set, so a remembered account survives the upgrade; never written.
 */
export const LEGACY_IMPORT_ACCOUNT_STORAGE_PREFIX = 'msaas.imports.accountId.';

export type SellerAccountsState =
  | { kind: 'loading' }
  | { kind: 'no-workspace' }
  | { kind: 'error'; message: string }
  /** `accounts`: the active ones only, sorted by name. */
  | { kind: 'ready'; workspaceId: string; accounts: SellerAccount[] };

interface Loaded {
  /** The workspace the state belongs to; `undefined` before the first load. */
  workspaceId: string | null | undefined;
  state: SellerAccountsState;
  selectedId: string | null;
}

/**
 * The seller account the account-scoped screens (Orders, Settlements, Imports) work on, shared by
 * all of them and remembered per workspace in localStorage. Only an active account of the selected
 * workspace can be selected. The choice falls back to: the account picked earlier in this session,
 * then the remembered one, then the first account by name.
 *
 * Every page calls {@link refresh} when it opens, so a newly added or disabled account shows up;
 * another workspace in the header reloads the accounts by itself. While loading (and for any state
 * of another workspace), {@link selectedId} is `null`.
 */
@Injectable({ providedIn: 'root' })
export class SelectedSellerAccountService {
  private readonly api = inject(SellerAccountsApiService);
  private readonly context = inject(WorkspaceContextService);
  private readonly loads = new Subject<string | null>();
  private readonly loaded = signal<Loaded>({
    workspaceId: undefined,
    state: { kind: 'loading' },
    selectedId: null,
  });
  /** Picks made in this session, per workspace; used before storage (which may be unavailable). */
  private readonly picks = new Map<string, string>();

  /** The accounts of the selected workspace; `loading` until they have been fetched for it. */
  readonly state = computed<SellerAccountsState>(() => {
    const loaded = this.loaded();
    return loaded.workspaceId === this.context.selectedId() ? loaded.state : { kind: 'loading' };
  });
  /** The selected account's id; `null` unless the accounts are loaded and one is active. */
  readonly selectedId = computed<string | null>(() =>
    this.state().kind === 'ready' ? this.loaded().selectedId : null,
  );
  readonly selected = computed<SellerAccount | null>(() => {
    const state = this.state();
    const id = this.selectedId();
    return state.kind === 'ready' ? (state.accounts.find((a) => a.id === id) ?? null) : null;
  });

  constructor() {
    this.loads
      .pipe(switchMap((workspaceId) => this.fetch(workspaceId)))
      .subscribe((loaded) => this.loaded.set(loaded));

    // Another workspace in the header: load its accounts (unless a page already started that).
    effect(() => {
      const workspaceId = this.context.selectedId();
      untracked(() => {
        if (this.loaded().workspaceId !== workspaceId) {
          this.load(workspaceId);
        }
      });
    });
  }

  /** Fetches the selected workspace's accounts again (pages call this when they open). */
  refresh(): void {
    this.load(this.context.selectedId());
  }

  /**
   * Selects one of the loaded active accounts and remembers it for this workspace. Returns false
   * (and changes nothing) for any other id.
   */
  select(accountId: string): boolean {
    const state = this.state();
    if (state.kind !== 'ready' || !state.accounts.some((a) => a.id === accountId)) {
      return false;
    }
    this.picks.set(state.workspaceId, accountId);
    this.loaded.update((loaded) => ({ ...loaded, selectedId: accountId }));
    rememberAccount(state.workspaceId, accountId);
    return true;
  }

  private load(workspaceId: string | null): void {
    if (workspaceId === null) {
      // Signed out (or no workspace): forget this session's picks.
      this.picks.clear();
    }
    this.loaded.set({
      workspaceId,
      state: workspaceId === null ? { kind: 'no-workspace' } : { kind: 'loading' },
      selectedId: null,
    });
    this.loads.next(workspaceId);
  }

  private fetch(workspaceId: string | null): Observable<Loaded> {
    if (workspaceId === null) {
      return of<Loaded>({ workspaceId, state: { kind: 'no-workspace' }, selectedId: null });
    }
    return this.api.list(workspaceId).pipe(
      map((all): Loaded => {
        const accounts = all
          .filter((a) => a.status === 'active')
          .sort((a, b) =>
            a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
          );
        return {
          workspaceId,
          state: { kind: 'ready', workspaceId, accounts },
          selectedId: this.pick(workspaceId, accounts),
        };
      }),
      catchError((error: unknown) =>
        of<Loaded>({
          workspaceId,
          state: { kind: 'error', message: describeApiError(error) },
          selectedId: null,
        }),
      ),
    );
  }

  /** This session's pick, else the remembered account, else the first; only an active account. */
  private pick(workspaceId: string, accounts: SellerAccount[]): string | null {
    const candidates = [this.picks.get(workspaceId), ...readRememberedAccounts(workspaceId)];
    for (const candidate of candidates) {
      const match = accounts.find((a) => a.id === candidate);
      if (match) {
        return match.id;
      }
    }
    return accounts[0]?.id ?? null;
  }
}

/** The remembered account ids for the workspace: the shared key first, then the legacy one. */
function readRememberedAccounts(workspaceId: string): (string | null)[] {
  try {
    return [
      localStorage.getItem(SELECTED_ACCOUNT_STORAGE_PREFIX + workspaceId),
      localStorage.getItem(LEGACY_IMPORT_ACCOUNT_STORAGE_PREFIX + workspaceId),
    ];
  } catch {
    // Storage unavailable: nothing remembered.
    return [];
  }
}

function rememberAccount(workspaceId: string, accountId: string): void {
  try {
    localStorage.setItem(SELECTED_ACCOUNT_STORAGE_PREFIX + workspaceId, accountId);
  } catch {
    // Not remembered; the choice still applies for this session.
  }
}
