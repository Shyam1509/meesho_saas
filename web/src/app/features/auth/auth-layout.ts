import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PRODUCT_NAME } from '../../core/product';

/** Centred card for the pages outside the app shell (sign-in, registration). */
@Component({
  selector: 'app-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <main
      id="main-content"
      class="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10"
    >
      <p class="text-center text-base font-semibold text-slate-900">{{ productName }}</p>
      <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <ng-content />
      </div>
      <ng-content select="[authFooter]" />
    </main>
  `,
})
export class AuthLayout {
  protected readonly productName = PRODUCT_NAME;
}
