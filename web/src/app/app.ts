import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Root component. The app shell is a route (see `app.routes.ts`) so sign-in pages render without it. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<router-outlet />',
})
export class App {}
