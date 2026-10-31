import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { OrderSummary } from '../../../core/orders/order.models';
import { Amount } from '../../../shared/amount/amount';
import { MISSING } from '../../../shared/format/format';
import {
  CountPipe,
  DisplayDatePipe,
  DisplayDateTimePipe,
} from '../../../shared/format/format.pipes';
import { SortButton, ariaSort } from '../../../shared/sort/sort';

/**
 * Orders as a table: sub order no. (links to the order), order date, product, quantity, Meesho's
 * current status, the two reported prices and what has been settled so far (as reported). With
 * `sort` set, the sub order, date and status headers sort the list (server side, via
 * `sortChange`).
 */
@Component({
  selector: 'app-orders-table',
  imports: [RouterLink, Amount, CountPipe, DisplayDatePipe, DisplayDateTimePipe, SortButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table class="min-w-full divide-y divide-slate-200 text-sm" data-testid="orders-table">
        <caption class="sr-only">
          {{ caption() }}
        </caption>
        <thead class="bg-slate-50">
          <tr>
            <th
              scope="col"
              class="px-4 py-2.5 text-left font-semibold text-slate-700"
              [attr.aria-sort]="sortFor('subOrderNo')"
            >
              @if (sort(); as current) {
                <app-sort-button
                  key="subOrderNo"
                  label="Sub order no."
                  [sort]="current"
                  (sortChange)="sortChange.emit($event)"
                />
              } @else {
                Sub order no.
              }
            </th>
            <th
              scope="col"
              class="px-4 py-2.5 text-left font-semibold text-slate-700"
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
            <th scope="col" class="px-4 py-2.5 text-left font-semibold text-slate-700">Product</th>
            <th scope="col" class="px-4 py-2.5 text-right font-semibold text-slate-700">Qty</th>
            <th
              scope="col"
              class="px-4 py-2.5 text-left font-semibold text-slate-700"
              [attr.aria-sort]="sortFor('currentStatus')"
            >
              @if (sort(); as current) {
                <app-sort-button
                  key="currentStatus"
                  label="Status"
                  [sort]="current"
                  (sortChange)="sortChange.emit($event)"
                />
              } @else {
                Status
              }
            </th>
            <th scope="col" class="px-4 py-2.5 text-right font-semibold text-slate-700">
              Listed price
            </th>
            <th scope="col" class="px-4 py-2.5 text-right font-semibold text-slate-700">
              Discounted price
            </th>
            <th scope="col" class="px-4 py-2.5 text-right font-semibold text-slate-700">
              Settled (as reported)
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-200">
          @for (order of orders(); track order.id) {
            <tr [attr.data-order-id]="order.id">
              <th scope="row" class="px-4 py-3 text-left align-top font-normal">
                <a
                  [routerLink]="['/accounts', accountId(), 'orders', order.id]"
                  class="rounded-sm font-medium break-all text-accent-700 underline hover:text-accent-800"
                >
                  {{ order.subOrderNo }}
                </a>
                @if (order.orderNo) {
                  <span class="block text-xs text-slate-600">Order {{ order.orderNo }}</span>
                }
              </th>
              <td class="px-4 py-3 align-top whitespace-nowrap text-slate-700">
                {{ order.orderDate | displayDate }}
              </td>
              <td class="px-4 py-3 align-top text-slate-700">
                <span class="block max-w-xs truncate" [attr.title]="order.productName">
                  {{ order.productName ?? missing }}
                </span>
                <span class="block text-xs text-slate-600">
                  SKU {{ order.sku ?? missing }} · Size {{ order.size ?? missing }}
                </span>
              </td>
              <td class="px-4 py-3 text-right align-top text-slate-900 tabular-nums">
                {{ order.quantity | count }}
              </td>
              <td class="px-4 py-3 align-top text-slate-700">
                <span class="block font-medium text-slate-900">
                  {{ order.currentStatus ?? missing }}
                </span>
                @if (order.currentStatusObservedAt) {
                  <span class="block text-xs whitespace-nowrap text-slate-600">
                    as of
                    <time [attr.datetime]="order.currentStatusObservedAt">
                      {{ order.currentStatusObservedAt | displayDateTime }}
                    </time>
                  </span>
                }
              </td>
              <td class="px-4 py-3 text-right align-top text-slate-900 tabular-nums">
                <app-amount [value]="order.supplierListedPrice" />
              </td>
              <td class="px-4 py-3 text-right align-top text-slate-900 tabular-nums">
                <app-amount [value]="order.supplierDiscountedPrice" />
              </td>
              <td
                class="px-4 py-3 text-right align-top tabular-nums"
                data-testid="order-settled"
              >
                @if (order.settlement.entryCount === 0) {
                  <span class="text-xs font-medium whitespace-nowrap text-amber-800">
                    No settlement matched
                  </span>
                } @else {
                  <app-amount class="text-slate-900" [value]="order.settlement.amount" />
                  <span class="block text-xs whitespace-nowrap text-slate-600">
                    {{ order.settlement.entryCount | count }}
                    {{ order.settlement.entryCount === 1 ? 'entry' : 'entries' }}
                  </span>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class OrdersTable {
  readonly orders = input.required<readonly OrderSummary[]>();
  /** The account the orders belong to (for the detail links). */
  readonly accountId = input.required<string>();
  readonly caption = input.required<string>();
  /** The current sort; `null` makes the headers plain text. */
  readonly sort = input<string | null>(null);

  readonly sortChange = output<string>();

  protected readonly missing = MISSING;

  protected sortFor(key: string): string | null {
    const sort = this.sort();
    return sort === null ? null : ariaSort(sort, key);
  }
}
