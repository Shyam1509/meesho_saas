import { HttpParams } from '@angular/common/http';

/** A query value as the list endpoints take it; an array becomes a repeated parameter. */
export type QueryValue = string | number | boolean | readonly string[] | null | undefined;

/**
 * Query parameters in the order given, leaving out `undefined`, `null` and `''` (the API then
 * applies its default). An array is sent as a repeated parameter (`status=A&status=B`), the form
 * the API expects for multi-value filters; an empty array sends nothing.
 */
export function toHttpParams(query: Readonly<Record<string, QueryValue>>): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value as readonly string[]) {
        params = params.append(key, item);
      }
    } else {
      params = params.set(key, String(value));
    }
  }
  return params;
}
