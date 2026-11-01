import { InjectionToken } from '@angular/core';

/** The current time. Specs provide a fixed one, so "today" and date presets are predictable. */
export const CLOCK = new InjectionToken<() => Date>('CLOCK', {
  providedIn: 'root',
  factory: () => () => new Date(),
});
