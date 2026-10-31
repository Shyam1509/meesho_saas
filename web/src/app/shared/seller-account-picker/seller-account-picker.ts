import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SelectedSellerAccountService } from '../../core/seller-accounts/selected-seller-account.service';
import { WorkspaceContextService } from '../../core/workspaces/workspace-context.service';

/**
 * "Seller account" select for the account-scoped pages, backed by the shared
 * {@link SelectedSellerAccountService} (so every page works on the same account), with its loading,
 * error ("Try again"), no-workspace and no-active-account states. Creating it reloads the accounts,
 * so an account added or disabled elsewhere shows up when a page opens. The page shows its own
 * content once `SelectedSellerAccountService.selected()` is set.
 */
@Component({
  selector: 'app-seller-account-picker',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let state = selection.state();
    <div [attr.aria-busy]="state.kind === 'loading'" [attr.data-accounts-state]="state.kind">
      @if (state.kind === 'loading') {
        <p role="status" class="text-sm text-slate-700">Loading seller accounts…</p>
      } @else if (state.kind === 'no-workspace') {
        <p class="text-sm text-slate-700">{{ noWorkspaceText() }}</p>
      } @else if (state.kind === 'error') {
        <div role="alert" class="max-w-2xl rounded-md border border-red-200 bg-red-50 p-4 text-sm">
          <p class="font-medium text-red-800">The seller accounts could not be loaded.</p>
          <p class="mt-1 text-red-800">{{ state.message }}</p>
          <button
            type="button"
            class="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            (click)="selection.refresh()"
          >
            Try again
          </button>
        </div>
      } @else if (state.accounts.length === 0) {
        <div
          class="max-w-2xl rounded-lg border border-dashed border-slate-300 bg-white p-6"
          data-testid="no-accounts"
        >
          <p class="text-sm font-medium text-slate-900">No active seller accounts.</p>
          <p class="mt-1 text-sm text-slate-600">
            {{ purpose() }}
            @if (isOwner()) {
              Add one (or re-enable a disabled one) first.
            } @else {
              Ask an owner of this workspace to add one.
            }
          </p>
          <a
            routerLink="/seller-accounts"
            class="mt-3 inline-block rounded-sm text-sm font-medium text-accent-700 underline hover:text-accent-800"
          >
            Go to Seller accounts
          </a>
        </div>
      } @else {
        <div class="max-w-sm">
          <label [for]="inputId()" class="block text-sm font-medium text-slate-800">
            Seller account
          </label>
          <select
            [id]="inputId()"
            class="mt-1 block w-full rounded-md border border-slate-300 bg-white py-2 pr-8 pl-3 text-sm text-slate-900"
            (change)="onChange($event)"
          >
            @for (account of state.accounts; track account.id) {
              <option [value]="account.id" [selected]="account.id === selection.selectedId()">
                {{ account.displayName }}
              </option>
            }
          </select>
        </div>
      }
    </div>
  `,
})
export class SellerAccountPicker {
  /** The select's id (its label points at it). */
  readonly inputId = input.required<string>();
  /** Why an account is needed, first sentence of the "no active accounts" state. */
  readonly purpose = input('Everything here belongs to a seller account.');
  readonly noWorkspaceText = input(
    'You are not a member of any workspace yet, so there are no seller accounts.',
  );

  /** The user picked another account (already selected and remembered). */
  readonly accountChange = output<string>();

  protected readonly selection = inject(SelectedSellerAccountService);
  protected readonly isOwner = inject(WorkspaceContextService).isOwner;

  constructor() {
    this.selection.refresh();
  }

  protected onChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    if (id === this.selection.selectedId()) {
      return;
    }
    if (this.selection.select(id)) {
      this.accountChange.emit(id);
    }
  }
}
