import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { textOf } from '../../../testing/test-data';
import { ConfirmDialog } from './confirm-dialog';

@Component({
  imports: [ConfirmDialog],
  template: `
    <button id="opener" type="button" (click)="open.set(true)">Disable</button>
    @if (open()) {
      <app-confirm-dialog
        heading="Disable Main store?"
        message="The account and its data are kept."
        confirmLabel="Disable account"
        pendingLabel="Disabling…"
        tone="danger"
        [pending]="pending()"
        [error]="error()"
        (confirmed)="confirmCount = confirmCount + 1"
        (cancelled)="open.set(false)"
      />
    }
  `,
})
class Host {
  readonly open = signal(false);
  readonly pending = signal(false);
  readonly error = signal<string | null>(null);
  confirmCount = 0;
}

describe('ConfirmDialog', () => {
  let fixture: ComponentFixture<Host>;
  const host = () => fixture.nativeElement as HTMLElement;
  const dialog = () => host().querySelector('[role="alertdialog"]') as HTMLElement | null;
  const buttons = () => Array.from(dialog()?.querySelectorAll('button') ?? []);
  const cancelButton = () => buttons()[0];
  const confirmButton = () => buttons()[1];
  const opener = () => host().querySelector('#opener') as HTMLButtonElement;

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

  it('is a labelled modal alert dialog and focuses Cancel when it opens', async () => {
    await open();

    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    const heading = host().querySelector(`#${dialog()?.getAttribute('aria-labelledby')}`);
    const message = host().querySelector(`#${dialog()?.getAttribute('aria-describedby')}`);
    expect(textOf(heading)).toBe('Disable Main store?');
    expect(textOf(message)).toBe('The account and its data are kept.');
    expect(textOf(confirmButton())).toBe('Disable account');
    expect(document.activeElement).toBe(cancelButton());
  });

  it('Escape cancels and returns focus to the opener', async () => {
    await open();

    press('Escape');
    await fixture.whenStable();

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('Cancel closes the dialog and returns focus to the opener', async () => {
    await open();

    cancelButton().click();
    await fixture.whenStable();

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    await open();

    confirmButton().focus();
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancelButton());

    expect(press('Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirmButton());
  });

  it('emits confirmed; while pending it ignores confirm and Escape', async () => {
    await open();

    confirmButton().click();
    expect(fixture.componentInstance.confirmCount).toBe(1);

    fixture.componentInstance.pending.set(true);
    await fixture.whenStable();
    expect(textOf(confirmButton())).toBe('Disabling…');
    expect(confirmButton().getAttribute('aria-disabled')).toBe('true');
    expect(dialog()?.getAttribute('aria-busy')).toBe('true');

    confirmButton().click();
    press('Escape');
    await fixture.whenStable();
    expect(fixture.componentInstance.confirmCount).toBe(1);
    expect(dialog()).not.toBeNull();
  });

  it('shows an error inside the dialog', async () => {
    await open();
    fixture.componentInstance.error.set('Account not found.');
    await fixture.whenStable();

    expect(textOf(dialog()?.querySelector('[role="alert"]'))).toBe('Account not found.');
  });
});
