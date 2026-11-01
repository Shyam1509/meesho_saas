import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, switchMap } from 'rxjs';

import { HealthApiService } from '../../../core/health/health-api.service';
import { HealthCheckResult } from '../../../core/health/health.models';

export type ApiStatusState = 'loading' | HealthCheckResult['kind'];

/** "API status" panel: checks `GET /health` on load and on "Check again". `compact`: a smaller panel. */
@Component({
  selector: 'app-api-status',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './api-status.html',
})
export class ApiStatus {
  /** Less padding and smaller type, for a panel at the bottom of a page. */
  readonly compact = input(false);

  private readonly healthApi = inject(HealthApiService);
  private readonly checkRequests = new Subject<void>();

  protected readonly loading = signal(true);
  protected readonly result = signal<HealthCheckResult | null>(null);
  protected readonly checkedAt = signal<Date | null>(null);

  protected readonly state = computed<ApiStatusState>(() => {
    const result = this.result();
    return this.loading() || result === null ? 'loading' : result.kind;
  });

  /** Reason text, only for the unreachable state. */
  protected readonly unreachableReason = computed(() => {
    const result = this.result();
    return result?.kind === 'unreachable' ? result.reason : null;
  });

  constructor() {
    this.checkRequests
      .pipe(
        switchMap(() => this.healthApi.checkHealth()),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.result.set(result);
        this.checkedAt.set(new Date());
        this.loading.set(false);
      });
    this.runCheck();
  }

  /** "Check again". Ignored while a check is in flight (the button stays focusable). */
  protected checkAgain(): void {
    if (this.loading()) {
      return;
    }
    this.runCheck();
  }

  private runCheck(): void {
    this.loading.set(true);
    this.checkRequests.next();
  }
}
