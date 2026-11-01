import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, map, merge, of, startWith, switchMap, tap } from 'rxjs';

import { describeApiError } from '../../core/api/api-error';
import { SellerAccount } from '../../core/seller-accounts/seller-account.models';
import { SellerAccountsApiService } from '../../core/seller-accounts/seller-accounts-api.service';
import { WorkspaceContextService } from '../../core/workspaces/workspace-context.service';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { SellerAccountForm } from './seller-account-form/seller-account-form';
import { LoadingState } from '../../shared/loading-state/loading-state';
import { ErrorState } from '../../shared/error-state/error-state';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { TableRegion } from '../../shared/table-region/table-region';

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; accounts: SellerAccount[] }
  | { kind: 'error'; message: string }
  | { kind: 'no-workspace' };

interface EditorState {
  workspaceId: string;
  /** `null` while adding a new account. */
  account: SellerAccount | null;
}

/**
 * Seller accounts of the selected workspace. Everyone sees the list; owners can add, edit,
 * disable and re-enable accounts (members get a read-only view).
 */
@Component({
  selector: 'app-seller-accounts-page',
  imports: [SellerAccountForm, ConfirmDialog, LoadingState, ErrorState, EmptyState, TableRegion],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './seller-accounts-page.html',
})
export class SellerAccountsPage {
  private readonly api = inject(SellerAccountsApiService);
  private readonly context = inject(WorkspaceContextService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly pageHeading = viewChild.required<ElementRef<HTMLElement>>('pageHeading');
  private readonly reloads = new Subject<void>();
  /** The button that opened the editor; focus goes back to it when the editor closes. */
  private editorTrigger: HTMLElement | null = null;

  protected readonly workspace = this.context.selected;
  protected readonly isOwner = this.context.isOwner;
  protected readonly list = signal<ListState>({ kind: 'loading' });
  protected readonly editor = signal<EditorState | null>(null);
  /** The account waiting for a disable / re-enable confirmation. */
  protected readonly confirmTarget = signal<SellerAccount | null>(null);
  protected readonly statusPending = signal(false);
  protected readonly statusError = signal<string | null>(null);
  /** Last success message, announced politely. */
  protected readonly notice = signal('');

  constructor() {
    merge(
      toObservable(this.context.selectedId),
      this.reloads.pipe(map(() => this.context.selectedId())),
    )
      .pipe(
        tap(() => this.resetInteractions()),
        switchMap((workspaceId) => this.loadAccounts(workspaceId)),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.list.set(state));
  }

  protected retry(): void {
    this.reloads.next();
  }

  protected openCreate(event: Event): void {
    const workspace = this.workspace();
    if (!workspace) {
      return;
    }
    this.editorTrigger = event.currentTarget as HTMLElement;
    this.notice.set('');
    this.editor.set({ workspaceId: workspace.id, account: null });
  }

  protected openEdit(account: SellerAccount, event: Event): void {
    this.editorTrigger = event.currentTarget as HTMLElement;
    this.notice.set('');
    this.editor.set({ workspaceId: account.workspaceId, account });
  }

  protected onSaved(saved: SellerAccount): void {
    const wasNew = this.editor()?.account === null;
    this.upsert(saved);
    this.notice.set(wasNew ? `Added ${saved.displayName}.` : `Saved ${saved.displayName}.`);
    this.closeEditor();
  }

  protected closeEditor(): void {
    this.editor.set(null);
    const trigger = this.editorTrigger;
    this.editorTrigger = null;
    afterNextRender(
      () => (trigger?.isConnected ? trigger : this.pageHeading().nativeElement).focus(),
      { injector: this.injector },
    );
  }

  protected askToToggle(account: SellerAccount): void {
    this.notice.set('');
    this.statusError.set(null);
    this.confirmTarget.set(account);
  }

  protected cancelToggle(): void {
    this.confirmTarget.set(null);
    this.statusError.set(null);
  }

  /** Disable (`DELETE`, never deletes) or re-enable (`PATCH { status: 'active' }`). */
  protected confirmToggle(): void {
    const target = this.confirmTarget();
    if (!target || this.statusPending()) {
      return;
    }
    this.statusPending.set(true);
    this.statusError.set(null);
    const request =
      target.status === 'active'
        ? this.api.disable(target.id)
        : this.api.update(target.id, { status: 'active' });
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        this.statusPending.set(false);
        this.upsert(updated);
        this.confirmTarget.set(null);
        this.notice.set(
          updated.status === 'disabled'
            ? `Disabled ${updated.displayName}.`
            : `Re-enabled ${updated.displayName}.`,
        );
      },
      error: (error: unknown) => {
        this.statusPending.set(false);
        this.statusError.set(describeApiError(error));
      },
    });
  }

  private loadAccounts(workspaceId: string | null): Observable<ListState> {
    if (workspaceId === null) {
      return of<ListState>({ kind: 'no-workspace' });
    }
    return this.api.list(workspaceId).pipe(
      map((accounts): ListState => ({ kind: 'ready', accounts: sortAccounts(accounts) })),
      catchError((error: unknown) =>
        of<ListState>({ kind: 'error', message: describeApiError(error) }),
      ),
      startWith<ListState>({ kind: 'loading' }),
    );
  }

  /** A different workspace (or a reload) discards any half-finished edit or confirmation. */
  private resetInteractions(): void {
    this.editor.set(null);
    this.editorTrigger = null;
    this.confirmTarget.set(null);
    this.statusError.set(null);
    this.notice.set('');
  }

  private upsert(account: SellerAccount): void {
    this.list.update((state) => {
      if (state.kind !== 'ready') {
        return state;
      }
      const others = state.accounts.filter((a) => a.id !== account.id);
      return { kind: 'ready', accounts: sortAccounts([...others, account]) };
    });
  }
}

/** The API's order: display name (case-insensitive), then id. */
function sortAccounts(accounts: SellerAccount[]): SellerAccount[] {
  return [...accounts].sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }) ||
      a.id.length - b.id.length ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
