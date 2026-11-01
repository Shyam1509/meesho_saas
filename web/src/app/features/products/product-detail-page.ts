import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, Subject, catchError, map, merge, of, startWith, switchMap } from 'rxjs';

import { describeApiError, toApiError } from '../../core/api/api-error';
import { userName } from '../../core/api/refs';
import { AuthStateService } from '../../core/auth/auth-state.service';
import {
  BUSINESS_TIME_ZONE,
  CostEntry,
  PRODUCT_COST_RULE,
  PRODUCT_NAME_MAX_LENGTH,
  ProductDetail,
  ProductStatus,
} from '../../core/products/product.models';
import { ProductsApiService } from '../../core/products/products-api.service';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import {
  MISSING,
  dateStringInTimeZone,
  formatDate,
  formatUnitCost,
} from '../../shared/format/format';
import {
  CountPipe,
  DisplayDatePipe,
  DisplayDateTimePipe,
  UnitCostPipe,
} from '../../shared/format/format.pipes';
import { errorMessage, maxLengthTrimmed, showError } from '../../shared/forms/form-helpers';
import { CostEntryDialog } from './cost-entry-dialog/cost-entry-dialog';

/** The API's id format (decimal BIGINT as a string). */
const ID_PATTERN = /^[1-9][0-9]{0,18}$/;

type DetailState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; product: ProductDetail };

/** Newest effective date first (the API's order), then the newest entry. */
export function sortCostHistory(entries: readonly CostEntry[]): CostEntry[] {
  return [...entries].sort(
    (a, b) =>
      b.effectiveFrom.localeCompare(a.effectiveFrom) ||
      b.createdAt.localeCompare(a.createdAt) ||
      b.id.length - a.id.length ||
      (b.id < a.id ? -1 : b.id > a.id ? 1 : 0),
  );
}

/**
 * `/products/:productId`: one product's fields, its unit cost history (newest first) and how many
 * of its orders have no cost. Any member can rename, archive and restore it; owners of its
 * workspace can add and delete unit costs (members see the history read-only). A malformed id, a
 * 400 or a 404 shows "not found".
 */
@Component({
  selector: 'app-product-detail-page',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    ConfirmDialog,
    CostEntryDialog,
    CountPipe,
    DisplayDatePipe,
    DisplayDateTimePipe,
    UnitCostPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-detail-page.html',
})
export class ProductDetailPage {
  /** From the route (`withComponentInputBinding()`). */
  readonly productId = input.required<string>();

  private readonly api = inject(ProductsApiService);
  private readonly auth = inject(AuthStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly reloads = new Subject<void>();
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly editNameButton = viewChild<ElementRef<HTMLButtonElement>>('editNameButton');

  protected readonly missing = MISSING;
  protected readonly costRule = PRODUCT_COST_RULE;
  protected readonly nameMaxLength = PRODUCT_NAME_MAX_LENGTH;
  protected readonly userName = userName;
  protected readonly showError = showError;
  protected readonly errorMessage = errorMessage;
  protected readonly state = signal<DetailState>({ kind: 'loading' });
  /** Today in India (the API's "today"), for marking the current and planned costs. */
  protected readonly today = dateStringInTimeZone(new Date(), BUSINESS_TIME_ZONE);

  protected readonly heading = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? `Product ${state.product.sku}` : 'Product details';
  });
  protected readonly history = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? sortCostHistory(state.product.costHistory) : [];
  });
  /**
   * The product's workspace (`workspaceId` from the API); `null` when the response has none, in
   * which case the page stays read-only for costs.
   */
  protected readonly workspaceId = computed(() => {
    const state = this.state();
    if (state.kind !== 'ready') {
      return null;
    }
    const id: unknown = (state.product as { workspaceId?: unknown }).workspaceId;
    return typeof id === 'string' && id.length > 0 ? id : null;
  });
  /** Owner of the workspace the product's account belongs to (from the signed-in memberships). */
  protected readonly isOwner = computed(() => {
    const workspaceId = this.workspaceId();
    return (
      workspaceId !== null &&
      this.auth.workspaces().some((w) => w.id === workspaceId && w.role === 'owner')
    );
  });

  /** Last success message, announced politely. */
  protected readonly notice = signal('');
  /** A refresh after a change failed: the numbers on screen may be stale. */
  protected readonly refreshError = signal<string | null>(null);

  // Name editing (any member).
  protected readonly editingName = signal(false);
  protected readonly savingName = signal(false);
  protected readonly nameError = signal<string | null>(null);
  protected readonly nameControl = new FormControl('', {
    nonNullable: true,
    validators: [maxLengthTrimmed(PRODUCT_NAME_MAX_LENGTH)],
  });
  protected readonly nameMessages = {
    maxlength: `Name must be at most ${PRODUCT_NAME_MAX_LENGTH} characters.`,
  };

  // Archive / restore (any member).
  protected readonly statusConfirm = signal<ProductStatus | null>(null);
  protected readonly statusPending = signal(false);
  protected readonly statusError = signal<string | null>(null);

  // Unit costs (owners).
  protected readonly addingCost = signal(false);
  protected readonly deleteTarget = signal<CostEntry | null>(null);
  protected readonly deletePending = signal(false);
  protected readonly deleteError = signal<string | null>(null);

  constructor() {
    merge(toObservable(this.productId), this.reloads.pipe(map(() => this.productId())))
      .pipe(
        switchMap((id) => this.load(id)),
        takeUntilDestroyed(),
      )
      .subscribe((state) => {
        this.state.set(state);
        this.editingName.set(false);
      });
  }

  protected retry(): void {
    this.reloads.next();
  }

  /** "Current" for the cost in effect today, "Planned" for one that starts later. */
  protected costBadge(entry: CostEntry, product: ProductDetail): 'current' | 'planned' | null {
    if (entry.effectiveFrom > this.today) {
      return 'planned';
    }
    return product.currentCost?.effectiveFrom === entry.effectiveFrom ? 'current' : null;
  }

  // --- Name ---

  protected startEditName(product: ProductDetail): void {
    this.notice.set('');
    this.nameError.set(null);
    this.nameControl.reset(product.name ?? '');
    this.editingName.set(true);
    afterNextRender(() => this.nameInput()?.nativeElement.focus(), { injector: this.injector });
  }

  protected cancelEditName(): void {
    if (this.savingName()) {
      return;
    }
    this.editingName.set(false);
    this.focusEditNameButton();
  }

  /** `PATCH { name }`; a blank name clears it (`null`). Nothing is sent when nothing changed. */
  protected saveName(product: ProductDetail): void {
    if (this.savingName()) {
      return;
    }
    this.nameError.set(null);
    if (this.nameControl.invalid) {
      this.nameControl.markAsTouched();
      this.nameInput()?.nativeElement.focus();
      return;
    }
    const name = this.nameControl.value.trim() || null;
    if (name === product.name) {
      this.editingName.set(false);
      this.focusEditNameButton();
      return;
    }
    this.savingName.set(true);
    this.api
      .update(product.id, { name })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.savingName.set(false);
          this.editingName.set(false);
          this.setProduct(updated);
          this.notice.set(name === null ? 'Removed the product name.' : 'Saved the product name.');
          this.focusEditNameButton();
        },
        error: (error: unknown) => {
          this.savingName.set(false);
          const reasons = toApiError(error).reasonsFor('name');
          if (reasons.length > 0) {
            this.nameControl.setErrors({ server: reasons.join(' ') });
            this.nameControl.markAsTouched();
          } else {
            this.nameError.set(describeApiError(error));
          }
          afterNextRender(() => this.nameInput()?.nativeElement.focus(), {
            injector: this.injector,
          });
        },
      });
  }

  // --- Archive / restore ---

  protected askStatus(status: ProductStatus): void {
    this.notice.set('');
    this.statusError.set(null);
    this.statusConfirm.set(status);
  }

  protected cancelStatus(): void {
    if (!this.statusPending()) {
      this.statusConfirm.set(null);
      this.statusError.set(null);
    }
  }

  protected confirmStatus(product: ProductDetail): void {
    const status = this.statusConfirm();
    if (status === null || this.statusPending()) {
      return;
    }
    this.statusPending.set(true);
    this.statusError.set(null);
    this.api
      .update(product.id, { status })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.statusPending.set(false);
          this.statusConfirm.set(null);
          this.setProduct(updated);
          this.notice.set(
            updated.status === 'archived'
              ? `Archived ${updated.sku}. It is hidden from the default product list; its orders and unit costs still count.`
              : `Restored ${updated.sku}.`,
          );
        },
        error: (error: unknown) => {
          this.statusPending.set(false);
          this.statusError.set(describeApiError(error));
        },
      });
  }

  // --- Unit costs ---

  protected openAddCost(): void {
    if (!this.isOwner()) {
      return;
    }
    this.notice.set('');
    this.addingCost.set(true);
  }

  protected onCostAdded(entry: CostEntry): void {
    this.addingCost.set(false);
    this.notice.set(
      `Added a unit cost of ${formatUnitCost(entry.unitCost)} from ${formatDate(entry.effectiveFrom)}.`,
    );
    this.refreshProduct();
  }

  protected askDelete(entry: CostEntry): void {
    if (!this.isOwner()) {
      return;
    }
    this.notice.set('');
    this.deleteError.set(null);
    this.deleteTarget.set(entry);
  }

  protected cancelDelete(): void {
    if (!this.deletePending()) {
      this.deleteTarget.set(null);
      this.deleteError.set(null);
    }
  }

  protected confirmDelete(product: ProductDetail): void {
    const entry = this.deleteTarget();
    if (entry === null || this.deletePending()) {
      return;
    }
    this.deletePending.set(true);
    this.deleteError.set(null);
    this.api
      .deleteCost(product.id, entry.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.deletePending.set(false);
          this.deleteTarget.set(null);
          this.notice.set(
            `Deleted the unit cost of ${formatUnitCost(entry.unitCost)} from ${formatDate(entry.effectiveFrom)}.`,
          );
          this.refreshProduct();
        },
        error: (error: unknown) => {
          this.deletePending.set(false);
          this.deleteError.set(describeApiError(error));
        },
      });
  }

  protected deleteMessage(entry: CostEntry): string {
    return `Orders dated from ${formatDate(entry.effectiveFrom)} until the next cost will use the earlier cost instead, or have an unknown cost if there is none. This can’t be undone; you can add the cost again.`;
  }

  /** Fetches the product again (its current cost and orders without cost may have changed). */
  private refreshProduct(): void {
    const state = this.state();
    if (state.kind !== 'ready') {
      return;
    }
    this.refreshError.set(null);
    this.api
      .get(state.product.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (product) => this.setProduct(product),
        error: (error: unknown) =>
          this.refreshError.set(
            `The product could not be refreshed, so the numbers shown may be out of date. ${describeApiError(error)}`,
          ),
      });
  }

  private setProduct(product: ProductDetail): void {
    this.state.update((state) => (state.kind === 'ready' ? { ...state, product } : state));
  }

  private focusEditNameButton(): void {
    afterNextRender(() => this.editNameButton()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  private load(productId: string): Observable<DetailState> {
    if (!ID_PATTERN.test(productId)) {
      return of<DetailState>({ kind: 'not-found' });
    }
    return this.api.get(productId).pipe(
      map((product): DetailState => ({ kind: 'ready', product })),
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
