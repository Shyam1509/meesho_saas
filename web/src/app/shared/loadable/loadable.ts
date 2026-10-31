import { Observable, OperatorFunction, catchError, map, of, scan, startWith } from 'rxjs';

import { describeApiError } from '../../core/api/api-error';

/**
 * A value fetched from the API as the template needs it. `busy` is true while a newer request
 * (another page, a refresh) runs and the previous value stays on screen.
 */
export type Loadable<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; value: T; busy: boolean }
  | { kind: 'error'; message: string };

/** `loading`, then `ready` with the value or `error` with the text for an error banner. */
export function toLoadable<T>(request: Observable<T>): Observable<Loadable<T>> {
  return request.pipe(
    map((value): Loadable<T> => ({ kind: 'ready', value, busy: false })),
    catchError((error: unknown) =>
      of<Loadable<T>>({ kind: 'error', message: describeApiError(error) }),
    ),
    startWith<Loadable<T>>({ kind: 'loading' }),
  );
}

/** Keeps the last `ready` value on screen (marked `busy`) while the next one loads. */
export function keepPreviousWhileLoading<T>(): OperatorFunction<Loadable<T>, Loadable<T>> {
  return scan<Loadable<T>, Loadable<T>>(
    (previous, next) =>
      next.kind === 'loading' && previous.kind === 'ready' ? { ...previous, busy: true } : next,
    { kind: 'loading' },
  );
}
