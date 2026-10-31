import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

import { SelectedSellerAccountService } from '../../core/seller-accounts/selected-seller-account.service';
import { AS_REPORTED_NOTE } from '../../core/settlements/settlement.models';
import { SellerAccountPicker } from '../../shared/seller-account-picker/seller-account-picker';
import { readOneOf } from '../../shared/url-state/url-state';
import { ReconciliationTab } from './reconciliation-tab/reconciliation-tab';
import { SettlementEntriesTab } from './settlement-entries-tab/settlement-entries-tab';

export type SettlementsTab = 'entries' | 'reconciliation';

const TABS: readonly { id: SettlementsTab; label: string }[] = [
  { id: 'entries', label: 'Entries' },
  { id: 'reconciliation', label: 'Reconciliation' },
];

/**
 * `/settlements`: the selected seller account's settlement ledger ("Entries") and its
 * reconciliation with the orders ("Reconciliation"), as tabs. The selected tab is the `tab` query
 * parameter (absent = Entries), so it can be bookmarked and the back button returns to it. Tabs
 * follow the WAI-ARIA pattern: arrow keys, Home and End move between them.
 */
@Component({
  selector: 'app-settlements-page',
  imports: [SellerAccountPicker, SettlementEntriesTab, ReconciliationTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settlements-page.html',
})
export class SettlementsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly selection = inject(SelectedSellerAccountService);

  protected readonly note = AS_REPORTED_NOTE;
  protected readonly tabs = TABS;
  protected readonly tab = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => readOneOf(params, 'tab', TABS.map((t) => t.id)) ?? 'entries'),
    ),
    { requireSync: true },
  );
  /** True while the URL drops the old account's page number after an account switch. */
  private readonly switchingAccount = signal(false);
  /**
   * The selected account as a one-item list, so the tabs are re-created for another account (and
   * not before its URL is ready, so no request goes out for the old page number).
   */
  protected readonly accounts = computed(() => {
    const account = this.selection.selected();
    return account && !this.switchingAccount() ? [account] : [];
  });

  protected selectTab(tab: SettlementsTab): void {
    if (tab === this.tab()) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'entries' ? null : tab },
      queryParamsHandling: 'merge',
    });
  }

  /** Left / Right / Home / End move to (and select) another tab, keeping focus on the tab list. */
  protected onTabKeydown(event: KeyboardEvent): void {
    const index = TABS.findIndex((t) => t.id === this.tab());
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % TABS.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + TABS.length) % TABS.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const tablist = (event.target as HTMLElement).closest('[role="tablist"]');
    tablist?.querySelector<HTMLElement>(`#settlements-tab-${TABS[next].id}`)?.focus();
    this.selectTab(TABS[next].id);
  }

  /** Another account: back to the first page of its entries (the other filters are kept). */
  protected onAccountChange(): void {
    if (!this.route.snapshot.queryParamMap.has('page')) {
      return;
    }
    this.switchingAccount.set(true);
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { page: null },
        queryParamsHandling: 'merge',
      })
      .finally(() => this.switchingAccount.set(false));
  }
}
