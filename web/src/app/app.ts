import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { RouteFocus } from './core/a11y/route-focus';

/**
 * Root component. The app shell is a route (see `app.routes.ts`) so sign-in pages render without
 * it. After each navigation to another page, focus moves to that page's heading (`RouteFocus`).
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<router-outlet />',
})
export class App {
  constructor() {
    inject(RouteFocus).start();
  }
}
