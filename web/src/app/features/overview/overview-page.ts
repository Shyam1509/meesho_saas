import { ChangeDetectionStrategy, Component } from '@angular/core';

import { ApiStatus } from './api-status/api-status';

@Component({
  selector: 'app-overview-page',
  imports: [ApiStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Overview</h1>
    <p class="mt-2 text-sm text-slate-600">Sales and settlement dashboards arrive in Milestone 7.</p>
    <app-api-status class="mt-6 block max-w-xl" />
  `,
})
export class OverviewPage {}
