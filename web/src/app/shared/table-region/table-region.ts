import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

/**
 * Put on the element that scrolls a wide table sideways (`overflow-x-auto`), so a table wider than
 * a phone never makes the whole page scroll. While the table really overflows it (re-checked
 * whenever the element or its table changes size), the element is a named region
 * (`role="region"`) that keyboard users can Tab to and scroll with the arrow keys; a table that
 * fits adds no Tab stop. Give it the table's caption: it is named "<caption> (scrollable table)",
 * so it never repeats the name of the section around it.
 *
 * It is also positioned (`relative`): visually hidden text in the cells (`sr-only` is absolutely
 * positioned) then scrolls with the table, instead of escaping it and widening the whole page.
 */
@Directive({
  selector: '[appTableRegion]',
  host: {
    class: 'relative',
    '[attr.role]': 'scrollable() ? "region" : null',
    '[attr.tabindex]': 'scrollable() ? "0" : null',
    '[attr.aria-label]': 'regionName()',
    '[attr.data-scrollable]': 'scrollable() ? "true" : null',
    'data-table-region': '',
  },
})
export class TableRegion {
  /** The table's caption, e.g. "Orders of Main store". */
  readonly label = input.required<string>({ alias: 'appTableRegion' });

  protected readonly regionName = computed(() => `${this.label()} (scrollable table)`);
  /** True while the content is wider (or taller) than the element, so it can be scrolled. */
  protected readonly scrollable = signal(false);

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const measure = () =>
        this.scrollable.set(
          // 1px of slack: sub-pixel layout can round scrollWidth up by one.
          element.scrollWidth - element.clientWidth > 1 ||
            element.scrollHeight - element.clientHeight > 1,
        );
      measure();
      if (typeof ResizeObserver === 'undefined') {
        return;
      }
      // The element resizes with the window; the table inside with its rows and columns.
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      for (const child of Array.from(element.children)) {
        observer.observe(child);
      }
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
