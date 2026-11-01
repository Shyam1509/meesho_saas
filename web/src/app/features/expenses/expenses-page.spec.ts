import { provideLocationMocks } from '@angular/common/testing';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  EXPENSE_CATEGORIES,
  ME_MEMBER,
  ME_OWNER,
  errorBody,
  expense,
  expenseList,
  sellerAccount,
  textOf,
  typeInto,
} from '../../../testing/test-data';
import { provideApiHttpClient } from '../../core/api/provide-api-http-client';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { MeResponse } from '../../core/auth/auth.models';
import { DOUBLE_COUNTING_NOTE, ExpenseListResponse } from '../../core/expenses/expense.models';
import { addDays } from '../products/cost-entry-dialog/cost-entry-dialog';
import { todayInIndia } from './expense-form-dialog/expense-form-dialog';
import { ExpensesPage } from './expenses-page';

const MAIN = sellerAccount({ id: '100', displayName: 'Main store' });
const OUTLET = sellerAccount({ id: '101', displayName: 'Outlet' });
const TODAY = todayInIndia();

const PACKAGING = expense();
const RENT = expense({
  id: '901',
  scope: 'workspace',
  sellerAccountId: null,
  expenseDate: '2026-10-01',
  category: 'other',
  categoryLabel: 'Other (description required)',
  description: 'Office rent',
  amount: '15000.00',
});
const STAFF = expense({
  id: '902',
  sellerAccountId: '101',
  expenseDate: '2026-10-03',
  category: 'staff',
  categoryLabel: 'Salaries & staff',
  description: null,
  amount: '8000.00',
});

describe('ExpensesPage', () => {
  let harness: RouterTestingHarness;
  let httpTesting: HttpTestingController;

  const host = () => harness.routeNativeElement as HTMLElement;
  const stable = () => harness.fixture.whenStable();
  const url = () => TestBed.inject(Router).url;
  const list = () => host().querySelector('[data-testid="expenses-list"]') as HTMLElement;
  const row = (id: string) => host().querySelector(`tr[data-expense-id="${id}"]`) as HTMLElement;
  const buttonByText = (text: string, root: ParentNode = host()) =>
    Array.from(root.querySelectorAll('button')).find((b) => textOf(b) === text) as
      | HTMLButtonElement
      | undefined;
  const buttonStartingWith = (text: string, root: ParentNode = host()) =>
    Array.from(root.querySelectorAll('button')).find((b) => textOf(b).startsWith(text)) as
      | HTMLButtonElement
      | undefined;
  const input = (selector: string) => host().querySelector(selector) as HTMLInputElement;
  const header = (key: string) =>
    host().querySelector(`[data-sort-key="${key}"]`)?.closest('th') as HTMLTableCellElement;
  const sortButton = (key: string) =>
    host().querySelector(`button[data-sort-key="${key}"]`) as HTMLButtonElement;
  const notice = () => textOf(host().querySelector('[data-testid="expenses-notice"]'));
  const dialog = () => host().querySelector('[role="dialog"]') as HTMLElement | null;
  const alertDialog = () => host().querySelector('[role="alertdialog"]') as HTMLElement | null;
  const control = (name: string) =>
    dialog()?.querySelector(`[formcontrolname="${name}"]`) as HTMLInputElement &
      HTMLSelectElement;
  const errorFor = (el: HTMLElement) => {
    const ids = (el.getAttribute('aria-describedby') ?? '').split(' ');
    return textOf(host().querySelector(`#${ids[ids.length - 1]}`));
  };
  const categoryBox = (label: string) => {
    const lbl = Array.from(host().querySelectorAll('app-checkbox-group label')).find(
      (l) => textOf(l) === label,
    );
    return host().querySelector(`#${lbl?.getAttribute('for')}`) as HTMLInputElement;
  };

  function setValue(el: HTMLInputElement | HTMLSelectElement, value: string, event = 'change') {
    el.value = value;
    el.dispatchEvent(new Event(event));
  }

  function expectAccountList(accountId = '100'): TestRequest {
    return httpTesting.expectOne((r) => r.url === `/api/v1/accounts/${accountId}/expenses`);
  }

  function expectWorkspaceList(workspaceId = '10'): TestRequest {
    return httpTesting.expectOne((r) => r.url === `/api/v1/workspaces/${workspaceId}/expenses`);
  }

  async function flush(req: TestRequest, body: ExpenseListResponse): Promise<void> {
    req.flush(body);
    await stable();
  }

  /** Opens `start`, answers the categories and the accounts; the list request stays open. */
  async function render(start = '/expenses', me: MeResponse = ME_OWNER): Promise<void> {
    TestBed.inject(AuthStateService).setSession(me);
    harness = await RouterTestingHarness.create(start);
    httpTesting.expectOne('/api/v1/expenses/categories').flush({ items: EXPENSE_CATEGORIES });
    httpTesting
      .expectOne(`/api/v1/workspaces/${me.workspaces[0].id}/accounts`)
      .flush({ items: [MAIN, OUTLET] });
    await stable();
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'expenses', component: ExpensesPage }], withComponentInputBinding()),
        provideLocationMocks(),
        provideApiHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    localStorage.clear();
  });

  describe('list, totals and the double-counting note', () => {
    it('lists the selected account’s expenses with the total of every filtered one', async () => {
      await render();
      expect(textOf(host().querySelector('[data-testid="double-counting-note"]'))).toBe(
        `Don’t count costs twice. ${DOUBLE_COUNTING_NOTE}`,
      );
      expect(list().dataset['state']).toBe('loading');
      const req = expectAccountList();
      expect(req.request.urlWithParams).toBe(
        '/api/v1/accounts/100/expenses?page=1&pageSize=25&sort=-expenseDate',
      );
      await flush(
        req,
        expenseList([PACKAGING, { ...STAFF, sellerAccountId: '100' }], { amount: '43200.50', count: 30 }, 1, 30),
      );

      expect(list().dataset['state']).toBe('ready');
      expect(textOf(host().querySelector('caption'))).toBe('Expenses of Main store');
      const cells = (r: Element) =>
        Array.from(r.querySelectorAll('th, td')).map((c) => textOf(c));
      expect(cells(row('900'))).toEqual([
        '5 Oct 2026',
        'Packaging & labels',
        'Poly bags',
        '₹1,200.50',
        expect.stringMatching(/^Asha Rao 5 Oct 2026, /),
        expect.stringMatching(/^Edit.*Delete/),
      ]);
      expect(textOf(row('902').querySelector('td:nth-of-type(2) .sr-only'))).toBe(
        'No description',
      );
      const total = host().querySelector('[data-testid="expenses-total"]') as HTMLElement;
      expect(textOf(total.querySelector('th'))).toBe(
        'Total of 30 expenses Every expense the filters select, not just this page.',
      );
      expect(textOf(total.querySelector('td'))).toBe('₹43,200.50');
      expect(textOf(host().querySelector('[data-testid="result-announcement"]'))).toBe(
        '30 expenses found.',
      );
      // The "belongs to" column is only for the workspace view with account expenses.
      expect(textOf(host().querySelector('thead'))).not.toContain('Belongs to');
    });

    it('shows a missing total as "—", never ₹0.00', async () => {
      await render();
      await flush(expectAccountList(), expenseList([PACKAGING], { amount: null, count: 1 }));
      const totalCell = host().querySelector('[data-testid="expenses-total"] td') as HTMLElement;
      expect(textOf(totalCell)).toBe('— no expenses');
      expect(textOf(totalCell)).not.toContain('₹0.00');
    });

    it('shows an error with "Try again", and empty / no-results states', async () => {
      await render();
      expectAccountList().flush(errorBody('INTERNAL_ERROR', 'Boom.'), {
        status: 500,
        statusText: 'Server Error',
      });
      await stable();
      expect(list().dataset['state']).toBe('error');
      buttonByText('Try again', list())?.click();
      await stable();
      await flush(expectAccountList(), expenseList([], { amount: null, count: 0 }));
      expect(host().querySelector('[data-testid="no-expenses"]')).not.toBeNull();

      await harness.navigateByUrl('/expenses?category=staff');
      await flush(expectAccountList(), expenseList([], { amount: null, count: 0 }));
      expect(host().querySelector('[data-testid="no-results"]')).not.toBeNull();
    });

    it('explains when the categories cannot be loaded and retries', async () => {
      TestBed.inject(AuthStateService).setSession(ME_OWNER);
      harness = await RouterTestingHarness.create('/expenses');
      httpTesting.expectOne('/api/v1/expenses/categories').error(new ProgressEvent('error'));
      httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: [MAIN] });
      await stable();
      await flush(expectAccountList(), expenseList([PACKAGING]));
      const alert = host().querySelector('[data-testid="categories-error"]') as HTMLElement;
      expect(textOf(alert)).toContain('The expense categories could not be loaded.');
      // Adding waits for the categories.
      expect(buttonByText('Add expense')?.getAttribute('aria-disabled')).toBe('true');
      buttonByText('Add expense')?.click();
      await stable();
      expect(dialog()).toBeNull();

      buttonByText('Try again', alert)?.click();
      await stable();
      httpTesting.expectOne('/api/v1/expenses/categories').flush({ items: EXPENSE_CATEGORIES });
      await stable();
      expect(host().querySelector('[data-testid="categories-error"]')).toBeNull();
      expect(buttonByText('Add expense')?.hasAttribute('aria-disabled')).toBe(false);
    });
  });

  describe('filters, sort and the URL', () => {
    it('reads the filters from the URL, sends them and shows them in the form', async () => {
      await render(
        '/expenses?from=2026-10-01&to=2026-10-31&category=packaging&category=other&sort=amount&page=2',
      );
      const req = expectAccountList();
      expect(req.request.urlWithParams).toBe(
        '/api/v1/accounts/100/expenses?page=2&pageSize=25&sort=amount&from=2026-10-01&to=2026-10-31&category=packaging&category=other',
      );
      await flush(req, expenseList([PACKAGING], undefined, 2, 26));
      expect(input('#expenses-date-from').value).toBe('2026-10-01');
      expect(input('#expenses-date-to').value).toBe('2026-10-31');
      expect(textOf(host().querySelector('app-checkbox-group summary'))).toBe(
        'Category: 2 selected',
      );
      expect(categoryBox('Packaging & labels').checked).toBe(true);
      expect(header('amount').getAttribute('aria-sort')).toBe('ascending');
      expect(buttonByText('Clear filters')).toBeDefined();
    });

    it('ignores category keys the API does not list instead of failing with a 400', async () => {
      await render('/expenses?category=packaging&category=retired_key');
      const req = expectAccountList();
      expect(req.request.params.getAll('category')).toEqual(['packaging']);
      await flush(req, expenseList([PACKAGING]));
      expect(list().dataset['state']).toBe('ready');
      expect(textOf(host().querySelector('app-checkbox-group summary'))).toBe(
        'Category: Packaging & labels',
      );
    });

    it('waits for the categories before listing with a category filter', async () => {
      TestBed.inject(AuthStateService).setSession(ME_OWNER);
      harness = await RouterTestingHarness.create('/expenses?category=staff');
      httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: [MAIN] });
      await stable();
      httpTesting.expectNone((r) => r.url === '/api/v1/accounts/100/expenses');
      expect(textOf(list().querySelector('[role="status"]'))).toBe('Loading expenses…');

      httpTesting.expectOne('/api/v1/expenses/categories').flush({ items: EXPENSE_CATEGORIES });
      await stable();
      const req = expectAccountList();
      expect(req.request.params.getAll('category')).toEqual(['staff']);
      await flush(req, expenseList([STAFF]));
    });

    it('drops invalid URL values and applies new filters to the URL (page 1)', async () => {
      await render('/expenses?from=2026-10-31&to=2026-10-01&category=Bad%20Key&sort=price&page=0');
      const first = expectAccountList();
      expect(first.request.urlWithParams).toBe(
        '/api/v1/accounts/100/expenses?page=1&pageSize=25&sort=-expenseDate',
      );
      await flush(first, expenseList([PACKAGING]));

      setValue(input('#expenses-date-from'), '2026-10-01');
      setValue(input('#expenses-date-to'), '2026-10-15');
      categoryBox('Salaries & staff').click();
      await stable();
      buttonByText('Apply filters')?.click();
      await stable();
      expect(url()).toBe('/expenses?from=2026-10-01&to=2026-10-15&category=staff');
      const req = expectAccountList();
      expect(req.request.params.getAll('category')).toEqual(['staff']);
      await flush(req, expenseList([STAFF]));

      buttonByText('Clear filters')?.click();
      await stable();
      expect(url()).toBe('/expenses');
      await flush(expectAccountList(), expenseList([PACKAGING]));
    });

    it('sorts by date, category and amount (dates and amounts start descending)', async () => {
      await render();
      await flush(expectAccountList(), expenseList([PACKAGING]));
      expect(header('expenseDate').getAttribute('aria-sort')).toBe('descending');

      sortButton('amount').click();
      await stable();
      expect(url()).toBe('/expenses?sort=-amount');
      await flush(expectAccountList(), expenseList([PACKAGING]));

      sortButton('category').click();
      await stable();
      expect(url()).toBe('/expenses?sort=category');
      await flush(expectAccountList(), expenseList([PACKAGING]));
      expect(header('category').getAttribute('aria-sort')).toBe('ascending');

      sortButton('expenseDate').click();
      await stable();
      // Back to the default sort: it leaves the URL.
      expect(url()).toBe('/expenses');
      await flush(expectAccountList(), expenseList([PACKAGING]));
    });
  });

  describe('scope switch', () => {
    it('switches to workspace-wide expenses, then includes the accounts’ ones', async () => {
      await render('/expenses?sort=amount&page=3');
      await flush(expectAccountList(), expenseList([PACKAGING], undefined, 3, 60));

      input('#expenses-scope-workspace').click();
      await stable();
      expect(url()).toBe('/expenses?scope=workspace&sort=amount');
      expect(host().querySelector('app-seller-account-picker')?.hasAttribute('hidden')).toBe(true);
      const workspaceReq = expectWorkspaceList();
      expect(workspaceReq.request.urlWithParams).toBe(
        '/api/v1/workspaces/10/expenses?page=1&pageSize=25&sort=amount&scope=workspace',
      );
      await flush(workspaceReq, expenseList([RENT], { amount: '15000.00', count: 1 }));
      expect(textOf(host().querySelector('caption'))).toBe(
        'Workspace-wide expenses of Asha Textiles',
      );
      expect(buttonByText('Add workspace-wide expense')).toBeDefined();

      input('#expenses-include-accounts').click();
      await stable();
      expect(url()).toBe('/expenses?scope=workspace&includeAccounts=true&sort=amount');
      const allReq = expectWorkspaceList();
      expect(allReq.request.params.get('scope')).toBe('all');
      await flush(allReq, expenseList([RENT, PACKAGING, STAFF], { amount: '24200.50', count: 3 }));

      const headers = Array.from(host().querySelectorAll('thead th')).map((th) => textOf(th));
      expect(headers).toContain('Belongs to');
      const belongsTo = (id: string) => textOf(row(id).querySelectorAll('td')[2]);
      expect(belongsTo('901')).toBe('Workspace-wide');
      expect(belongsTo('900')).toBe('Main store');
      expect(belongsTo('902')).toBe('Outlet');
      // The footer label spans the extra column.
      expect(
        host().querySelector('[data-testid="expenses-total"] th')?.getAttribute('colspan'),
      ).toBe('4');

      input('#expenses-scope-account').click();
      await stable();
      expect(url()).toBe('/expenses?sort=amount');
      expect(host().querySelector('app-seller-account-picker')?.hasAttribute('hidden')).toBe(false);
      await flush(expectAccountList(), expenseList([PACKAGING]));
    });

    it('reads the workspace view from the URL (includeAccounts only with scope=workspace)', async () => {
      await render('/expenses?includeAccounts=true');
      // Account view: includeAccounts is ignored.
      await flush(expectAccountList(), expenseList([PACKAGING]));
      await harness.navigateByUrl('/expenses?scope=workspace&includeAccounts=true');
      const req = expectWorkspaceList();
      expect(req.request.params.get('scope')).toBe('all');
      await flush(req, expenseList([RENT]));
      expect(input('#expenses-include-accounts').checked).toBe(true);
    });
  });

  describe('add, edit and delete (owner)', () => {
    async function openAdd(start = '/expenses'): Promise<void> {
      await render(start);
      const req = start.includes('scope=workspace') ? expectWorkspaceList() : expectAccountList();
      await flush(req, expenseList([PACKAGING]));
      buttonStartingWith('Add')?.click();
      await stable();
      expect(dialog()).not.toBeNull();
    }

    function save(label = 'Add expense'): void {
      buttonByText(label, dialog() as HTMLElement)?.click();
    }

    it('starts on today, shows the note and the target, and validates every field', async () => {
      await openAdd();
      expect(textOf(dialog()?.querySelector('h2'))).toBe('Add expense');
      expect(textOf(dialog()?.querySelector('[data-testid="double-counting-note"]'))).toBe(
        DOUBLE_COUNTING_NOTE,
      );
      expect(textOf(dialog()?.querySelector('[data-testid="expense-target"]'))).toBe(
        'Adds an expense of the seller account Main store.',
      );
      expect(control('expenseDate').value).toBe(TODAY);
      expect(document.activeElement).toBe(control('expenseDate'));

      save();
      await stable();
      expect(errorFor(control('category'))).toBe('Choose a category.');
      expect(errorFor(control('amount'))).toBe('Enter the amount.');
      expect(document.activeElement).toBe(control('category'));

      // "Other" needs a description; zero, 3 decimals and a future date are refused.
      setValue(control('category'), 'other');
      typeInto(control('amount'), '0');
      typeInto(control('expenseDate'), addDays(TODAY, 1));
      await stable();
      expect(textOf(dialog()?.querySelector(`label[for="${control('category').id}"]`))).toBe(
        'Category',
      );
      expect(control('description').getAttribute('aria-required')).toBe('true');
      save();
      await stable();
      expect(errorFor(control('expenseDate'))).toBe('The date can’t be in the future.');
      expect(errorFor(control('description'))).toBe(
        'Describe the expense: this category needs a description.',
      );
      expect(errorFor(control('amount'))).toBe('The amount must be more than ₹0.');
      expect(document.activeElement).toBe(control('expenseDate'));

      typeInto(control('amount'), '12.345');
      await stable();
      save();
      await stable();
      expect(errorFor(control('amount'))).toBe(
        'Enter rupees as a number with up to 2 decimals, for example 1250.50 (no ₹ sign or commas).',
      );

      // Another category makes the description optional again.
      setValue(control('category'), 'packaging');
      await stable();
      expect(control('description').hasAttribute('aria-required')).toBe(false);
      expect(textOf(dialog())).toContain('Boxes, poly bags, tape and labels you buy.');
      expect(control('category').getAttribute('aria-describedby')).toContain('category-help');
    });

    it('POSTs a new account expense, announces it and reloads the list', async () => {
      await openAdd();
      typeInto(control('expenseDate'), '2026-10-20');
      setValue(control('category'), 'other');
      typeInto(control('description'), '  Courier bags ');
      typeInto(control('amount'), ' 1250.5 ');
      await stable();
      save();
      await stable();
      const req = httpTesting.expectOne({ method: 'POST', url: '/api/v1/accounts/100/expenses' });
      expect(req.request.body).toEqual({
        expenseDate: '2026-10-20',
        category: 'other',
        description: 'Courier bags',
        amount: '1250.5',
      });
      req.flush(
        expense({
          id: '903',
          expenseDate: '2026-10-20',
          category: 'other',
          categoryLabel: 'Other (description required)',
          description: 'Courier bags',
          amount: '1250.50',
        }),
        { status: 201, statusText: 'Created' },
      );
      await stable();
      expect(dialog()).toBeNull();
      expect(notice()).toBe(
        'Added the Other (description required) expense of ₹1,250.50 on 20 Oct 2026.',
      );
      await flush(expectAccountList(), expenseList([PACKAGING]));
    });

    it('adds a workspace-wide expense in the workspace view', async () => {
      await openAdd('/expenses?scope=workspace');
      expect(textOf(dialog()?.querySelector('[data-testid="expense-target"]'))).toBe(
        'Adds a workspace-wide expense to Asha Textiles (it belongs to no single seller account).',
      );
      setValue(control('category'), 'staff');
      typeInto(control('amount'), '8000');
      await stable();
      save();
      await stable();
      const req = httpTesting.expectOne({ method: 'POST', url: '/api/v1/workspaces/10/expenses' });
      expect(req.request.body).toEqual({ expenseDate: TODAY, category: 'staff', amount: '8000' });
      req.flush(expense({ id: '904', scope: 'workspace', sellerAccountId: null }));
      await stable();
      await flush(expectWorkspaceList(), expenseList([RENT]));
    });

    it('shows the API’s field reasons under the fields and keeps the dialog', async () => {
      await openAdd();
      setValue(control('category'), 'packaging');
      typeInto(control('amount'), '10');
      await stable();
      save();
      await stable();
      httpTesting
        .expectOne('/api/v1/accounts/100/expenses')
        .flush(
          errorBody('VALIDATION_ERROR', 'Invalid body.', [
            { field: 'expenseDate', reasons: ['must not be after today (Asia/Kolkata)'] },
          ]),
          { status: 400, statusText: 'Bad Request' },
        );
      await stable();
      expect(dialog()).not.toBeNull();
      expect(errorFor(control('expenseDate'))).toBe('must not be after today (Asia/Kolkata)');
      expect(document.activeElement).toBe(control('expenseDate'));
    });

    it('edits an expense, sending only the changed fields (a cleared description is null)', async () => {
      await render();
      await flush(expectAccountList(), expenseList([PACKAGING]));
      buttonStartingWith('Edit', row('900'))?.click();
      await stable();
      expect(textOf(dialog()?.querySelector('h2'))).toBe('Edit expense');
      expect(textOf(dialog()?.querySelector('[data-testid="expense-target"]'))).toBe(
        'Belongs to the seller account Main store. This can’t be changed.',
      );
      expect(control('expenseDate').value).toBe('2026-10-05');
      expect(control('category').value).toBe('packaging');
      expect(control('description').value).toBe('Poly bags');
      expect(control('amount').value).toBe('1200.50');

      typeInto(control('description'), '');
      typeInto(control('amount'), '1300');
      await stable();
      save('Save changes');
      await stable();
      const req = httpTesting.expectOne({ method: 'PATCH', url: '/api/v1/expenses/900' });
      expect(req.request.body).toEqual({ description: null, amount: '1300' });
      req.flush(expense({ description: null, amount: '1300.00' }));
      await stable();
      expect(notice()).toBe('Saved the Packaging & labels expense of ₹1,300.00 on 5 Oct 2026.');
      await flush(expectAccountList(), expenseList([PACKAGING]));
    });

    it('closes an unchanged edit without a request ("1200.5" equals "1200.50")', async () => {
      await render();
      await flush(expectAccountList(), expenseList([PACKAGING]));
      buttonStartingWith('Edit', row('900'))?.click();
      await stable();
      typeInto(control('amount'), '1200.5');
      await stable();
      save('Save changes');
      await stable();
      expect(dialog()).toBeNull();
    });

    it('deletes after confirming, then reloads; Cancel keeps it', async () => {
      await render();
      await flush(expectAccountList(), expenseList([PACKAGING]));
      buttonStartingWith('Delete', row('900'))?.click();
      await stable();
      expect(textOf(alertDialog()?.querySelector('h2'))).toBe('Delete this expense?');
      expect(textOf(alertDialog())).toContain(
        'The Packaging & labels expense of ₹1,200.50 on 5 Oct 2026 is deleted for good.',
      );
      buttonByText('Cancel', alertDialog() as HTMLElement)?.click();
      await stable();
      expect(alertDialog()).toBeNull();

      buttonStartingWith('Delete', row('900'))?.click();
      await stable();
      buttonByText('Delete expense', alertDialog() as HTMLElement)?.click();
      await stable();
      httpTesting
        .expectOne({ method: 'DELETE', url: '/api/v1/expenses/900' })
        .flush(null, { status: 204, statusText: 'No Content' });
      await stable();
      expect(alertDialog()).toBeNull();
      expect(notice()).toBe('Deleted the Packaging & labels expense of ₹1,200.50 on 5 Oct 2026.');
      await flush(expectAccountList(), expenseList([], { amount: null, count: 0 }));
    });
  });

  describe('members', () => {
    it('see the list read-only with the note: no add, edit or delete', async () => {
      await render('/expenses', ME_MEMBER);
      await flush(expectAccountList(), expenseList([PACKAGING]));
      expect(textOf(host().querySelector('[data-testid="member-note"]'))).toBe(
        'You are a member of this workspace. Only owners can add, edit or delete expenses.',
      );
      expect(buttonStartingWith('Add')).toBeUndefined();
      expect(buttonStartingWith('Edit')).toBeUndefined();
      expect(buttonStartingWith('Delete')).toBeUndefined();
      expect(host().querySelectorAll('thead th')).toHaveLength(5);
      expect(textOf(host().querySelector('[data-testid="double-counting-note"]'))).toContain(
        DOUBLE_COUNTING_NOTE,
      );
    });
  });
});
