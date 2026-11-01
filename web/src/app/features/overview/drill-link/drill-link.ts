import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SelectedSellerAccountService } from '../../../core/seller-accounts/selected-seller-account.service';
import { DrillLink as DrillLinkTarget } from '../dashboard-links';

/**
 * A dashboard number as a link to the list behind it, or plain text when there is no such list
 * (`link` is `null`). Following it first selects the link's seller account, because the lists show
 * the shared selected account. `description` is read after the number by screen readers.
 */
@Component({
  selector: 'app-drill-link',
  imports: [RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #content><ng-content /></ng-template>
    @if (link(); as l) {
      <a
        class="rounded-sm text-accent-700 underline decoration-accent-700/40 underline-offset-2 hover:text-accent-800 hover:decoration-accent-800"
        [routerLink]="l.path"
        [queryParams]="l.queryParams"
        [attr.data-drill]="l.path"
        (click)="follow(l)"
        ><ng-container [ngTemplateOutlet]="content" />@if (description()) {<span class="sr-only" data-drill-description>
            ({{ description() }})</span
          >}</a
      >
    } @else {
      <ng-container [ngTemplateOutlet]="content" />
    }
  `,
})
export class DrillLink {
  readonly link = input.required<DrillLinkTarget | null>();
  /** e.g. "open these orders". */
  readonly description = input('');

  private readonly selection = inject(SelectedSellerAccountService);

  protected follow(link: DrillLinkTarget): void {
    if (link.accountId !== null && link.accountId !== this.selection.selectedId()) {
      this.selection.select(link.accountId);
    }
  }
}
