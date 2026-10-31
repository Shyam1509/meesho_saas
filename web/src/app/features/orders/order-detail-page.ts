import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Observable, Subject, catchError, map, merge, of, startWith, switchMap } from 'rxjs';

import { describeApiError, toApiError } from '../../core/api/api-error';
import { OrderDetail, StatusEvent } from '../../core/orders/order.models';
import { OrdersApiService } from '../../core/orders/orders-api.service';
import { AS_REPORTED_NOTE } from '../../core/settlements/settlement.models';
import { Amount } from '../../shared/amount/amount';
import { MISSING } from '../../shared/format/format';
import {
  CountPipe,
  DisplayDatePipe,
  DisplayDateTimePipe,
} from '../../shared/format/format.pipes';
import { SettlementEntriesTable } from '../settlements/settlement-entries-table/settlement-entries-table';

/** The API's id format (decimal BIGINT as a string). */
const ID_PATTERN = /^[1-9][0-9]{0,18}$/;

type DetailState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; order: OrderDetail; history: StatusEvent[] };

/** Oldest first: by `observedAt`, then by id (numeric, the API's tie-break). */
export function sortStatusHistory(events: readonly StatusEvent[]): StatusEvent[] {
  return [...events].sort((a, b) => {
    const byTime = Date.parse(a.observedAt) - Date.parse(b.observedAt);
    if (byTime !== 0 && !Number.isNaN(byTime)) {
      return byTime;
    }
    return a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/**
 * `/accounts/:accountId/orders/:orderId`: one order's reported fields, its status history (each
 * status links to the import that reported it) and the settlement entries matched to it, with the
 * settled amount as reported. A malformed id, a 400 or a 404 (also for an order of another
 * account) shows "not found".
 */
@Component({
  selector: 'app-order-detail-page',
  imports: [
    RouterLink,
    Amount,
    CountPipe,
    DisplayDatePipe,
    DisplayDateTimePipe,
    SettlementEntriesTable,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-detail-page.html',
})
export class OrderDetailPage {
  /** From the route (`withComponentInputBinding()`). */
  readonly accountId = input.required<string>();
  readonly orderId = input.required<string>();

  private readonly api = inject(OrdersApiService);
  private readonly reloads = new Subject<void>();

  protected readonly missing = MISSING;
  protected readonly asReportedNote = AS_REPORTED_NOTE;
  protected readonly state = signal<DetailState>({ kind: 'loading' });
  protected readonly heading = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? `Order ${state.order.subOrderNo}` : 'Order details';
  });

  constructor() {
    const ids = computed(() => ({ accountId: this.accountId(), orderId: this.orderId() }));
    merge(toObservable(ids), this.reloads.pipe(map(() => ids())))
      .pipe(
        switchMap(({ accountId, orderId }) => this.load(accountId, orderId)),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.state.set(state));
  }

  protected retry(): void {
    this.reloads.next();
  }

  private load(accountId: string, orderId: string): Observable<DetailState> {
    if (!ID_PATTERN.test(accountId) || !ID_PATTERN.test(orderId)) {
      return of<DetailState>({ kind: 'not-found' });
    }
    return this.api.get(accountId, orderId).pipe(
      map(
        (order): DetailState => ({
          kind: 'ready',
          order,
          history: sortStatusHistory(order.statusHistory),
        }),
      ),
      catchError((error: unknown) => {
        const status = toApiError(error).status;
        return of<DetailState>(
          status === 404 || status === 400
            ? { kind: 'not-found' }
            : { kind: 'error', message: describeApiError(error) },
        );
      }),
      startWith<DetailState>({ kind: 'loading' }),
    );
  }
}
