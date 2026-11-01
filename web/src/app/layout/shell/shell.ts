import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterOutlet, isActive } from '@angular/router';

import { describeApiError } from '../../core/api/api-error';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { roleLabel } from '../../core/auth/auth.models';
import { PRODUCT_NAME } from '../../core/product';
import { WorkspaceContextService } from '../../core/workspaces/workspace-context.service';
import { NAV_ITEMS } from '../nav-items';

/** Tailwind's `md` breakpoint, from which the navigation is a sidebar. */
const MD_UP = '(min-width: 48rem)';

/**
 * App shell for signed-in users: skip link, header (workspace switcher, user, role, sign out),
 * primary navigation and the routed page. Below the `md` breakpoint the navigation hides behind a
 * "Menu" button; while that menu is open it covers the page, which is made `inert` (no Tab stops
 * behind it), and it closes when the window grows to `md`.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  host: {
    class: 'block',
    '(document:keydown.escape)': 'closeMenuAndRefocus()',
  },
})
export class Shell {
  private readonly auth = inject(AuthStateService);
  private readonly workspaceContext = inject(WorkspaceContextService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly productName = PRODUCT_NAME;
  /** The path (no query or fragment) of the page on screen. */
  private readonly currentPath = computed(() => {
    const url = this.router.lastSuccessfulNavigation()?.finalUrl;
    return url ? this.router.serializeUrl(url).split(/[?#]/)[0] : '';
  });
  /**
   * Each item with whether it is the current page: its link matches the URL the way
   * `routerLinkActive` does by default (path prefix, query ignored), or the path matches the
   * item's `alsoCurrentFor` (an order's page keeps "Orders" current).
   */
  protected readonly navItems = NAV_ITEMS.map((item) => {
    const linkActive = isActive(item.link, this.router);
    const extra = item.alsoCurrentFor;
    return {
      ...item,
      current: computed(
        () => linkActive() || (extra !== undefined && extra.test(this.currentPath())),
      ),
    };
  });
  protected readonly navId = 'primary-navigation';
  protected readonly menuOpen = signal(false);

  protected readonly user = this.auth.user;
  /** Display name, or the email when the user has not set one. */
  protected readonly userName = computed(() => {
    const user = this.auth.user();
    return user ? (user.displayName ?? user.email) : '';
  });
  protected readonly workspaces = this.workspaceContext.workspaces;
  protected readonly selectedWorkspace = this.workspaceContext.selected;
  protected readonly roleText = computed(() => {
    const role = this.workspaceContext.role();
    return role ? roleLabel(role) : null;
  });
  protected readonly signingOut = signal(false);
  protected readonly signOutError = signal<string | null>(null);

  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly menuButton = viewChild.required<ElementRef<HTMLButtonElement>>('menuButton');

  constructor() {
    // From `md` up the navigation is always shown: an open phone menu must not leave the page inert.
    const wide = inject(DOCUMENT).defaultView?.matchMedia?.(MD_UP);
    if (wide) {
      const onChange = (event: MediaQueryListEvent) => {
        if (event.matches) {
          this.menuOpen.set(false);
        }
      };
      wide.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => wide.removeEventListener('change', onChange));
    }
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  /**
   * A navigation link: another page closes the menu (focus then goes to that page's heading); the
   * page already on screen only closes it, so focus goes back to the menu button instead of being
   * lost with the hidden link.
   */
  protected onNavLinkClick(link: string): void {
    if (link === this.currentPath()) {
      this.closeMenuAndRefocus();
    } else {
      this.closeMenu();
    }
  }

  /** Escape closes the open mobile menu and returns focus to its button. */
  protected closeMenuAndRefocus(): void {
    if (!this.menuOpen()) {
      return;
    }
    this.menuOpen.set(false);
    this.menuButton().nativeElement.focus();
  }

  /**
   * Moves focus to <main>. Handled in code because `<base href="/">` would turn a plain
   * `#main-content` link into a navigation to the root URL.
   */
  protected skipToContent(event: Event): void {
    event.preventDefault();
    this.main().nativeElement.focus();
  }

  protected selectWorkspace(event: Event): void {
    this.workspaceContext.select((event.target as HTMLSelectElement).value);
  }

  /**
   * `POST /auth/logout`, then the sign-in page. If the server could not revoke the session the
   * user stays signed in and sees why, rather than believing they signed out.
   */
  protected signOut(): void {
    if (this.signingOut()) {
      return;
    }
    this.signingOut.set(true);
    this.signOutError.set(null);
    this.auth
      .logout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.signingOut.set(false);
          void this.router.navigateByUrl('/login');
        },
        error: (error: unknown) => {
          this.signingOut.set(false);
          this.signOutError.set(`Sign-out failed: ${describeApiError(error)}`);
        },
      });
  }
}
