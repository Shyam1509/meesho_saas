import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  ACCOUNT_LEVEL_DATE_NOTE,
  COMPONENTS_NOTE,
  DashboardSettlements,
  SETTLEMENT_COMPONENTS,
  TAX_COMPONENTS,
  TAX_NOTE,
} from '../../../core/dashboard/dashboard.models';
import { settlementEntryTypeLabel } from '../../../core/settlements/settlement.models';
import { Amount } from '../../../shared/amount/amount';
import { CountPipe } from '../../../shared/format/format.pipes';
import { LinkContext, settlementsLink, settlementsNarrowedByStatus } from '../dashboard-links';
import { DrillLink } from '../drill-link/drill-link';
import { TableRegion } from '../../../shared/table-region/table-region';

/**
 * The settlement amount by entry type (each type links to its entries), the informational
 * components (already inside the settlement amount, never deducted again) and TCS / TDS apart.
 */
@Component({
  selector: 'app-settlement-breakdown',
  imports: [Amount, CountPipe, DrillLink, TableRegion],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let s = settlements();
    <div class="grid gap-6 lg:grid-cols-2">
      <div
        appTableRegion="Settlement amount by entry type"
        class="overflow-x-auto"
      >
        <table class="min-w-full text-sm" data-testid="by-type-table">
          <caption class="pb-2 text-left text-sm font-semibold text-slate-900">
            By entry type
          </caption>
          <thead>
            <tr class="border-b border-slate-200 text-left text-slate-700">
              <th scope="col" class="py-2 pr-4 font-semibold">Entry type</th>
              <th scope="col" class="py-2 pr-4 text-right font-semibold">Entries</th>
              <th scope="col" class="py-2 text-right font-semibold">Settlement amount</th>
            </tr>
          </thead>
          <tbody>
            @for (row of s.byType; track row.entryType) {
              <tr class="border-b border-slate-100" [attr.data-entry-type]="row.entryType">
                <th scope="row" class="py-2 pr-4 text-left font-normal text-slate-900">
                  {{ label(row.entryType) }}
                </th>
                <td class="py-2 pr-4 text-right tabular-nums">{{ row.count | count }}</td>
                <td class="py-2 text-right tabular-nums">
                  <app-drill-link
                    [link]="typeLink(row.entryType)"
                    [description]="'open the ' + label(row.entryType) + ' entries'"
                    ><app-amount [value]="row.amount"
                  /></app-drill-link>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="3" class="py-3 text-slate-600">No settlement entries in this range.</td>
              </tr>
            }
          </tbody>
          @if (s.byType.length > 0) {
            <tfoot>
              <tr class="font-semibold text-slate-900">
                <th scope="row" class="py-2 pr-4 text-left">Total</th>
                <td class="py-2 pr-4 text-right tabular-nums">{{ s.count | count }}</td>
                <td class="py-2 text-right tabular-nums"><app-amount [value]="s.amount" /></td>
              </tr>
            </tfoot>
          }
        </table>
        @if (orderDateBasis()) {
          <p class="mt-2 text-xs text-slate-600">{{ accountLevelNote }}</p>
        }
        @if (narrowed()) {
          <p class="mt-1 text-xs text-slate-600" data-testid="status-filter-note">
            By order date, the status filter narrows these amounts to the chosen statuses’ orders
            (account-level and unmatched entries count in full). The settlements list has no status
            filter, so the amounts are not linked to it.
          </p>
        }
      </div>

      <div class="space-y-6">
        <div
          appTableRegion="Settlement components (as reported)"
          class="overflow-x-auto"
        >
          <table class="min-w-full text-sm" data-testid="components-table">
            <caption class="pb-1 text-left">
              <span class="block text-sm font-semibold text-slate-900">Components (as reported)</span>
              <span class="block text-xs text-slate-600">{{ componentsNote }}</span>
            </caption>
            <tbody>
              @for (c of components; track c.key) {
                <tr class="border-b border-slate-100" [attr.data-component]="c.key">
                  <th scope="row" class="py-2 pr-4 text-left font-normal text-slate-900">
                    {{ c.label }}
                  </th>
                  <td class="py-2 text-right tabular-nums">
                    <app-amount [value]="s.components[c.key]" />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div
          appTableRegion="TCS and TDS"
          class="overflow-x-auto"
        >
          <table class="min-w-full text-sm" data-testid="tax-table">
            <caption class="pb-1 text-left">
              <span class="block text-sm font-semibold text-slate-900">TCS and TDS</span>
              <span class="block text-xs text-slate-600">{{ componentsNote }} {{ taxNote }}</span>
            </caption>
            <tbody>
              @for (c of taxes; track c.key) {
                <tr class="border-b border-slate-100" [attr.data-component]="c.key">
                  <th scope="row" class="py-2 pr-4 text-left font-normal text-slate-900">
                    {{ c.label }}
                  </th>
                  <td class="py-2 text-right tabular-nums">
                    <app-amount [value]="s.components[c.key]" />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class SettlementBreakdown {
  readonly settlements = input.required<DashboardSettlements>();
  readonly ctx = input.required<LinkContext>();

  protected readonly components = SETTLEMENT_COMPONENTS;
  protected readonly taxes = TAX_COMPONENTS;
  protected readonly componentsNote = COMPONENTS_NOTE;
  protected readonly taxNote = TAX_NOTE;
  protected readonly accountLevelNote = ACCOUNT_LEVEL_DATE_NOTE;
  protected readonly label = settlementEntryTypeLabel;
  protected readonly orderDateBasis = computed(() => this.ctx().basis === 'order_date');
  protected readonly narrowed = computed(() => settlementsNarrowedByStatus(this.ctx()));

  protected typeLink(entryType: string) {
    return settlementsLink(this.ctx(), { entryType });
  }
}
