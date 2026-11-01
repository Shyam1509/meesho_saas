import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';

import { describeApiError, toApiError } from '../../../core/api/api-error';
import { PagedResponse } from '../../../core/api/paged-response';
import { OrderSummary } from '../../../core/orders/order.models';
import { OrdersApiService } from '../../../core/orders/orders-api.service';
import { ReconciliationApiService } from '../../../core/reconciliation/reconciliation-api.service';
import { SettlementEntry } from '../../../core/settlements/settlement.models';
import { Amount } from '../../../shared/amount/amount';
import { DIALOG_ACTIONS_CLASS, Dialog } from '../../../shared/dialog/dialog';
import { MISSING } from '../../../shared/format/format';
import { DisplayDatePipe } from '../../../shared/format/format.pipes';
import { Loadable, toLoadable } from '../../../shared/loadable/loadable';
import { MAX_SEARCH_LENGTH } from '../../../shared/url-state/url-state';

/** How many orders a search shows. */
export const MATCH_SEARCH_PAGE_SIZE = 10;

interface MatchFailure {
  heading: string;
  message: string;
}

/**
 * Owner-only "Match to order…": search the account's orders (sub order no. or SKU prefix, or
 * product name, via the orders list), pick one, confirm. The server answers 404 when the entry or
 * the order is not in this account (any more) and 409 when the entry cannot be matched (superseded,
 * or an import is running for the account); its message is shown in the dialog, which stays open.
 */
@Component({
  selector: 'app-match-order-dialog',
  imports: [Amount, Dialog, DisplayDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './match-order-dialog.html',
})
export class MatchOrderDialog {
  readonly accountId = input.required<string>();
  readonly entry = input.required<SettlementEntry>();

  /** The server matched the entry; carries the updated entry. */
  readonly matched = output<SettlementEntry>();
  readonly cancelled = output();

  private readonly orders = inject(OrdersApiService);
  private readonly reconciliation = inject(ReconciliationApiService);
  private readonly destroyRef = inject(DestroyRef);
  private search$: Subscription | null = null;

  protected readonly missing = MISSING;
  protected readonly actionsClass = `${DIALOG_ACTIONS_CLASS} justify-end`;
  protected readonly maxLength = MAX_SEARCH_LENGTH;
  protected readonly query = signal('');
  /** `null` until the first search. */
  protected readonly results = signal<Loadable<PagedResponse<OrderSummary>> | null>(null);
  protected readonly selectedOrderId = signal<string | null>(null);
  protected readonly selectedOrder = computed(() => {
    const results = this.results();
    const id = this.selectedOrderId();
    return results?.kind === 'ready'
      ? (results.value.items.find((o) => o.id === id) ?? null)
      : null;
  });
  protected readonly pending = signal(false);
  protected readonly failure = signal<MatchFailure | null>(null);
  protected readonly needsChoice = signal(false);

  protected search(event: Event): void {
    event.preventDefault();
    this.search$?.unsubscribe();
    this.selectedOrderId.set(null);
    this.failure.set(null);
    const q = this.query().trim();
    this.search$ = toLoadable(
      this.orders.list(this.accountId(), {
        q: q || undefined,
        page: 1,
        pageSize: MATCH_SEARCH_PAGE_SIZE,
      }),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => this.results.set(state));
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected choose(orderId: string): void {
    this.selectedOrderId.set(orderId);
    this.needsChoice.set(false);
  }

  protected confirm(): void {
    if (this.pending()) {
      return;
    }
    const order = this.selectedOrder();
    if (order === null) {
      this.needsChoice.set(true);
      return;
    }
    this.pending.set(true);
    this.failure.set(null);
    this.reconciliation
      .manualMatch(this.accountId(), { settlementEntryId: this.entry().id, orderId: order.id })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entry) => {
          this.pending.set(false);
          this.matched.emit(entry);
        },
        error: (error: unknown) => {
          this.pending.set(false);
          this.failure.set(describeMatchFailure(error));
        },
      });
  }

  protected cancel(): void {
    if (!this.pending()) {
      this.cancelled.emit();
    }
  }
}

function describeMatchFailure(error: unknown): MatchFailure {
  const apiError = toApiError(error);
  switch (apiError.status) {
    case 404:
      return {
        heading: 'Not found in this account',
        message: `${apiError.message} Close this dialog and refresh the list.`,
      };
    case 409:
      // A superseded entry, or an import / other change running for the account right now.
      return { heading: 'This entry cannot be matched now', message: apiError.message };
    case 403:
      return { heading: 'Only an owner can match entries', message: apiError.message };
    default:
      return { heading: 'The match failed', message: describeApiError(apiError) };
  }
}
