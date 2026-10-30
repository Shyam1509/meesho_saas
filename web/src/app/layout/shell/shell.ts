import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { PRODUCT_NAME } from '../../core/product';
import { NAV_ITEMS } from '../nav-items';

/**
 * App shell: skip link, header, primary navigation and the routed page.
 * Below the `md` breakpoint the navigation hides behind a "Menu" button.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  host: {
    class: 'block',
    '(document:keydown.escape)': 'closeMenuAndRefocus()',
  },
})
export class Shell {
  protected readonly productName = PRODUCT_NAME;
  protected readonly navItems = NAV_ITEMS;
  protected readonly navId = 'primary-navigation';
  protected readonly menuOpen = signal(false);

  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly menuButton = viewChild.required<ElementRef<HTMLButtonElement>>('menuButton');

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
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
}
