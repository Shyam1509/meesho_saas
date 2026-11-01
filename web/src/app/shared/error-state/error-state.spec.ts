import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { errorBody, textOf } from '../../../testing/test-data';
import { describeApiError } from '../../core/api/api-error';
import { ErrorState } from './error-state';

@Component({
  imports: [ErrorState],
  template: `
    <app-error-state
      heading="The orders could not be loaded."
      [message]="message()"
      [retryable]="retryable()"
      messageTestId="orders-error"
      (retry)="retries = retries + 1"
    >
      <p data-testid="extra">Extra help.</p>
    </app-error-state>
  `,
})
class Host {
  readonly message = signal<string | null>('Boom.');
  readonly retryable = signal(true);
  retries = 0;
}

describe('ErrorState', () => {
  let fixture: ComponentFixture<Host>;
  const el = () => fixture.nativeElement as HTMLElement;
  const alert = () => el().querySelector('[role="alert"]') as HTMLElement;
  const paragraphs = () => Array.from(alert().querySelectorAll('p')).map((p) => textOf(p));
  const button = () => alert().querySelector('button');

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('is an alert with the heading, the message, projected content and "Try again"', () => {
    expect(paragraphs()).toEqual(['The orders could not be loaded.', 'Boom.', 'Extra help.']);
    expect(alert().querySelector('[data-testid="orders-error"]')?.textContent?.trim()).toBe(
      'Boom.',
    );
    expect(textOf(button())).toBe('Try again');
    expect(button()?.getAttribute('type')).toBe('button');
  });

  it('"Try again" emits retry', () => {
    button()?.click();
    button()?.click();
    expect(fixture.componentInstance.retries).toBe(2);
  });

  it('shows a server error with its support reference, a network error without one', async () => {
    fixture.componentInstance.message.set(
      describeApiError(
        new HttpErrorResponse({ status: 500, error: errorBody('INTERNAL_ERROR', 'Boom.') }),
      ),
    );
    await fixture.whenStable();
    expect(paragraphs()[1]).toBe('Boom. (Reference: req-1)');

    fixture.componentInstance.message.set(
      describeApiError(new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') })),
    );
    await fixture.whenStable();
    expect(paragraphs()[1]).toBe("Can't reach the server. Check your connection and try again.");
    expect(textOf(alert())).not.toContain('Reference');
  });

  it('can leave out the message and the retry button', async () => {
    fixture.componentInstance.message.set(null);
    fixture.componentInstance.retryable.set(false);
    await fixture.whenStable();
    expect(paragraphs()).toEqual(['The orders could not be loaded.', 'Extra help.']);
    expect(button()).toBeNull();
  });
});

@Component({
  imports: [ErrorState],
  template: `
    <main>
      <h1>Orders</h1>
      <section aria-labelledby="list-heading" data-testid="list">
        <h2 id="list-heading">Orders of Main store</h2>
        @if (failed()) {
          <app-error-state heading="The orders could not be loaded." (retry)="failed.set(false)" />
        } @else {
          <p>Loading orders…</p>
        }
      </section>
      @if (pickerFailed()) {
        <div>
          <app-error-state heading="The seller accounts could not be loaded." (retry)="pickerFailed.set(false)" />
        </div>
      }
    </main>
  `,
})
class PageHost {
  readonly failed = signal(true);
  readonly pickerFailed = signal(true);
}

describe('ErrorState focus after "Try again"', () => {
  let fixture: ComponentFixture<PageHost>;
  const el = () => fixture.nativeElement as HTMLElement;
  const tryAgain = (index: number) =>
    el().querySelectorAll<HTMLButtonElement>('app-error-state button')[index];

  beforeEach(async () => {
    fixture = TestBed.createComponent(PageHost);
    await fixture.whenStable();
  });

  it('moves focus to the labelled section once the box is replaced (not to <body>)', async () => {
    const button = tryAgain(0);
    button.focus();
    button.click();
    await fixture.whenStable();

    const section = el().querySelector('[data-testid="list"]') as HTMLElement;
    expect(el().querySelector('section app-error-state')).toBeNull();
    expect(document.activeElement).toBe(section);
    expect(section.getAttribute('tabindex')).toBe('-1');
  });

  it('falls back to the page heading when no labelled section is around it', async () => {
    const button = tryAgain(1);
    button.focus();
    button.click();
    await fixture.whenStable();

    expect(document.activeElement).toBe(el().querySelector('h1'));
  });
});
