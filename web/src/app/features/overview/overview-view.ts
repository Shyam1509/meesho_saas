import { ParamMap, Params } from '@angular/router';

import {
  DASHBOARD_BASES,
  DEFAULT_DASHBOARD_BASIS,
  DashboardBasis,
  DashboardQuery,
  MAX_DASHBOARD_RANGE_DAYS,
  TREND_GRANULARITIES,
  TrendGranularity,
} from '../../core/dashboard/dashboard.models';
import {
  DateRangeValue,
  RANGE_PRESET_IDS,
  RangePreset,
  daysInRange,
  presetRange,
} from '../../shared/date-presets/date-presets';
import { compactParams, readDate, readList, readOneOf } from '../../shared/url-state/url-state';

/** `all`: every seller account of the workspace. `account`: the shared selected seller account. */
export type OverviewScope = 'all' | 'account';

/** A preset, or `custom` for an explicit `from` / `to`. */
export type OverviewRange = RangePreset | 'custom';

export const DEFAULT_RANGE: RangePreset = 'last30';

/**
 * The dashboard as the URL query describes it
 * (`?scope=account&range=lastMonth&basis=payment_date&status…&granularity=week`, or `from` and `to`
 * instead of `range` for a custom range).
 */
export interface OverviewView {
  scope: OverviewScope;
  range: OverviewRange;
  /** Custom range only (`''` otherwise). */
  customFrom: string;
  customTo: string;
  basis: DashboardBasis;
  status: readonly string[];
  /** `null`: the API picks it from the range length. */
  granularity: TrendGranularity | null;
}

/** False when the custom range is incomplete, reversed or longer than the API accepts. */
export function isCustomRangeValid(from: string, to: string): boolean {
  return (
    from !== '' && to !== '' && from <= to && daysInRange(from, to) <= MAX_DASHBOARD_RANGE_DAYS
  );
}

/** Reads the view from the URL; an invalid value falls back to its default. */
export function readOverviewView(params: ParamMap): OverviewView {
  const customFrom = readDate(params, 'from');
  const customTo = readDate(params, 'to');
  const custom = isCustomRangeValid(customFrom, customTo);
  return {
    scope: params.get('scope') === 'account' ? 'account' : 'all',
    range: custom ? 'custom' : (readOneOf(params, 'range', RANGE_PRESET_IDS) ?? DEFAULT_RANGE),
    customFrom: custom ? customFrom : '',
    customTo: custom ? customTo : '',
    basis: readOneOf(params, 'basis', DASHBOARD_BASES) ?? DEFAULT_DASHBOARD_BASIS,
    status: readList(params, 'status'),
    granularity: readOneOf(params, 'granularity', TREND_GRANULARITIES),
  };
}

/** The URL query for a view, leaving out defaults. */
export function overviewParams(view: OverviewView): Params {
  const custom = view.range === 'custom';
  return compactParams({
    scope: view.scope === 'all' ? null : view.scope,
    range: custom || view.range === DEFAULT_RANGE ? null : view.range,
    from: custom ? view.customFrom : null,
    to: custom ? view.customTo : null,
    basis: view.basis === DEFAULT_DASHBOARD_BASIS ? null : view.basis,
    status: view.status,
    granularity: view.granularity,
  });
}

/** The explicit dates of the view: a preset is worked out on India's calendar at `now`. */
export function viewDates(view: OverviewView, now: Date): DateRangeValue {
  return view.range === 'custom'
    ? { from: view.customFrom, to: view.customTo }
    : presetRange(view.range, now);
}

/** The dashboard request: always explicit dates, so the screen and its links agree. */
export function dashboardQuery(view: OverviewView, now: Date): DashboardQuery {
  const { from, to } = viewDates(view, now);
  return {
    from,
    to,
    basis: view.basis,
    status: view.status,
    granularity: view.granularity ?? undefined,
  };
}
