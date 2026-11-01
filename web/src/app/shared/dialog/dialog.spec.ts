import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { textOf } from '../../../testing/test-data';
import { DIALOG_ACTIONS_CLASS, Dialog } from './dialog';

@Component({
  imports: [Dialog],
  template: `
    <button id="opener" type="button" (click)="open.set(true)">Add product</button>
    @if (open()) {
      <app-dialog heading="Add product" [busy]="busy()" (closed)="open.set(false)">
        <form>
          <label for="sku">SKU</label>
          <input id="sku" data-autofocus />
          <div [class]="actionsClass">
            <button id="save" type="submit">Save</button>
          </div>
        </form>
      </app-dialog>
    }
  `,
})
class Host {
  readonly open = signal(false);
  readonly busy = signal(false);
  readonly actionsClass = DIALOG_ACTIONS_CLASS;
}

describe('Dialog', () => {
  let fixture: ComponentFixture<Host>;
  const host = () => fixture.nativeElement as HTMLElement;
  const dialog = () => host().querySelector('[role="dialog"]') as HTMLElement | null;
  const opener = () => host().querySelector('#opener') as HTMLButtonElement;
  const closeButton = () =>
    Array.from(dialog()?.querySelectorAll('button') ?? []).find((b) =>
      textOf(b).startsWith('Close'),
    ) as HTMLButtonElement;

  async function open(): Promise<void> {
    opener().focus();
    opener().click();
    await fixture.whenStable();
  }

  function press(key: string, shiftKey = false): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    (document.activeElement ?? dialog())?.dispatchEvent(event);
    return event;
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('is a labelled modal dialog and focuses the [data-autofocus] element', async () => {
    await open();

    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    const heading = host().querySelector(`#${dialog()?.getAttribute('aria-labelledby')}`);
    expect(heading?.tagName).toBe('H2');
    expect(textOf(heading)).toBe('Add product');
    expect(document.activeElement).toBe(host().querySelector('#sku'));
    expect(textOf(closeButton())).toBe('Close dialog');
  });

  it('Escape and "Close" close it (not while busy) and focus returns to the opener', async () => {
    await open();
    fixture.componentInstance.busy.set(true);
    await fixture.whenStable();
    press('Escape');
    closeButton().click();
    await fixture.whenStable();
    expect(dialog()).not.toBeNull();
    expect(dialog()?.getAttribute('aria-busy')).toBe('true');

    fixture.componentInstance.busy.set(false);
    await fixture.whenStable();
    press('Escape');
    await fixture.whenStable();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('keeps Tab inside the dialog', async () => {
    await open();
    (host().querySelector('#save') as HTMLButtonElement).focus();
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeButton());
    expect(press('Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(host().querySelector('#save'));
  });

  it('fits a small screen: full width, at most the viewport tall, the content scrolls inside', async () => {
    await open();

    const panel = dialog() as HTMLElement;
    expect(panel.classList).toContain('w-full');
    expect(panel.classList).toContain('max-h-full');
    expect(panel.classList).toContain('flex-col');
    // The header (heading + Close) never scrolls away; only the body does.
    const header = panel.firstElementChild as HTMLElement;
    expect(header.contains(closeButton())).toBe(true);
    expect(header.classList).toContain('shrink-0');
    const body = panel.querySelector('[data-dialog-body]') as HTMLElement;
    expect(body.classList).toContain('overflow-y-auto');
    expect(body.classList).toContain('min-h-0');
    // Scroll padding at least the sticky actions row's height (~64px): a field reached with Tab
    // is scrolled into view above the row, never hidden under it (WCAG 2.4.11).
    expect(body.classList).toContain('scroll-pb-20');
    expect(body.contains(host().querySelector('form'))).toBe(true);
  });

  it('keeps the action buttons row in view at the bottom of the scrolling body', async () => {
    await open();

    const actions = host().querySelector('#save')?.parentElement as HTMLElement;
    for (const name of ['sticky', 'bottom-0', 'bg-white', 'flex-wrap']) {
      expect(actions.classList).toContain(name);
    }
  });
});
