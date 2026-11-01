import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EXPENSE_CATEGORIES, textOf, typeInto } from '../../../../testing/test-data';
import { provideApiHttpClient } from '../../../core/api/provide-api-http-client';
import { ExpenseFormDialog, NO_TARGET_MESSAGE } from './expense-form-dialog';

describe('ExpenseFormDialog', () => {
  let fixture: ComponentFixture<ExpenseFormDialog>;
  let httpTesting: HttpTestingController;

  const host = () => fixture.nativeElement as HTMLElement;
  const control = (name: string) =>
    host().querySelector(`[formcontrolname="${name}"]`) as HTMLInputElement & HTMLSelectElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideApiHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('shows an error instead of closing when a new expense has nowhere to go', async () => {
    fixture = TestBed.createComponent(ExpenseFormDialog);
    fixture.componentRef.setInput('categories', EXPENSE_CATEGORIES);
    let cancelled = false;
    fixture.componentInstance.cancelled.subscribe(() => (cancelled = true));
    await fixture.whenStable();

    const category = control('category');
    category.value = 'packaging';
    category.dispatchEvent(new Event('change'));
    typeInto(control('amount'), '10');
    await fixture.whenStable();
    Array.from(host().querySelectorAll('button'))
      .find((b) => textOf(b) === 'Add expense')
      ?.click();
    await fixture.whenStable();

    const alert = host().querySelector('[role="alert"]') as HTMLElement;
    expect(textOf(alert)).toBe(NO_TARGET_MESSAGE);
    expect(document.activeElement).toBe(alert);
    expect(cancelled).toBe(false);
    expect(host().querySelector('[role="dialog"]')).not.toBeNull();
  });
});
