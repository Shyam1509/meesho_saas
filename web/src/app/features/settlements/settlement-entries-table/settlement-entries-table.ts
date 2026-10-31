import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { userName } from '../../../core/api/refs';
import {
  SettlementEntry,
  settlementEntryTypeLabel,
} from '../../../core/settlements/settlement.models';
import { Amount } from '../../../shared/amount/amount';
import { MISSING } from '../../../shared/format/format';
import { DisplayDatePipe, DisplayDateTimePipe } from '../../../shared/format/format.pipes';
import { MatchStateBadge } from '../../../shared/match-state-badge/match-state-badge';
import { SortButton, ariaSort } from '../../../shared/sort/sort';

/** The row action a table offers: unmatch a matched entry, or match an unmatched one. */
export type SettlementRowAction = 'unmatch' | 'match';

/**
 * Settlement ledger entries with every amount column as reported (INR; "—" when the sheet had no
 * value), the match state (linking to the order when matched) and the source import. With `sort`
 * set, the payment date, order date and settlement amount headers sort the list (server side).
 * `action` adds a button per row it applies to (the page decides who may see it); never on a
 * superseded entry, which the API refuses to match or unmatch (409).
 */
@Component({
  selector: 'app-settlement-entries-table',
  imports: [RouterLink, Amount, DisplayDatePipe, DisplayDateTimePipe, MatchStateBadge, SortButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table class="min-w-full divide-y divide-slate-200 text-sm" data-testid="entries-table">
        <caption class="sr-only">
          {{ caption() }}
        </caption>
        <thead class="bg-slate-50">
          <tr>
            <th scope="col" class="px-3 py-2.5 text-left font-semibold text-slate-700">
              Transaction ID
            </th>
            <th
              scope="col"
              class="px-3 py-2.5 text-left font-semibold text-slate-700"
              [attr.aria-sort]="sortFor('paymentDate')"
            >
              @if (sort(); as current) {
                <app-sort-button
                  key="paymentDate"
                  label="Payment date"
                  [sort]="current"
                  [firstDescending]="true"
                  (sortChange)="sortChange.emit($event)"
                />
              } @else {
                Payment date
              }
            </th>
            <th scope="col" class="px-3 py-2.5 text-left font-semibold text-slate-700">Type</th>
            <th scope="col" class="px-3 py-2.5 text-left font-semibold text-slate-700">
              Sub order no.
            </th>
            <th
              scope="col"
              class="px-3 py-2.5 text-left font-semibold text-slate-700"
              [attr.aria-sort]="sortFor('orderDate')"
            >
              @if (sort(); as current) {
                <app-sort-button
                  key="orderDate"
                  label="Order date"
                  [sort]="current"
                  [firstDescending]="true"
                  (sortChange)="sortChange.emit($event)"
                />
              } @else {
                Order date
              }
            </th>
            <th
              scope="col"
              class="px-3 py-2.5 text-right font-semibold text-slate-700"
              [attr.aria-sort]="sortFor('settlementAmount')"
            >
              @if (sort(); as current) {
                <app-sort-button
                  key="settlementAmount"
                  label="Settlement amount"
                  [sort]="current"
                  [firstDescending]="true"
                  (sortChange)="sortChange.emit($event)"
                />
              } @else {
                Settlement amount
              }
            </th>
            @for (column of amountColumns; track column.key) {
              <th scope="col" class="px-3 py-2.5 text-right font-semibold text-slate-700">
                {{ column.label }}
              </th>
            }
            <th scope="col" class="px-3 py-2.5 text-left font-semibold text-slate-700">Match</th>
            <th scope="col" class="px-3 py-2.5 text-left font-semibold text-slate-700">
              Source import
            </th>
            @if (action()) {
              <th scope="col" class="px-3 py-2.5 text-left font-semibold text-slate-700">
                <span class="sr-only">Actions</span>
              </th>
            }
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-200">
          @for (entry of entries(); track entry.id) {
            <tr
              [attr.data-entry-id]="entry.id"
              [class.text-slate-500]="entry.supersededByEntryId !== null"
            >
              <th scope="row" class="px-3 py-3 text-left align-top font-normal">
                <span class="font-medium break-all text-slate-900">
                  {{ entry.transactionId ?? missing }}
                </span>
                @if (entry.isEstimate) {
                  <span class="block text-xs text-amber-800">Estimate</span>
                }
                @if (entry.supersededByEntryId !== null) {
                  <span class="block text-xs text-slate-600">Superseded (not summed)</span>
                }
              </th>
              <td class="px-3 py-3 align-top whitespace-nowrap">
                {{ entry.paymentDate | displayDate }}
              </td>
              <td class="px-3 py-3 align-top">
                <span class="block whitespace-nowrap">
                  {{ entryTypeLabel(entry.entryType) }}
                </span>
                @if (entry.sheetName) {
                  <span class="block text-xs text-slate-600">{{ entry.sheetName }}</span>
                }
              </td>
              <td class="px-3 py-3 align-top break-all">{{ entry.subOrderNo ?? missing }}</td>
              <td class="px-3 py-3 align-top whitespace-nowrap">
                {{ entry.orderDate | displayDate }}
              </td>
              <td
                class="px-3 py-3 text-right align-top font-medium tabular-nums"
                data-column="settlementAmount"
              >
                <app-amount [value]="entry.settlementAmount" />
              </td>
              @for (column of amountColumns; track column.key) {
                <td class="px-3 py-3 text-right align-top tabular-nums" [attr.data-column]="column.key">
                  <app-amount [value]="entry[column.key]" />
                </td>
              }
              <td class="px-3 py-3 align-top" data-column="match">
                <app-match-state-badge [state]="entry.match.state" [method]="entry.match.method" />
                @if (entry.match.state === 'matched' && showOrderLink() && entry.match.orderId) {
                  <a
                    [routerLink]="['/accounts', accountId(), 'orders', entry.match.orderId]"
                    class="mt-1 block rounded-sm text-xs font-medium break-all text-accent-700 underline hover:text-accent-800"
                  >
                    Order {{ entry.match.orderSubOrderNo ?? entry.match.orderId }}
                  </a>
                }
                @if (entry.match.method === 'manual' && entry.match.matchedBy) {
                  <span class="mt-1 block text-xs text-slate-600">
                    by {{ userName(entry.match.matchedBy) }},
                    {{ entry.match.matchedAt | displayDateTime }}
                  </span>
                }
                @if (entry.match.state === 'unmatched' && entry.match.autoMatchBlocked) {
                  <span class="mt-1 block text-xs text-slate-600">
                    Unmatched by hand: automatic matching skips it.
                  </span>
                }
              </td>
              <td class="px-3 py-3 align-top">
                <a
                  [routerLink]="['/imports', entry.importJob.id]"
                  class="rounded-sm text-xs break-all text-accent-700 underline hover:text-accent-800"
                >
                  {{ entry.importJob.originalFilename }}
                </a>
              </td>
              @if (action(); as rowAction) {
                <td class="px-3 py-3 align-top whitespace-nowrap">
                  @if (
                    rowAction === 'unmatch' &&
                    entry.match.state === 'matched' &&
                    entry.supersededByEntryId === null
                  ) {
                    <button
                      type="button"
                      class="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      (click)="actionRequested.emit(entry)"
                    >
                      Unmatch<span class="sr-only"> entry {{ entryName(entry) }}</span>
                    </button>
                  } @else if (
                    rowAction === 'match' &&
                    entry.match.state === 'unmatched' &&
                    entry.supersededByEntryId === null
                  ) {
                    <button
                      type="button"
                      class="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      (click)="actionRequested.emit(entry)"
                    >
                      Match to order…<span class="sr-only"> (entry {{ entryName(entry) }})</span>
                    </button>
                  }
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class SettlementEntriesTable {
  readonly entries = input.required<readonly SettlementEntry[]>();
  /** The account the entries belong to (for the order links). */
  readonly accountId = input.required<string>();
  readonly caption = input.required<string>();
  /** The current sort; `null` makes the headers plain text. */
  readonly sort = input<string | null>(null);
  /** Off on the order's own page, where the link would point to itself. */
  readonly showOrderLink = input(true);
  readonly action = input<SettlementRowAction | null>(null);

  readonly sortChange = output<string>();
  /** The row's action button was pressed. */
  readonly actionRequested = output<SettlementEntry>();

  protected readonly missing = MISSING;
  protected readonly entryTypeLabel = settlementEntryTypeLabel;
  protected readonly userName = userName;
  /** The other reported amounts, each its own column; never netted into the settlement amount. */
  protected readonly amountColumns: readonly { key: AmountKey; label: string }[] = [
    { key: 'saleAmount', label: 'Sale' },
    { key: 'returnAmount', label: 'Return' },
    { key: 'commissionAmount', label: 'Commission' },
    { key: 'shippingCharge', label: 'Shipping' },
    { key: 'tcsAmount', label: 'TCS' },
    { key: 'tdsAmount', label: 'TDS' },
    { key: 'recoveryAmount', label: 'Recovery' },
    { key: 'compensationAmount', label: 'Compensation' },
  ];

  protected sortFor(key: string): string | null {
    const sort = this.sort();
    return sort === null ? null : ariaSort(sort, key);
  }

  protected entryName(entry: SettlementEntry): string {
    return entry.transactionId ?? entry.subOrderNo ?? entry.id;
  }
}

type AmountKey =
  | 'saleAmount'
  | 'returnAmount'
  | 'commissionAmount'
  | 'shippingCharge'
  | 'tcsAmount'
  | 'tdsAmount'
  | 'recoveryAmount'
  | 'compensationAmount';
