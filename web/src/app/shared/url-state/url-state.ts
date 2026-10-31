import { ParamMap, Params } from '@angular/router';

/**
 * Reading list filters from the URL query, defensively: a hand-edited or stale bookmark falls back
 * to the default for each value it gets wrong, instead of sending the API a value it rejects.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Longest search text sent to the API. */
export const MAX_SEARCH_LENGTH = 100;
/** The API's highest page number (it answers 400 above it). */
export const MAX_PAGE = 2000;
/** The API's longest value of a list filter (a raw status, an entry type). */
export const MAX_LIST_ITEM_LENGTH = 64;

/** True for a real calendar day written `YYYY-MM-DD`. */
export function isDateOnly(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) {
    return false;
  }
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** False only when both days are given and `from` is after `to`. */
export function isDateRangeValid(
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  return !from || !to || from <= to;
}

/** Trimmed text, at most {@link MAX_SEARCH_LENGTH} characters; `''` when absent. */
export function readText(params: ParamMap, key: string): string {
  return (params.get(key) ?? '').trim().slice(0, MAX_SEARCH_LENGTH);
}

/** A valid `YYYY-MM-DD`, else `''`. */
export function readDate(params: ParamMap, key: string): string {
  const value = params.get(key);
  return value !== null && isDateOnly(value) ? value : '';
}

/** A page number from 1 to {@link MAX_PAGE}; anything else is page 1. */
export function readPage(params: ParamMap, key = 'page'): number {
  const value = params.get(key);
  if (value === null || !/^[1-9][0-9]{0,3}$/.test(value)) {
    return 1;
  }
  const page = Number(value);
  return page <= MAX_PAGE ? page : 1;
}

/** One of `allowed`, else `null`. */
export function readOneOf<T extends string>(
  params: ParamMap,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = params.get(key);
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * The repeated values of `key`, trimmed and without duplicates (at most `max`); empty values and
 * values longer than {@link MAX_LIST_ITEM_LENGTH} are left out.
 */
export function readList(params: ParamMap, key: string, max = 50): string[] {
  const seen = new Set<string>();
  for (const raw of params.getAll(key)) {
    if (seen.size >= max) {
      break;
    }
    const value = raw.trim();
    if (value.length > 0 && value.length <= MAX_LIST_ITEM_LENGTH) {
      seen.add(value);
    }
  }
  return [...seen];
}

/**
 * Query params for `Router.navigate`, leaving out values that mean "default" (`undefined`, `null`,
 * `''`, `false`, `[]`) so the URL stays short and canonical; `true` becomes `'true'`. Pass `null`
 * for page 1 and the default sort.
 */
export function compactParams(values: Readonly<Record<string, unknown>>): Params {
  const params: Params = {};
  for (const [key, value] of Object.entries(values)) {
    if (
      value === undefined ||
      value === null ||
      value === '' ||
      value === false ||
      (Array.isArray(value) && value.length === 0)
    ) {
      continue;
    }
    params[key] = value === true ? 'true' : value;
  }
  return params;
}

/**
 * Like {@link compactParams}, but every "default" value becomes `null`, which removes that key
 * when navigating with `queryParamsHandling: 'merge'` (other keys in the URL are kept).
 */
export function mergeParams(values: Readonly<Record<string, unknown>>): Params {
  const compact = compactParams(values);
  const params: Params = {};
  for (const key of Object.keys(values)) {
    params[key] = key in compact ? compact[key] : null;
  }
  return params;
}
