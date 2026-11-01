import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { TrendBucket, TrendGranularity } from '../../../core/dashboard/dashboard.models';
import { Amount } from '../../../shared/amount/amount';
import { addDays } from '../../../shared/date-presets/date-presets';
import { formatCount, formatDateRange, formatInr } from '../../../shared/format/format';
import { CountPipe } from '../../../shared/format/format.pipes';

export type TrendMetric =
  | 'settlementAmount'
  | 'orderValueDiscounted'
  | 'productCostKnown'
  | 'expenses'
  | 'orders';

export const TREND_METRICS: readonly { id: TrendMetric; label: string }[] = [
  { id: 'settlementAmount', label: 'Settlement amount (as reported)' },
  { id: 'orderValueDiscounted', label: 'Order value (as reported)' },
  { id: 'productCostKnown', label: 'Product cost (known)' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'orders', label: 'Orders' },
];

/** A plotted bucket: `value` is `null` when the bucket has no rows (a gap, never 0). */
export interface TrendPoint {
  index: number;
  bucketStart: string;
  label: string;
  /** The period runs past the date range (a week or month cut by `from` / `to`). */
  partial: boolean;
  value: number | null;
  /** The value as text (INR / count / "no data"). */
  text: string;
  x: number;
  y: number | null;
}

// Chart geometry (SVG user units; the SVG scales to its container's width).
const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 12, right: 16, bottom: 28, left: 72 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
/** At most this many x-axis labels, so they never collide. */
const MAX_X_LABELS = 7;

const DAY_LABEL = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const MONTH_LABEL = new Intl.DateTimeFormat('en-IN', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const COMPACT_INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const COMPACT_COUNT = new Intl.NumberFormat('en-IN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** "5 Oct" for a day or the week starting that day; "Oct 2026" for a month. */
export function bucketLabel(bucketStart: string, granularity: TrendGranularity): string {
  const [y, m, d] = bucketStart.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) {
    return bucketStart;
  }
  return granularity === 'month' ? MONTH_LABEL.format(date) : DAY_LABEL.format(date);
}

/** The last day of the bucket starting `bucketStart`: the day itself, the Sunday, or the month's end. */
export function bucketEnd(bucketStart: string, granularity: TrendGranularity): string {
  if (granularity === 'week') {
    return addDays(bucketStart, 6);
  }
  if (granularity === 'month') {
    const [y, m] = bucketStart.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  return bucketStart;
}

/** True when the bucket starts before `from` or ends after `to` (only part of it is counted). */
export function isPartialBucket(
  bucketStart: string,
  granularity: TrendGranularity,
  from: string,
  to: string,
): boolean {
  return (
    (from !== '' && bucketStart < from) || (to !== '' && bucketEnd(bucketStart, granularity) > to)
  );
}

/** A "nice" step (1, 2, 2.5 or 5 × 10ⁿ) of about `rough`. */
function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/** Axis bounds and ticks covering every value and 0. */
export function axisTicks(values: readonly number[]): { lo: number; hi: number; ticks: number[] } {
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) {
    max = min + 1;
  }
  const step = niceStep((max - min) / 4);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2; t += step) {
    ticks.push(Math.abs(t) < step / 1e6 ? 0 : t);
  }
  return { lo: min, hi: max, ticks };
}

/**
 * The trend as an accessible inline SVG line chart (one metric at a time, picked with radio
 * buttons), with a "Show data table" toggle listing every bucket and metric. Buckets without rows
 * have no value: the line breaks there (a gap) instead of dropping to 0, and the table shows "—".
 */
@Component({
  selector: 'app-trend-chart',
  imports: [Amount, CountPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './trend-chart.html',
})
export class TrendChart {
  readonly buckets = input.required<readonly TrendBucket[]>();
  readonly granularity = input.required<TrendGranularity>();
  readonly from = input('');
  readonly to = input('');

  protected readonly metrics = TREND_METRICS;
  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;
  protected readonly pad = PAD;
  protected readonly plotRight = WIDTH - PAD.right;
  protected readonly plotBottom = PAD.top + PLOT_H;

  protected readonly metric = signal<TrendMetric>('settlementAmount');
  protected readonly showTable = signal(false);

  protected readonly metricLabel = computed(
    () => TREND_METRICS.find((m) => m.id === this.metric())?.label ?? '',
  );
  protected readonly periodHeading = computed(() => {
    switch (this.granularity()) {
      case 'week':
        return 'Week starting';
      case 'month':
        return 'Month';
      default:
        return 'Day';
    }
  });

  private readonly values = computed<(number | null)[]>(() => {
    const metric = this.metric();
    return this.buckets().map((b) => {
      if (metric === 'orders') {
        return Number.isFinite(b.orders) ? b.orders : null;
      }
      const raw = b[metric];
      const n = raw === null ? NaN : Number(raw);
      return Number.isFinite(n) ? n : null;
    });
  });

  protected readonly axis = computed(() =>
    axisTicks(this.values().filter((v): v is number => v !== null)),
  );

  protected readonly points = computed<TrendPoint[]>(() => {
    const buckets = this.buckets();
    const values = this.values();
    const { lo, hi } = this.axis();
    const metric = this.metric();
    const granularity = this.granularity();
    const [from, to] = [this.from(), this.to()];
    const n = buckets.length;
    return buckets.map((b, i) => {
      const value = values[i];
      return {
        index: i,
        bucketStart: b.bucketStart,
        label: bucketLabel(b.bucketStart, granularity),
        partial: isPartialBucket(b.bucketStart, granularity, from, to),
        value,
        text:
          value === null
            ? 'no data'
            : metric === 'orders'
              ? formatCount(value)
              : formatInr(b[metric]),
        x: PAD.left + (n === 1 ? PLOT_W / 2 : (i * PLOT_W) / (n - 1)),
        y: value === null ? null : PAD.top + PLOT_H * (1 - (value - lo) / (hi - lo)),
      };
    });
  });

  /** One path per run of buckets with a value; a bucket without rows breaks the line. */
  protected readonly segments = computed<string[]>(() => {
    const segments: string[] = [];
    let current: string[] = [];
    for (const p of this.points()) {
      if (p.y === null) {
        if (current.length > 0) {
          segments.push(current.join(' '));
        }
        current = [];
        continue;
      }
      current.push(`${current.length === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`);
    }
    if (current.length > 0) {
      segments.push(current.join(' '));
    }
    return segments.filter((s) => s.includes('L'));
  });

  protected readonly yTicks = computed(() => {
    const { lo, hi, ticks } = this.axis();
    const counts = this.metric() === 'orders';
    return ticks.map((t) => ({
      value: t,
      y: round(PAD.top + PLOT_H * (1 - (t - lo) / (hi - lo))),
      label: counts ? COMPACT_COUNT.format(t) : COMPACT_INR.format(t),
    }));
  });

  protected readonly xLabels = computed(() => {
    const points = this.points();
    const n = points.length;
    if (n <= MAX_X_LABELS) {
      return points;
    }
    const step = (n - 1) / (MAX_X_LABELS - 1);
    const picked = new Set<number>();
    for (let k = 0; k < MAX_X_LABELS; k++) {
      picked.add(Math.round(k * step));
    }
    return points.filter((p) => picked.has(p.index));
  });

  /** Half the distance between buckets: each bucket's hover target. */
  protected readonly hitWidth = computed(() => {
    const n = this.buckets().length;
    return n <= 1 ? PLOT_W : PLOT_W / (n - 1);
  });

  protected readonly gapCount = computed(() => this.values().filter((v) => v === null).length);
  protected readonly hasPartial = computed(() => this.points().some((p) => p.partial));

  protected readonly summary = computed(() => {
    const n = this.buckets().length;
    const unit = this.granularity() === 'day' ? 'day' : this.granularity();
    const gaps = this.gapCount();
    const range = formatDateRange(this.from(), this.to());
    const gapText =
      gaps === 0
        ? ''
        : ` ${gaps} ${gaps === 1 ? unit : `${unit}s`} without data ${gaps === 1 ? 'is' : 'are'} shown as a gap, not as zero.`;
    const partialText = this.hasPartial()
      ? ` A ${unit} marked partial runs past the date range: only its days inside the range count.`
      : '';
    return `${this.metricLabel()} per ${unit}, ${range}: ${n} ${n === 1 ? unit : `${unit}s`}.${gapText}${partialText} The data table lists every value.`;
  });

  protected selectMetric(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const metric = TREND_METRICS.find((m) => m.id === value);
    if (metric) {
      this.metric.set(metric.id);
    }
  }

  protected toggleTable(): void {
    this.showTable.update((v) => !v);
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
