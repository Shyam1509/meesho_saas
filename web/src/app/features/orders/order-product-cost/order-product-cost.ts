import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { OrderProductCost, ProductCostState } from '../../../core/orders/order.models';
import {
  MISSING,
  formatCount,
  formatDate,
  formatInr,
  formatUnitCost,
} from '../../../shared/format/format';

/**
 * An order's product cost (unit cost effective on the order date × quantity):
 * - `known`: "₹500.00" with the hint "2 × ₹250.00 from 1 Oct 2026";
 * - `unknown`: amber "Unknown cost", linking to the product so a cost can be added;
 * - `no_product` with a SKU: "No product yet" (orders imported before products existed, until
 *   "Sync from orders" creates it), linking to Products & costs;
 * - `no_product` without a SKU: "No SKU".
 * A missing cost is never shown as ₹0.00. Put it in a right-aligned, `tabular-nums` cell.
 */
@Component({
  selector: 'app-order-product-cost',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', '[attr.data-cost-state]': 'state()' },
  template: `
    @switch (state()) {
      @case ('known') {
        @if (totalText(); as total) {
          <span class="whitespace-nowrap text-slate-900">{{ total }}</span>
        } @else {
          <span aria-hidden="true">{{ dash }}</span><span class="sr-only"> not available</span>
        }
        <span class="block text-xs whitespace-nowrap text-slate-600" data-testid="product-cost-hint">
          {{ hint() }}
        </span>
      }
      @case ('unknown') {
        @if (productId(); as id) {
          <a
            [routerLink]="['/products', id]"
            class="rounded-sm text-xs font-medium whitespace-nowrap text-amber-800 underline hover:text-amber-900"
          >
            Unknown cost<span class="sr-only">: add a unit cost for this product</span>
          </a>
        } @else {
          <span class="text-xs font-medium whitespace-nowrap text-amber-800">Unknown cost</span>
        }
        @if (detailed()) {
          <span class="block text-xs text-slate-600">
            No unit cost is effective on the order date, so this order’s cost is unknown (not ₹0).
          </span>
        }
      }
      @case ('no_product') {
        @if (hasSku()) {
          <a
            routerLink="/products"
            class="rounded-sm text-xs font-medium whitespace-nowrap text-amber-800 underline hover:text-amber-900"
          >
            No product yet<span class="sr-only">: open Products &amp; costs</span>
          </a>
          <span class="block text-xs whitespace-nowrap text-slate-600">
            Use “Sync from orders”
          </span>
          @if (detailed()) {
            <span class="block text-xs text-slate-600">
              No product exists for this SKU yet, so the cost is unknown (not ₹0). “Sync from
              orders” on Products &amp; costs creates it.
            </span>
          }
        } @else {
          <span class="text-xs font-medium whitespace-nowrap text-slate-600">No SKU</span>
          @if (detailed()) {
            <span class="block text-xs text-slate-600">
              The order has no SKU, so it has no product and no cost.
            </span>
          }
        }
      }
      @default {
        <span aria-hidden="true">{{ dash }}</span><span class="sr-only"> not available</span>
      }
    }
  `,
})
export class OrderProductCostView {
  /** The order's `productCost`; missing (older data) shows "—". */
  readonly cost = input.required<OrderProductCost | null | undefined>();
  readonly quantity = input<number | null>(null);
  /** The order's product, for the "Unknown cost" link. */
  readonly productId = input<string | null>(null);
  /** The order's SKU: tells "No product yet" (a SKU without a product) from "No SKU". */
  readonly sku = input<string | null>(null);
  /** Adds a sentence explaining an unknown cost or a missing SKU (order detail page). */
  readonly detailed = input(false);

  protected readonly dash = MISSING;
  protected readonly state = computed<ProductCostState | null>(() => this.cost()?.state ?? null);
  protected readonly hasSku = computed(() => (this.sku() ?? '').trim() !== '');
  /** The total, or `null` when the API sent none (e.g. no quantity). */
  protected readonly totalText = computed(() => {
    const text = formatInr(this.cost()?.total);
    return text === MISSING ? null : text;
  });
  /** "2 × ₹250.00 from 1 Oct 2026", or "₹250.00 per unit from 1 Oct 2026" without a quantity. */
  protected readonly hint = computed(() => {
    const cost = this.cost();
    const unit = formatUnitCost(cost?.unitCost);
    const from = cost?.effectiveFrom ? ` from ${formatDate(cost.effectiveFrom)}` : '';
    const quantity = this.quantity();
    return quantity === null
      ? `${unit} per unit${from}`
      : `${formatCount(quantity)} × ${unit}${from}`;
  });
}
