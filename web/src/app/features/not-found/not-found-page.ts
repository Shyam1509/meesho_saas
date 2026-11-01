import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

/**
 * Any URL no route matches (signed in, so it shows inside the shell): says so, shows the address
 * that was asked for and links to the Overview. Pages with an id in the path (an order, a product,
 * an import) keep their own "not found" state for an id that does not exist.
 */
@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Page not found</h1>
    <p class="mt-2 max-w-2xl text-sm text-slate-700" data-testid="not-found-text">
      There is no page at
      <code class="rounded-sm bg-slate-100 px-1 py-0.5 break-all text-slate-900">{{ path() }}</code
      >. Check the address, or use the navigation to find what you were looking for.
    </p>
    <a
      routerLink="/overview"
      class="mt-4 inline-block rounded-md bg-accent-700 px-3 py-2 text-sm font-medium text-white hover:bg-accent-800"
    >
      Go to the Overview
    </a>
  `,
})
export class NotFoundPage {
  /** The address asked for (the segments the wildcard route matched), without its query. */
  protected readonly path = toSignal(
    inject(ActivatedRoute).url.pipe(map((segments) => `/${segments.map((s) => s.path).join('/')}`)),
    { requireSync: true },
  );
}
