import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  ME_MEMBER,
  ME_OWNER,
  errorBody,
  sellerAccount,
  settlementEntry,
  settlementList,
  textOf,
  unmatchedEntry,
} from '../../../../testing/test-data';
import { provideApiHttpClient } from '../../../core/api/provide-api-http-client';
import { AuthStateService } from '../../../core/auth/auth-state.service';
import { MeResponse } from '../../../core/auth/auth.models';
import { SettlementEntry, SettlementTotals } from '../../../core/settlements/settlement.models';
import { SettlementsPage } from '../settlements-page';

@Component({ template: 'stub' })
class Stub {}

const ACCOUNT = sellerAccount({ id: '100', displayName: 'Main store' });
const MEMBER_ACCOUNT = sellerAccount({ id: '200', workspaceId: '20', displayName: 'B2' });

const ACCOUNT_LEVEL = settlementEntry({
  id: '3003',
  entryType: 'ads_cost',
  sheetName: 'Ads Cost',
  transactionId: 'ADS-1',
  subOrderNo: null,
  orderDate: null,
  settlementAmount: '-320.50',
  saleAmount: null,
  commissionAmount: null,
  shippingCharge: null,
  tcsAmount: null,
  tdsAmount: null,
  match: {
    state: 'account_level',
    method: null,
    orderId: null,
    orderSubOrderNo: null,
    matchedAt: null,
    matchedBy: null,
    autoMatchBlocked: false,
  },
});

describe('SettlementEntriesTab (Settlements page, Entries tab)', () => {
  let harness: RouterTestingHarness;
  let httpTesting: HttpTestingController;

  const host = () => harness.routeNativeElement as HTMLElement;
  const stable = () => harness.fixture.whenStable();
  const url = () => TestBed.inject(Router).url;
  const listSection = () => host().querySelector('[data-testid="entries-list"]') as HTMLElement;
  const rows = () => Array.from(host().querySelectorAll('[data-testid="entries-table"] tbody tr'));
  const row = (id: string) => host().querySelector(`tr[data-entry-id="${id}"]`) as HTMLElement;
  const cell = (id: string, column: string) =>
    textOf(row(id).querySelector(`[data-column="${column}"]`));
  const buttonByText = (text: string, root: ParentNode = host()) =>
    Array.from(root.querySelectorAll('button')).find((b) => textOf(b) === text) as
      | HTMLButtonElement
      | undefined;
  const dialog = () => host().querySelector('[role="alertdialog"]') as HTMLElement | null;
  const typeBox = (label: string) => {
    const lbl = Array.from(host().querySelectorAll('app-checkbox-group label')).find(
      (l) => textOf(l) === label,
    );
    return host().querySelector(`#${lbl?.getAttribute('for')}`) as HTMLInputElement;
  };

  function setValue(el: Element | null, value: string, event = 'change'): void {
    const field = el as HTMLInputElement | HTMLSelectElement;
    field.value = value;
    field.dispatchEvent(new Event(event));
  }

  function expectEntries(accountId = '100'): TestRequest {
    return httpTesting.expectOne((r) => r.url === `/api/v1/accounts/${accountId}/settlements`);
  }

  async function flushEntries(
    items: SettlementEntry[] = [settlementEntry(), unmatchedEntry(), ACCOUNT_LEVEL],
    totals: SettlementTotals = { settlementAmount: '1309.90', count: items.length },
    page = 1,
    total = items.length,
    accountId = '100',
  ): Promise<TestRequest> {
    const req = expectEntries(accountId);
    req.flush(settlementList(items, totals, page, total));
    await stable();
    return req;
  }

  async function render(start = '/settlements', me: MeResponse = ME_OWNER): Promise<void> {
    TestBed.inject(AuthStateService).setSession(me);
    harness = await RouterTestingHarness.create(start);
    const workspaceId = me.workspaces[0].id;
    httpTesting
      .expectOne(`/api/v1/workspaces/${workspaceId}/accounts`)
      .flush({ items: workspaceId === '10' ? [ACCOUNT, sellerAccount({ id: '101', displayName: 'Outlet' })] : [MEMBER_ACCOUNT] });
    await stable();
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'settlements', component: SettlementsPage },
            { path: 'accounts/:accountId/orders/:orderId', component: Stub },
            { path: 'imports/:importId', component: Stub },
          ],
          withComponentInputBinding(),
        ),
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

  describe('filters and the URL', () => {
    it('sends the URL’s filters (repeated entryType, includeSuperseded) and shows them', async () => {
      await render(
        '/settlements?entryType=order_payment&entryType=recovery&entryType=bogus&from=2026-10-01&to=2026-10-20&match=unmatched&q=TXN&includeSuperseded=true&sort=settlementAmount&page=2',
      );
      const req = expectEntries();
      expect(req.request.params.getAll('entryType')).toEqual(['order_payment', 'recovery']);
      expect(req.request.params.get('from')).toBe('2026-10-01');
      expect(req.request.params.get('to')).toBe('2026-10-20');
      expect(req.request.params.get('match')).toBe('unmatched');
      expect(req.request.params.get('q')).toBe('TXN');
      expect(req.request.params.get('includeSuperseded')).toBe('true');
      expect(req.request.params.get('sort')).toBe('settlementAmount');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('pageSize')).toBe('25');
      req.flush(settlementList([unmatchedEntry()], { settlementAmount: '450.00', count: 26 }, 2, 26));
      await stable();

      expect((host().querySelector('#entries-q') as HTMLInputElement).value).toBe('TXN');
      expect((host().querySelector('#entries-match') as HTMLSelectElement).value).toBe('unmatched');
      expect((host().querySelector('#entries-superseded') as HTMLInputElement).checked).toBe(true);
      expect(typeBox('Order payment').checked).toBe(true);
      expect(typeBox('Recovery').checked).toBe(true);
      expect(typeBox('Ads cost').checked).toBe(false);
    });

    it('sends only paging and the default sort without filters', async () => {
      await render();
      const req = expectEntries();
      expect(req.request.params.keys()).toEqual(['page', 'pageSize', 'sort']);
      expect(req.request.params.get('sort')).toBe('-paymentDate');
      req.flush(settlementList([]));
    });

    it('applies the filters to the URL, keeping the selected tab param', async () => {
      await render('/settlements?page=2');
      await flushEntries(undefined, undefined, 2, 30);

      typeBox('Ads cost').click();
      setValue(host().querySelector('#entries-date-from'), '2026-10-01');
      setValue(host().querySelector('#entries-match'), 'account_level');
      setValue(host().querySelector('#entries-q'), ' ADS ', 'input');
      (host().querySelector('#entries-superseded') as HTMLInputElement).click();
      await stable();
      buttonByText('Apply filters')?.click();
      await stable();

      expect(url()).toBe(
        '/settlements?entryType=ads_cost&from=2026-10-01&match=account_level&q=ADS&includeSuperseded=true',
      );
      const req = await flushEntries([ACCOUNT_LEVEL], { settlementAmount: '-320.50', count: 1 });
      expect(req.request.params.get('page')).toBe('1');
      expect(req.request.params.getAll('entryType')).toEqual(['ads_cost']);

      buttonByText('Clear filters')?.click();
      await stable();
      expect(url()).toBe('/settlements');
      await flushEntries();
    });

    it('sorts by settlement amount, largest first, then flips', async () => {
      await render();
      await flushEntries();
      const th = () =>
        host().querySelector('[data-sort-key="settlementAmount"]')?.closest('th') as HTMLElement;
      expect(th().hasAttribute('aria-sort')).toBe(false);

      (host().querySelector('button[data-sort-key="settlementAmount"]') as HTMLElement).click();
      await stable();
      expect(url()).toBe('/settlements?sort=-settlementAmount');
      await flushEntries();
      expect(th().getAttribute('aria-sort')).toBe('descending');

      (host().querySelector('button[data-sort-key="settlementAmount"]') as HTMLElement).click();
      await stable();
      expect(url()).toBe('/settlements?sort=settlementAmount');
      await flushEntries();
      expect(th().getAttribute('aria-sort')).toBe('ascending');
    });
  });

  describe('table and totals', () => {
    it('shows every amount as reported, the match state and a link to the matched order', async () => {
      await render();
      await flushEntries();

      expect(rows().map((r) => r.getAttribute('data-entry-id'))).toEqual(['3001', '3002', '3003']);
      expect(cell('3001', 'settlementAmount')).toBe('₹1,180.40');
      expect(cell('3001', 'saleAmount')).toBe('₹1,199.00');
      expect(cell('3001', 'commissionAmount')).toBe('-₹12.60');
      expect(cell('3001', 'tcsAmount')).toBe('-₹5.00');
      expect(cell('3001', 'tdsAmount')).toBe('-₹1.00');
      expect(cell('3001', 'returnAmount')).toBe('— not reported');
      expect(cell('3001', 'match')).toBe('Matched (auto) Order SO-1001');
      expect(row('3001').querySelector('[data-column="match"] a')?.getAttribute('href')).toBe(
        '/accounts/100/orders/9001',
      );
      expect(cell('3002', 'match')).toBe('Unmatched');
      expect(cell('3003', 'match')).toBe('Account-level');
      expect(cell('3003', 'tcsAmount')).toBe('— not reported');
      expect(textOf(row('3003'))).toContain('Ads cost');
      expect(row('3001').querySelector('a[href="/imports/510"]')).not.toBeNull();
    });

    it('totals every filtered entry from `totals`, "—" when there is no amount', async () => {
      await render();
      await flushEntries([settlementEntry()], { settlementAmount: '15250.75', count: 31 }, 1, 31);
      expect(textOf(host().querySelector('[data-testid="entries-total"]'))).toBe(
        'Total settlement amount (as reported) for 31 entries: ₹15,250.75',
      );

      buttonByText('Next page')?.click();
      await stable();
      expect(listSection().getAttribute('aria-busy')).toBe('true');
      await flushEntries([settlementEntry({ id: '4000' })], { settlementAmount: null, count: 1 }, 2, 31);
      expect(textOf(host().querySelector('[data-testid="entries-total"]'))).toBe(
        'Total settlement amount (as reported) for 1 entry: — not reported',
      );
    });

    it('marks superseded and estimated entries and says superseded ones are not summed', async () => {
      await render('/settlements?includeSuperseded=true');
      await flushEntries([
        settlementEntry({ supersededByEntryId: '3009', isEstimate: true }),
      ]);
      expect(
        Array.from(row('3001').querySelectorAll('th > span')).map((s) => textOf(s)),
      ).toEqual(['TXN-1', 'Estimate', 'Superseded (not summed)']);
      expect(textOf(listSection())).toContain('Superseded entries are listed but never summed.');
    });

    it('shows the empty, no-results and error states', async () => {
      await render();
      await flushEntries([], { settlementAmount: null, count: 0 });
      const empty = host().querySelector('[data-testid="no-entries"]') as HTMLElement;
      expect(textOf(empty)).toContain('No settlement entries for this account yet.');
      expect(empty.querySelector('a')?.getAttribute('href')).toBe('/imports');

      await harness.navigateByUrl('/settlements?match=unmatched');
      await flushEntries([], { settlementAmount: null, count: 0 });
      expect(textOf(host().querySelector('[data-testid="no-results"]'))).toContain(
        'No settlement entries match these filters.',
      );

      await harness.navigateByUrl('/settlements?match=matched');
      expectEntries().flush(errorBody('INTERNAL_ERROR', 'Boom.'), { status: 500, statusText: 'E' });
      await stable();
      const alert = textOf(listSection().querySelector('[role="alert"]'));
      expect(alert).toContain('The settlement entries could not be loaded.');
      expect(alert).toContain('Boom. (request ID req-1)');
      buttonByText('Try again')?.click();
      await stable();
      await flushEntries();
      expect(rows().length).toBe(3);
    });
  });

  describe('unmatch (owner only)', () => {
    it('is not offered to a member', async () => {
      await render('/settlements', ME_MEMBER);
      await flushEntries(undefined, undefined, 1, 3, '200');
      expect(rows().length).toBe(3);
      expect(
        host().querySelectorAll('[data-testid="entries-table"] button:not([data-sort-key])').length,
      ).toBe(0);
      const labels = Array.from(host().querySelectorAll('button')).map((b) => textOf(b));
      expect(labels.some((label) => label.startsWith('Unmatch'))).toBe(false);
    });

    it('is offered on matched rows only, asks first, and Cancel changes nothing', async () => {
      await render();
      await flushEntries();
      expect(buttonByText('Unmatch entry TXN-1', row('3001'))).toBeDefined();
      expect(row('3002').querySelector('button')).toBeNull();
      expect(row('3003').querySelector('button')).toBeNull();

      const trigger = buttonByText('Unmatch entry TXN-1', row('3001')) as HTMLButtonElement;
      trigger.focus();
      trigger.click();
      await stable();
      expect(textOf(dialog())).toContain('Unmatch this settlement entry?');
      expect(textOf(dialog())).toContain(
        'Entry TXN-1 will no longer be linked to order SO-1001. Automatic matching will skip it',
      );
      buttonByText('Cancel', dialog() as HTMLElement)?.click();
      await stable();
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(trigger);
      httpTesting.expectNone((r) => r.method === 'POST');
    });

    it('POSTs manual-unmatch, then reloads the list and says what happened', async () => {
      await render();
      await flushEntries();
      buttonByText('Unmatch entry TXN-1', row('3001'))?.click();
      await stable();
      buttonByText('Unmatch', dialog() as HTMLElement)?.click();
      await stable();

      const req = httpTesting.expectOne({
        method: 'POST',
        url: '/api/v1/accounts/100/reconciliation/manual-unmatch',
      });
      expect(req.request.body).toEqual({ settlementEntryId: '3001' });
      expect(textOf(dialog())).toContain('Unmatching…');
      req.flush(unmatchedEntry({ id: '3001', match: { ...unmatchedEntry().match, autoMatchBlocked: true } }));
      await stable();

      expect(dialog()).toBeNull();
      expect(textOf(host().querySelector('[data-testid="entries-notice"]'))).toBe(
        'Unmatched entry TXN-1 from order SO-1001. Automatic matching will skip it until it is matched by hand.',
      );
      await flushEntries([
        unmatchedEntry({ id: '3001', transactionId: 'TXN-1', match: { ...unmatchedEntry().match, autoMatchBlocked: true } }),
      ]);
      expect(cell('3001', 'match')).toBe('Unmatched Unmatched by hand: automatic matching skips it.');
    });

    it('is not offered on a superseded entry (the API refuses it)', async () => {
      await render('/settlements?includeSuperseded=true');
      await flushEntries([
        settlementEntry({ supersededByEntryId: '3009' }),
        settlementEntry({ id: '3010', transactionId: 'TXN-10' }),
      ]);
      expect(row('3001').querySelector('button')).toBeNull();
      expect(buttonByText('Unmatch entry TXN-10', row('3010'))).toBeDefined();
    });

    it('shows the server’s 409 when an import is running, keeping the dialog open', async () => {
      await render();
      await flushEntries();
      buttonByText('Unmatch entry TXN-1', row('3001'))?.click();
      await stable();
      buttonByText('Unmatch', dialog() as HTMLElement)?.click();
      await stable();
      httpTesting
        .expectOne('/api/v1/accounts/100/reconciliation/manual-unmatch')
        .flush(errorBody('CONFLICT', 'An import or another change is running for this account; try again shortly.'), {
          status: 409,
          statusText: 'Conflict',
        });
      await stable();
      expect(textOf(dialog()?.querySelector('[role="alert"]'))).toBe(
        'An import or another change is running for this account; try again shortly.',
      );
      expect(textOf(host().querySelector('[data-testid="entries-notice"]'))).toBe('');
    });

    it('keeps the dialog open with the server’s reason when the unmatch fails', async () => {
      await render();
      await flushEntries();
      buttonByText('Unmatch entry TXN-1', row('3001'))?.click();
      await stable();
      buttonByText('Unmatch', dialog() as HTMLElement)?.click();
      await stable();
      httpTesting
        .expectOne('/api/v1/accounts/100/reconciliation/manual-unmatch')
        .flush(errorBody('FORBIDDEN', 'Only an owner can do this.'), {
          status: 403,
          statusText: 'Forbidden',
        });
      await stable();
      expect(textOf(dialog()?.querySelector('[role="alert"]'))).toBe('Only an owner can do this.');
    });
  });
});
