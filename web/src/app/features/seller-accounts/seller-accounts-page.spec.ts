import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  ME_MEMBER,
  ME_OWNER,
  ME_TWO_WORKSPACES,
  errorBody,
  sellerAccount,
  textOf,
  typeInto,
} from '../../../testing/test-data';
import { provideApiHttpClient } from '../../core/api/provide-api-http-client';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { MeResponse } from '../../core/auth/auth.models';
import { WorkspaceContextService } from '../../core/workspaces/workspace-context.service';
import { SellerAccountsPage } from './seller-accounts-page';

const MAIN = sellerAccount({ id: '100', displayName: 'Main store', meeshoSupplierId: 'SUP_001' });
const OUTLET = sellerAccount({
  id: '101',
  displayName: 'Outlet',
  meeshoSupplierId: null,
  status: 'disabled',
});

describe('SellerAccountsPage', () => {
  let fixture: ComponentFixture<SellerAccountsPage>;
  let httpTesting: HttpTestingController;

  const host = () => fixture.nativeElement as HTMLElement;
  const section = () => host().querySelector('section[data-state]') as HTMLElement;
  const rows = () => Array.from(host().querySelectorAll('tbody tr'));
  const row = (id: string) => host().querySelector(`tr[data-account-id="${id}"]`) as HTMLElement;
  const rowButton = (id: string, label: string) =>
    Array.from(row(id).querySelectorAll('button')).find((b) =>
      textOf(b).startsWith(label),
    ) as HTMLButtonElement;
  const buttonByText = (text: string) =>
    Array.from(host().querySelectorAll('button')).find((b) => textOf(b) === text) as
      HTMLButtonElement | undefined;
  const dialog = () => host().querySelector('[role="alertdialog"]') as HTMLElement | null;
  const dialogButton = (text: string) =>
    Array.from(dialog()?.querySelectorAll('button') ?? []).find(
      (b) => textOf(b) === text,
    ) as HTMLButtonElement;
  const form = () => host().querySelector('app-seller-account-form') as HTMLElement | null;
  const formInput = (name: string) =>
    form()?.querySelector(`[formcontrolname="${name}"]`) as HTMLInputElement;
  const notice = () => textOf(host().querySelector('[aria-live="polite"]'));

  async function render(me: MeResponse = ME_OWNER): Promise<void> {
    TestBed.inject(AuthStateService).setSession(me);
    fixture = TestBed.createComponent(SellerAccountsPage);
    await fixture.whenStable();
  }

  async function renderWithAccounts(me: MeResponse = ME_OWNER, accounts = [OUTLET, MAIN]) {
    await render(me);
    const workspaceId = me.workspaces[0].id;
    httpTesting.expectOne(`/api/v1/workspaces/${workspaceId}/accounts`).flush({ items: accounts });
    await fixture.whenStable();
  }

  async function stable(): Promise<void> {
    await fixture.whenStable();
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    localStorage.clear();
  });

  describe('list states', () => {
    it('shows a loading state while the list is in flight', async () => {
      await render();
      expect(section().dataset['state']).toBe('loading');
      expect(section().getAttribute('aria-busy')).toBe('true');
      expect(textOf(section().querySelector('[role="status"]'))).toBe('Loading seller accounts…');
      httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: [] });
    });

    it('shows an empty state', async () => {
      await renderWithAccounts(ME_OWNER, []);
      expect(section().dataset['state']).toBe('ready');
      expect(section().getAttribute('aria-busy')).toBe('false');
      expect(textOf(section())).toContain('No seller accounts yet.');
      expect(textOf(section())).toContain('Add your Meesho supplier accounts');
      expect(host().querySelector('table')).toBeNull();
    });

    it('shows an error with "Try again", which reloads', async () => {
      await render();
      httpTesting
        .expectOne('/api/v1/workspaces/10/accounts')
        .flush(errorBody('NOT_FOUND', 'Workspace not found.'), {
          status: 404,
          statusText: 'Not Found',
        });
      await stable();

      const alert = section().querySelector('[role="alert"]');
      expect(textOf(alert)).toContain('The seller accounts could not be loaded.');
      expect(textOf(alert)).toContain('Workspace not found.');

      buttonByText('Try again')?.click();
      await stable();
      expect(section().dataset['state']).toBe('loading');
      httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: [MAIN] });
      await stable();
      expect(rows()).toHaveLength(1);
    });

    it('lists accounts sorted by name with supplier id ("—" when missing) and status', async () => {
      await renderWithAccounts();

      expect(rows().map((r) => textOf(r.querySelector('th')))).toEqual(['Main store', 'Outlet']);
      const mainCells = row('100').querySelectorAll('td');
      expect(textOf(mainCells[0])).toBe('SUP_001');
      expect(textOf(mainCells[1])).toBe('Active');
      const outletCells = row('101').querySelectorAll('td');
      expect(textOf(outletCells[0].querySelector('[aria-hidden="true"]'))).toBe('—');
      expect(textOf(outletCells[0].querySelector('.sr-only'))).toBe('Not set');
      expect(textOf(outletCells[1])).toBe('Disabled');
    });

    it('reloads when another workspace is selected', async () => {
      await renderWithAccounts(ME_TWO_WORKSPACES);
      expect(buttonByText('Add account')).toBeDefined();

      TestBed.inject(WorkspaceContextService).select('20');
      await stable();
      httpTesting.expectOne('/api/v1/workspaces/20/accounts').flush({ items: [] });
      await stable();

      expect(textOf(host())).toContain('Meesho supplier accounts in Bharat Traders.');
      expect(buttonByText('Add account')).toBeUndefined();
    });
  });

  describe('roles', () => {
    it('gives owners add, edit, disable and re-enable controls', async () => {
      await renderWithAccounts(ME_OWNER);
      expect(buttonByText('Add account')).toBeDefined();
      expect(textOf(rowButton('100', 'Edit'))).toBe('Edit Main store');
      expect(textOf(rowButton('100', 'Disable'))).toBe('Disable Main store');
      expect(textOf(rowButton('101', 'Re-enable'))).toBe('Re-enable Outlet');
      expect(host().querySelectorAll('thead th')).toHaveLength(4);
    });

    it('gives members a read-only list with a note', async () => {
      await renderWithAccounts(ME_MEMBER, [sellerAccount({ workspaceId: '20' })]);
      expect(host().querySelectorAll('button')).toHaveLength(0);
      expect(host().querySelectorAll('thead th')).toHaveLength(3);
      expect(textOf(host())).toContain('Only owners can add, edit, disable or re-enable');
    });
  });

  describe('add and edit (owner)', () => {
    it('adds an account: validates, POSTs trimmed values, inserts it and returns focus', async () => {
      await renderWithAccounts(ME_OWNER, [MAIN]);
      const addButton = buttonByText('Add account') as HTMLButtonElement;
      addButton.focus();
      addButton.click();
      await stable();

      expect(textOf(form()?.querySelector('h2'))).toBe('Add seller account');
      expect(document.activeElement).toBe(formInput('displayName'));

      // Client validation.
      typeInto(formInput('meeshoSupplierId'), 'bad id!');
      buttonByText('Save account')?.click();
      await stable();
      httpTesting.expectNone('/api/v1/workspaces/10/accounts');
      expect(textOf(form())).toContain('Enter a display name.');
      expect(textOf(form())).toContain(
        'Use only letters, numbers, hyphens (-) and underscores (_).',
      );
      expect(document.activeElement).toBe(formInput('displayName'));

      typeInto(formInput('displayName'), '  Festive store ');
      typeInto(formInput('meeshoSupplierId'), ' SUP-02 ');
      buttonByText('Save account')?.click();
      await stable();

      const req = httpTesting.expectOne('/api/v1/workspaces/10/accounts');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        displayName: 'Festive store',
        meeshoSupplierId: 'SUP-02',
      });
      req.flush(
        sellerAccount({ id: '102', displayName: 'Festive store', meeshoSupplierId: 'SUP-02' }),
        {
          status: 201,
          statusText: 'Created',
        },
      );
      await stable();

      expect(form()).toBeNull();
      expect(rows().map((r) => textOf(r.querySelector('th')))).toEqual([
        'Festive store',
        'Main store',
      ]);
      expect(notice()).toBe('Added Festive store.');
      expect(document.activeElement).toBe(addButton);
    });

    it('leaves a blank supplier id out of the create request', async () => {
      await renderWithAccounts(ME_OWNER, []);
      buttonByText('Add account')?.click();
      await stable();
      typeInto(formInput('displayName'), 'Main store');
      buttonByText('Save account')?.click();
      await stable();

      const req = httpTesting.expectOne('/api/v1/workspaces/10/accounts');
      expect(req.request.body).toEqual({ displayName: 'Main store' });
      req.flush(MAIN, { status: 201, statusText: 'Created' });
      await stable();
    });

    it('shows a 409 conflict under the field the API names and keeps the form open', async () => {
      await renderWithAccounts(ME_OWNER, [MAIN]);
      buttonByText('Add account')?.click();
      await stable();
      typeInto(formInput('displayName'), 'Main store');
      buttonByText('Save account')?.click();
      await stable();

      httpTesting
        .expectOne('/api/v1/workspaces/10/accounts')
        .flush(
          errorBody('CONFLICT', 'A seller account with these details already exists.', [
            { field: 'displayName', reasons: ['is already used in this workspace'] },
          ]),
          { status: 409, statusText: 'Conflict' },
        );
      await stable();

      expect(form()).not.toBeNull();
      expect(textOf(form()?.querySelector('[role="alert"]'))).toBe(
        'A seller account with these details already exists.',
      );
      const nameInput = formInput('displayName');
      expect(nameInput.getAttribute('aria-invalid')).toBe('true');
      const errorId = nameInput.getAttribute('aria-describedby') as string;
      expect(textOf(host().querySelector(`#${errorId}`))).toBe('is already used in this workspace');
      expect(document.activeElement).toBe(nameInput);
      expect(rows()).toHaveLength(1);

      // Editing the field clears the server error.
      typeInto(nameInput, 'Main store 2');
      await stable();
      expect(nameInput.hasAttribute('aria-invalid')).toBe(false);
    });

    it('edits an account, sending only the changed fields (clearing the supplier id)', async () => {
      await renderWithAccounts();
      const editButton = rowButton('100', 'Edit');
      editButton.focus();
      editButton.click();
      await stable();

      expect(textOf(form()?.querySelector('h2'))).toBe('Edit Main store');
      expect(formInput('displayName').value).toBe('Main store');
      expect(formInput('meeshoSupplierId').value).toBe('SUP_001');

      typeInto(formInput('meeshoSupplierId'), '');
      buttonByText('Save changes')?.click();
      await stable();

      const req = httpTesting.expectOne('/api/v1/accounts/100');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ meeshoSupplierId: null });
      req.flush({ ...MAIN, meeshoSupplierId: null });
      await stable();

      expect(form()).toBeNull();
      expect(textOf(row('100').querySelector('td'))).toContain('Not set');
      expect(notice()).toBe('Saved Main store.');
      expect(document.activeElement).toBe(editButton);
    });

    it('cancel closes the form without a request', async () => {
      await renderWithAccounts();
      rowButton('100', 'Edit').click();
      await stable();
      buttonByText('Cancel')?.click();
      await stable();
      expect(form()).toBeNull();
    });
  });

  describe('disable and re-enable (owner)', () => {
    it('asks for confirmation; Cancel sends nothing and returns focus', async () => {
      await renderWithAccounts();
      const disableButton = rowButton('100', 'Disable');
      disableButton.focus();
      disableButton.click();
      await stable();

      expect(textOf(dialog()?.querySelector('h2'))).toBe('Disable Main store?');
      dialogButton('Cancel').click();
      await stable();

      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(disableButton);
    });

    it('disables after confirmation (DELETE) and updates the row', async () => {
      await renderWithAccounts();
      const toggle = rowButton('100', 'Disable');
      toggle.focus();
      toggle.click();
      await stable();

      dialogButton('Disable account').click();
      await stable();
      const req = httpTesting.expectOne('/api/v1/accounts/100');
      expect(req.request.method).toBe('DELETE');
      expect(dialogButton('Disabling…').getAttribute('aria-disabled')).toBe('true');

      req.flush({ ...MAIN, status: 'disabled' });
      await stable();

      expect(dialog()).toBeNull();
      expect(textOf(row('100').querySelectorAll('td')[1])).toBe('Disabled');
      expect(textOf(rowButton('100', 'Re-enable'))).toBe('Re-enable Main store');
      expect(notice()).toBe('Disabled Main store.');
      expect(document.activeElement).toBe(toggle);
    });

    it('re-enables after confirmation (PATCH status active)', async () => {
      await renderWithAccounts();
      rowButton('101', 'Re-enable').click();
      await stable();

      expect(textOf(dialog()?.querySelector('h2'))).toBe('Re-enable Outlet?');
      dialogButton('Re-enable account').click();
      await stable();
      const req = httpTesting.expectOne('/api/v1/accounts/101');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status: 'active' });
      req.flush({ ...OUTLET, status: 'active' });
      await stable();

      expect(textOf(row('101').querySelectorAll('td')[1])).toBe('Active');
      expect(notice()).toBe('Re-enabled Outlet.');
    });

    it('keeps the dialog open with the error when the request fails', async () => {
      await renderWithAccounts();
      rowButton('100', 'Disable').click();
      await stable();
      dialogButton('Disable account').click();
      await stable();

      httpTesting
        .expectOne('/api/v1/accounts/100')
        .flush(errorBody('FORBIDDEN', 'Only owners can change seller accounts.'), {
          status: 403,
          statusText: 'Forbidden',
        });
      await stable();

      expect(textOf(dialog()?.querySelector('[role="alert"]'))).toBe(
        'Only owners can change seller accounts.',
      );
      expect(textOf(row('100').querySelectorAll('td')[1])).toBe('Active');
    });
  });
});
