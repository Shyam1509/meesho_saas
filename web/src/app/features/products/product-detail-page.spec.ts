import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  ME_TWO_WORKSPACES,
  costEntry,
  errorBody,
  productDetail,
  textOf,
  typeInto,
} from '../../../testing/test-data';
import { provideApiHttpClient } from '../../core/api/provide-api-http-client';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { ProductDetail } from '../../core/products/product.models';
import { dateStringInTimeZone } from '../../shared/format/format';
import { addDays } from './cost-entry-dialog/cost-entry-dialog';
import { ProductDetailPage, sortCostHistory } from './product-detail-page';

const TODAY = dateStringInTimeZone(new Date(), 'Asia/Kolkata');

describe('ProductDetailPage', () => {
  let fixture: ComponentFixture<ProductDetailPage>;
  let httpTesting: HttpTestingController;

  const host = () => fixture.nativeElement as HTMLElement;
  const stable = () => fixture.whenStable();
  const state = () => (host().querySelector('[data-state]') as HTMLElement).dataset['state'];
  const field = (label: string) => {
    const dt = Array.from(host().querySelectorAll('[data-testid="product-fields"] dt')).find(
      (d) => textOf(d) === label,
    );
    return dt?.nextElementSibling as HTMLElement;
  };
  const historyRows = () =>
    Array.from(host().querySelectorAll('[data-testid="cost-history"] tbody tr'));
  const costRow = (id: string) =>
    host().querySelector(`tr[data-cost-id="${id}"]`) as HTMLElement | null;
  const buttonByText = (text: string, root: ParentNode = host()) =>
    Array.from(root.querySelectorAll('button')).find((b) => textOf(b) === text) as
      | HTMLButtonElement
      | undefined;
  const buttonStartingWith = (text: string, root: ParentNode = host()) =>
    Array.from(root.querySelectorAll('button')).find((b) => textOf(b).startsWith(text)) as
      | HTMLButtonElement
      | undefined;
  const dialog = () => host().querySelector('[role="dialog"]') as HTMLElement | null;
  const alertDialog = () => host().querySelector('[role="alertdialog"]') as HTMLElement | null;
  const dialogInput = (name: string) =>
    dialog()?.querySelector(`[formcontrolname="${name}"]`) as HTMLInputElement;
  const errorFor = (input: HTMLInputElement) => {
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    return textOf(host().querySelector(`#${ids[ids.length - 1]}`));
  };
  const notice = () => textOf(host().querySelector('[data-testid="product-notice"]'));

  /**
   * Opens the page as the owner of workspace 10 and member of workspace 20 (`ME_TWO_WORKSPACES`)
   * and answers the product (in workspace 10 unless given). Only one request: the role comes from
   * the product's `workspaceId`.
   */
  async function render(
    product: ProductDetail | null = productDetail(),
    productId = '700',
  ): Promise<void> {
    TestBed.inject(AuthStateService).setSession(ME_TWO_WORKSPACES);
    fixture = TestBed.createComponent(ProductDetailPage);
    fixture.componentRef.setInput('productId', productId);
    await stable();
    if (product) {
      httpTesting.expectOne(`/api/v1/products/${productId}`).flush(product);
      await stable();
    }
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

  describe('fields and cost history', () => {
    it('shows loading, then the fields, the cost rule and the history newest first', async () => {
      TestBed.inject(AuthStateService).setSession(ME_TWO_WORKSPACES);
      fixture = TestBed.createComponent(ProductDetailPage);
      fixture.componentRef.setInput('productId', '700');
      await stable();
      expect(state()).toBe('loading');
      expect(textOf(host().querySelector('h1'))).toBe('Product details');

      // The API sends newest first; the page keeps that order even if it did not.
      const shuffled = productDetail({
        costHistory: [
          costEntry({ id: '799', effectiveFrom: '2026-08-01', unitCost: '200.0000' }),
          costEntry(),
          costEntry({ id: '800', unitCost: '230.5000', effectiveFrom: '2026-09-01', note: null }),
        ],
      });
      httpTesting.expectOne('/api/v1/products/700').flush(shuffled);
      await stable();

      expect(state()).toBe('ready');
      expect(textOf(host().querySelector('h1'))).toBe('Product KURTA-M');
      expect(textOf(field('SKU'))).toBe('KURTA-M');
      expect(textOf(field('Name'))).toBe('Cotton kurta Edit name');
      expect(textOf(field('Catalog ID'))).toBe('CAT-5');
      expect(textOf(field('Status'))).toBe('Active');
      expect(textOf(field('Unit cost today'))).toBe('₹250.00 since 1 Oct 2026');
      expect(textOf(field('Orders'))).toBe('12');
      expect(textOf(field('Orders without cost'))).toBe(
        '2 No cost covers their order date, so their product cost is unknown (not ₹0).',
      );
      expect(field('Orders without cost').querySelector('span')?.className).toContain(
        'text-amber-800',
      );
      expect(textOf(host().querySelector('[data-testid="cost-rule"]'))).toBe(
        'Each unit cost applies from its effective date until the next one starts. Product cost = the unit cost effective on the order date × quantity. Orders dated before a product’s first cost have an unknown cost, never ₹0. Costs are never edited: to correct one, delete it and add the right one.',
      );

      expect(historyRows().map((r) => r.getAttribute('data-cost-id'))).toEqual([
        '801',
        '800',
        '799',
      ]);
      const cells = (r: Element) =>
        Array.from(r.querySelectorAll('th, td')).map((c) => textOf(c));
      expect(cells(historyRows()[0])).toEqual([
        '1 Oct 2026 Current',
        '₹250.00',
        'October price',
        expect.stringMatching(/^Asha Rao 30 Oct 2026, /),
        'Delete the cost from 1 Oct 2026',
      ]);
      const second = cells(historyRows()[1]);
      expect(second[0]).toMatch(/^1 Sept? 2026$/);
      expect(second[1]).toBe('₹230.50');
      expect(textOf(historyRows()[1].querySelector('td:nth-of-type(2) .sr-only'))).toBe('No note');
      expect(host().querySelector('a[href="/products"]')?.textContent).toContain('All products');
    });

    it('marks a cost that starts after today as planned and shows "Unknown" with no current cost', async () => {
      const future = addDays(TODAY, 30);
      await render(
        productDetail({
          currentCost: null,
          costHistory: [costEntry({ id: '805', effectiveFrom: future, unitCost: '12.3456' })],
        }),
      );
      expect(
        Array.from(field('Unit cost today').querySelectorAll('span')).map((s) => textOf(s)),
      ).toEqual(['Unknown', 'No cost is in effect today.']);
      expect(field('Unit cost today').querySelector('span')?.className).toContain('amber');
      expect(textOf(costRow('805')?.querySelector('th'))).toMatch(/Planned$/);
      expect(textOf(costRow('805')?.querySelectorAll('td')[0])).toBe('₹12.3456');
    });

    it('sortCostHistory orders by effective date, newest first', () => {
      const ids = sortCostHistory([
        costEntry({ id: '1', effectiveFrom: '2026-01-01' }),
        costEntry({ id: '2', effectiveFrom: '2026-03-01' }),
        costEntry({ id: '3', effectiveFrom: '2026-02-01' }),
      ]).map((e) => e.id);
      expect(ids).toEqual(['2', '3', '1']);
    });

    it('explains an empty history: every order’s cost is unknown', async () => {
      await render(productDetail({ costHistory: [], currentCost: null, costCount: 0 }));
      expect(textOf(host().querySelector('[data-testid="no-costs"]'))).toBe(
        'No unit cost yet. Every order of this product has an unknown cost until a cost covers its order date. Add the cost and the date it applies from.',
      );
    });
  });

  describe('not found and errors', () => {
    it('shows "not found" for a malformed id without calling the API', async () => {
      await render(null, 'abc');
      expect(state()).toBe('not-found');
      expect(textOf(host().querySelector('[role="alert"]'))).toContain('This product was not found.');
    });

    it('shows "not found" for a 404', async () => {
      await render(null);
      httpTesting
        .expectOne('/api/v1/products/700')
        .flush(errorBody('NOT_FOUND', 'Product not found.'), {
          status: 404,
          statusText: 'Not Found',
        });
      await stable();
      expect(state()).toBe('not-found');
    });

    it('shows other errors with "Try again"', async () => {
      await render(null);
      httpTesting.expectOne('/api/v1/products/700').error(new ProgressEvent('error'));
      await stable();
      expect(state()).toBe('error');
      buttonByText('Try again')?.click();
      await stable();
      httpTesting.expectOne('/api/v1/products/700').flush(productDetail());
      await stable();
      expect(state()).toBe('ready');
    });
  });

  describe('roles', () => {
    it('members see the history read-only: no "Add cost", no "Delete"', async () => {
      await render(productDetail({ sellerAccountId: '200', workspaceId: '20' }));
      expect(buttonByText('Add cost')).toBeUndefined();
      expect(buttonStartingWith('Delete')).toBeUndefined();
      expect(host().querySelectorAll('[data-testid="cost-history"] thead th')).toHaveLength(4);
      expect(textOf(host().querySelector('[data-testid="member-note"]'))).toBe(
        'You are a member of this workspace. Only owners can add or delete unit costs.',
      );
      // Members may still rename and archive.
      expect(buttonByText('Edit name')).toBeDefined();
      expect(buttonByText('Archive product')).toBeDefined();
    });

    it('owners of the product’s workspace get "Add cost" and "Delete"', async () => {
      await render();
      expect(buttonByText('Add cost')).toBeDefined();
      expect(buttonStartingWith('Delete')).toBeDefined();
      expect(host().querySelector('[data-testid="member-note"]')).toBeNull();
    });

    it('stays read-only for costs when the response has no workspaceId', async () => {
      const withoutWorkspace: Partial<ProductDetail> = { ...productDetail() };
      delete withoutWorkspace.workspaceId;
      await render(withoutWorkspace as ProductDetail);
      expect(buttonByText('Add cost')).toBeUndefined();
      expect(buttonStartingWith('Delete')).toBeUndefined();
      expect(textOf(host().querySelector('[data-testid="member-note"]'))).toContain(
        'could not be checked',
      );
    });

    it('a workspace the user is not in counts as read-only', async () => {
      await render(productDetail({ workspaceId: '99' }));
      expect(buttonByText('Add cost')).toBeUndefined();
    });
  });

  describe('add cost (owner)', () => {
    async function openAddCost(): Promise<void> {
      await render();
      buttonByText('Add cost')?.click();
      await stable();
      expect(dialog()).not.toBeNull();
    }

    function submitCost(): void {
      buttonByText('Save cost', dialog() as HTMLElement)?.click();
    }

    it('validates the date and unit cost, focusing the first invalid field', async () => {
      await openAddCost();
      expect(textOf(dialog()?.querySelector('h2'))).toBe('Add unit cost for KURTA-M');
      expect(document.activeElement).toBe(dialogInput('effectiveFrom'));

      submitCost();
      await stable();
      expect(errorFor(dialogInput('effectiveFrom'))).toBe('Enter the date this cost applies from.');
      expect(errorFor(dialogInput('unitCost'))).toBe('Enter the unit cost.');
      expect(document.activeElement).toBe(dialogInput('effectiveFrom'));

      typeInto(dialogInput('effectiveFrom'), addDays(TODAY, 400));
      typeInto(dialogInput('unitCost'), '12.34567');
      await stable();
      submitCost();
      await stable();
      expect(errorFor(dialogInput('effectiveFrom'))).toMatch(
        /^The date can be at most 366 days ahead \(latest .+\)\.$/,
      );
      expect(errorFor(dialogInput('unitCost'))).toBe(
        'Enter rupees as a number with up to 4 decimals, for example 249.5 (no ₹ sign or commas).',
      );

      typeInto(dialogInput('effectiveFrom'), '2026-11-01');
      typeInto(dialogInput('unitCost'), '100000000');
      await stable();
      submitCost();
      await stable();
      expect(errorFor(dialogInput('unitCost'))).toBe('The unit cost must be less than ₹10,00,00,000.');
      expect(document.activeElement).toBe(dialogInput('unitCost'));
    });

    it('POSTs the cost, refreshes the product and announces it', async () => {
      await openAddCost();
      typeInto(dialogInput('effectiveFrom'), '2026-11-01');
      typeInto(dialogInput('unitCost'), ' 260.5 ');
      typeInto(dialogInput('note'), ' New supplier ');
      await stable();
      submitCost();
      await stable();
      expect(buttonByText('Saving…', dialog() as HTMLElement)?.getAttribute('aria-disabled')).toBe(
        'true',
      );
      const req = httpTesting.expectOne({
        method: 'POST',
        url: '/api/v1/products/700/cost-history',
      });
      expect(req.request.body).toEqual({
        effectiveFrom: '2026-11-01',
        unitCost: '260.5',
        note: 'New supplier',
      });
      req.flush(costEntry({ id: '806', effectiveFrom: '2026-11-01', unitCost: '260.5000' }), {
        status: 201,
        statusText: 'Created',
      });
      await stable();
      expect(dialog()).toBeNull();
      expect(notice()).toBe('Added a unit cost of ₹260.50 from 1 Nov 2026.');

      const refreshed = productDetail({
        ordersWithoutCost: 0,
        costHistory: [
          costEntry({ id: '806', effectiveFrom: '2026-11-01', unitCost: '260.5000' }),
          ...productDetail().costHistory,
        ],
      });
      httpTesting.expectOne({ method: 'GET', url: '/api/v1/products/700' }).flush(refreshed);
      await stable();
      expect(historyRows().map((r) => r.getAttribute('data-cost-id'))).toEqual([
        '806',
        '801',
        '800',
      ]);
      expect(textOf(field('Orders without cost'))).toBe('0');
    });

    it('allows a unit cost of 0 (a real zero)', async () => {
      await openAddCost();
      typeInto(dialogInput('effectiveFrom'), '2026-10-15');
      typeInto(dialogInput('unitCost'), '0');
      await stable();
      submitCost();
      await stable();
      const req = httpTesting.expectOne('/api/v1/products/700/cost-history');
      expect(req.request.body).toEqual({ effectiveFrom: '2026-10-15', unitCost: '0' });
      req.flush(costEntry({ id: '807', unitCost: '0.0000', effectiveFrom: '2026-10-15' }));
      await stable();
      expect(notice()).toBe('Added a unit cost of ₹0.00 from 15 Oct 2026.');
      httpTesting.expectOne('/api/v1/products/700').flush(productDetail());
      await stable();
    });

    it('shows a 409 naming effectiveFrom (a cost already starts that day) under the date', async () => {
      await openAddCost();
      typeInto(dialogInput('effectiveFrom'), '2026-10-01');
      typeInto(dialogInput('unitCost'), '255');
      await stable();
      submitCost();
      await stable();
      httpTesting
        .expectOne('/api/v1/products/700/cost-history')
        .flush(
          errorBody('CONFLICT', 'A cost already starts on this date.', [
            { field: 'effectiveFrom', reasons: ['already has a cost for this product'] },
          ]),
          { status: 409, statusText: 'Conflict' },
        );
      await stable();
      expect(dialog()).not.toBeNull();
      const date = dialogInput('effectiveFrom');
      expect(date.getAttribute('aria-invalid')).toBe('true');
      expect(errorFor(date)).toBe('already has a cost for this product');
      expect(document.activeElement).toBe(date);
      expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
    });

    it('shows a 409 without field details (e.g. account disabled) above the form', async () => {
      await openAddCost();
      typeInto(dialogInput('effectiveFrom'), '2026-10-01');
      typeInto(dialogInput('unitCost'), '255');
      await stable();
      submitCost();
      await stable();
      httpTesting
        .expectOne('/api/v1/products/700/cost-history')
        .flush(errorBody('CONFLICT', 'The seller account is disabled.'), {
          status: 409,
          statusText: 'Conflict',
        });
      await stable();
      const alert = dialog()?.querySelector('[role="alert"]') as HTMLElement;
      expect(textOf(alert)).toBe('The seller account is disabled.');
      expect(document.activeElement).toBe(alert);
      expect(dialogInput('effectiveFrom').hasAttribute('aria-invalid')).toBe(false);
    });

    it('refuses a unit cost with leading zeros, as the API does', async () => {
      await openAddCost();
      typeInto(dialogInput('effectiveFrom'), '2026-10-01');
      typeInto(dialogInput('unitCost'), '007.5');
      await stable();
      submitCost();
      await stable();
      expect(errorFor(dialogInput('unitCost'))).toBe(
        'Enter rupees as a number with up to 4 decimals, for example 249.5 (no ₹ sign or commas).',
      );
    });
  });

  describe('delete cost (owner)', () => {
    it('asks first; Cancel keeps it, confirming DELETEs and refreshes', async () => {
      await render();
      const deleteButton = buttonStartingWith('Delete', costRow('800') as HTMLElement);
      deleteButton?.click();
      await stable();
      expect(textOf(alertDialog()?.querySelector('h2'))).toMatch(
        /^Delete the unit cost from 1 Sept? 2026\?$/,
      );
      expect(textOf(alertDialog())).toContain('or have an unknown cost if there is none');

      buttonByText('Cancel', alertDialog() as HTMLElement)?.click();
      await stable();
      expect(alertDialog()).toBeNull();

      buttonStartingWith('Delete', costRow('800') as HTMLElement)?.click();
      await stable();
      buttonByText('Delete cost', alertDialog() as HTMLElement)?.click();
      await stable();
      httpTesting
        .expectOne({ method: 'DELETE', url: '/api/v1/products/700/cost-history/800' })
        .flush(null, { status: 204, statusText: 'No Content' });
      await stable();
      expect(alertDialog()).toBeNull();
      expect(notice()).toMatch(/^Deleted the unit cost of ₹230\.50 from 1 Sept? 2026\.$/);

      httpTesting
        .expectOne('/api/v1/products/700')
        .flush(productDetail({ costHistory: [costEntry()] }));
      await stable();
      expect(historyRows().map((r) => r.getAttribute('data-cost-id'))).toEqual(['801']);
    });

    it('keeps the dialog open with the error when the delete fails', async () => {
      await render();
      buttonStartingWith('Delete', costRow('801') as HTMLElement)?.click();
      await stable();
      buttonByText('Delete cost', alertDialog() as HTMLElement)?.click();
      await stable();
      httpTesting
        .expectOne('/api/v1/products/700/cost-history/801')
        .flush(errorBody('FORBIDDEN', 'Only owners can do this.'), {
          status: 403,
          statusText: 'Forbidden',
        });
      await stable();
      expect(textOf(alertDialog()?.querySelector('[role="alert"]'))).toBe(
        'Only owners can do this.',
      );
    });
  });

  describe('archive / restore and name', () => {
    it('archives after confirming, then offers Restore', async () => {
      await render();
      buttonByText('Archive product')?.click();
      await stable();
      expect(textOf(alertDialog()?.querySelector('h2'))).toBe('Archive KURTA-M?');
      expect(textOf(alertDialog())).toContain(
        'Archiving only hides it from the default product list (show archived products to see it). Its orders and unit costs still count',
      );
      buttonByText('Archive product', alertDialog() as HTMLElement)?.click();
      await stable();
      const req = httpTesting.expectOne({ method: 'PATCH', url: '/api/v1/products/700' });
      expect(req.request.body).toEqual({ status: 'archived' });
      req.flush(productDetail({ status: 'archived' }));
      await stable();
      expect(alertDialog()).toBeNull();
      expect(textOf(field('Status'))).toBe('Archived');
      expect(notice()).toBe(
        'Archived KURTA-M. It is hidden from the default product list; its orders and unit costs still count.',
      );

      buttonByText('Restore product')?.click();
      await stable();
      buttonByText('Restore product', alertDialog() as HTMLElement)?.click();
      await stable();
      const restore = httpTesting.expectOne('/api/v1/products/700');
      expect(restore.request.body).toEqual({ status: 'active' });
      restore.flush(productDetail());
      await stable();
      expect(textOf(field('Status'))).toBe('Active');
      expect(notice()).toBe('Restored KURTA-M.');
    });

    it('edits the name: a blank name clears it, an unchanged one sends nothing', async () => {
      await render();
      buttonByText('Edit name')?.click();
      await stable();
      const nameInput = host().querySelector('#product-name-input') as HTMLInputElement;
      expect(nameInput.value).toBe('Cotton kurta');
      expect(document.activeElement).toBe(nameInput);

      // Unchanged: closes without a request.
      buttonByText('Save name')?.click();
      await stable();
      expect(host().querySelector('#product-name-input')).toBeNull();

      buttonByText('Edit name')?.click();
      await stable();
      typeInto(host().querySelector('#product-name-input') as HTMLInputElement, '   ');
      await stable();
      buttonByText('Save name')?.click();
      await stable();
      const req = httpTesting.expectOne({ method: 'PATCH', url: '/api/v1/products/700' });
      expect(req.request.body).toEqual({ name: null });
      req.flush(productDetail({ name: null }));
      await stable();
      expect(textOf(field('Name'))).toBe('— Edit name');
      expect(notice()).toBe('Removed the product name.');
    });

    it('shows a too-long name as an error linked to the input', async () => {
      await render();
      buttonByText('Edit name')?.click();
      await stable();
      const nameInput = host().querySelector('#product-name-input') as HTMLInputElement;
      typeInto(nameInput, 'x'.repeat(513));
      await stable();
      buttonByText('Save name')?.click();
      await stable();
      expect(nameInput.getAttribute('aria-invalid')).toBe('true');
      expect(textOf(host().querySelector('#product-name-error'))).toBe(
        'Name must be at most 512 characters.',
      );
      expect(nameInput.getAttribute('aria-describedby')).toContain('product-name-error');
    });
  });
});
