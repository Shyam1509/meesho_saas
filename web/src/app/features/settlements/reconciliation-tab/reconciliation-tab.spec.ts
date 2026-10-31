import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  ME_MEMBER,
  ME_OWNER,
  errorBody,
  orderSummary,
  paged,
  reconciliationOverview,
  runSummary,
  sellerAccount,
  settlementEntry,
  textOf,
  unmatchedEntry,
} from '../../../../testing/test-data';
import { PagedResponse } from '../../../core/api/paged-response';
import { provideApiHttpClient } from '../../../core/api/provide-api-http-client';
import { AuthStateService } from '../../../core/auth/auth-state.service';
import { MeResponse } from '../../../core/auth/auth.models';
import { OrderSummary } from '../../../core/orders/order.models';
import {
  ReconciliationOverview,
  RunSummary,
} from '../../../core/reconciliation/reconciliation.models';
import { SettlementEntry } from '../../../core/settlements/settlement.models';
import { SettlementsPage } from '../settlements-page';
import { describeRun } from './reconciliation-tab';

@Component({ template: 'stub' })
class Stub {}

interface Answers {
  overview?: ReconciliationOverview;
  unmatched?: PagedResponse<SettlementEntry>;
  without?: PagedResponse<OrderSummary>;
  runs?: PagedResponse<RunSummary>;
}

describe('ReconciliationTab (Settlements page, Reconciliation tab)', () => {
  let harness: RouterTestingHarness;
  let httpTesting: HttpTestingController;
  let accountId: string;

  const host = () => harness.routeNativeElement as HTMLElement;
  const stable = () => harness.fixture.whenStable();
  const section = (id: string) => host().querySelector(`[data-testid="${id}"]`) as HTMLElement;
  const buttonByText = (text: string, root: ParentNode = host()) =>
    Array.from(root.querySelectorAll('button')).find((b) => textOf(b) === text) as
      | HTMLButtonElement
      | undefined;
  const dialog = () => host().querySelector('[role="dialog"]') as HTMLElement | null;
  const notice = () => textOf(host().querySelector('[data-testid="reconciliation-notice"]'));
  const base = () => `/api/v1/accounts/${accountId}/reconciliation`;

  /** Answers the four requests the tab makes (on open and after every refresh). */
  async function flushAll(answers: Answers = {}, pages = { unmatched: 1, without: 1, runs: 1 }) {
    httpTesting.expectOne(base()).flush(answers.overview ?? reconciliationOverview());
    httpTesting
      .expectOne(`${base()}/unmatched-settlements?page=${pages.unmatched}&pageSize=25`)
      .flush(answers.unmatched ?? paged([unmatchedEntry()], 1, 1, 25));
    httpTesting
      .expectOne(`${base()}/orders-without-settlement?page=${pages.without}&pageSize=25`)
      .flush(answers.without ?? paged([orderSummary({ id: '9010', subOrderNo: 'SO-1010', settlement: { entryCount: 0, amount: null } })], 1, 1, 25));
    httpTesting
      .expectOne(`${base()}/runs?page=${pages.runs}&pageSize=10`)
      .flush(answers.runs ?? paged([runSummary()], 1, 1, 10));
    await stable();
  }

  async function render(me: MeResponse = ME_OWNER, answers: Answers = {}): Promise<void> {
    TestBed.inject(AuthStateService).setSession(me);
    harness = await RouterTestingHarness.create('/settlements?tab=reconciliation');
    const workspaceId = me.workspaces[0].id;
    accountId = workspaceId === '10' ? '100' : '200';
    httpTesting
      .expectOne(`/api/v1/workspaces/${workspaceId}/accounts`)
      .flush({ items: [sellerAccount({ id: accountId, workspaceId, displayName: 'Main store' })] });
    await stable();
    await flushAll(answers);
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

  describe('overview', () => {
    it('shows counts and as-reported sums, labelled, plus the last run', async () => {
      await render();
      const cards = Array.from(section('settlement-cards').querySelectorAll(':scope > div')).map(
        (d) => textOf(d),
      );
      expect(cards).toEqual([
        'All entries 20',
        'Matched to an order 12 Settlement amount (as reported): ₹14,250.75',
        'Unmatched (need a look) 2 Settlement amount (as reported): ₹900.00',
        'Account-level (ads, referral, …) 6 Settlement amount (as reported): -₹320.50',
      ]);
      const orders = Array.from(section('order-cards').querySelectorAll(':scope > div')).map((d) =>
        textOf(d),
      );
      expect(orders).toEqual([
        'All orders 17',
        'With a matched settlement 12',
        'Without a matched settlement 5',
      ]);
      expect(textOf(section('overview'))).toContain(
        'Amounts are as reported by Meesho — not profit. TCS and TDS are shown separately and are not tax advice.',
      );
      expect(textOf(section('last-run'))).toMatch(
        /Last matching run \d{1,2} Oct 2026, .* · After an import · Completed · 12 matched/,
      );
    });

    it('shows "—" for a sum with no rows and says when nothing has run yet', async () => {
      await render(ME_OWNER, {
        overview: reconciliationOverview({
          lastRun: null,
          settlements: {
            total: 0,
            matched: 0,
            unmatched: 0,
            accountLevel: 0,
            matchedAmount: null,
            unmatchedAmount: null,
            accountLevelAmount: null,
          },
        }),
      });
      expect(textOf(section('settlement-cards'))).toContain(
        'Matched to an order 0 Settlement amount (as reported): — not reported',
      );
      expect(textOf(section('last-run'))).toContain('No matching run yet.');
    });

    it('shows an error with "Try again", which reloads everything', async () => {
      TestBed.inject(AuthStateService).setSession(ME_OWNER);
      harness = await RouterTestingHarness.create('/settlements?tab=reconciliation');
      accountId = '100';
      httpTesting
        .expectOne('/api/v1/workspaces/10/accounts')
        .flush({ items: [sellerAccount()] });
      await stable();
      httpTesting
        .expectOne(base())
        .flush(errorBody('INTERNAL_ERROR', 'Boom.'), { status: 500, statusText: 'Error' });
      httpTesting.expectOne(`${base()}/unmatched-settlements?page=1&pageSize=25`).flush(paged([]));
      httpTesting.expectOne(`${base()}/orders-without-settlement?page=1&pageSize=25`).flush(paged([]));
      httpTesting.expectOne(`${base()}/runs?page=1&pageSize=10`).flush(paged([]));
      await stable();
      expect(textOf(section('overview').querySelector('[role="alert"]'))).toContain(
        'The reconciliation overview could not be loaded.',
      );
      expect(textOf(section('no-unmatched'))).toBe('No unmatched settlement entries.');
      expect(textOf(section('no-runs'))).toBe('No matching runs yet.');

      buttonByText('Try again', section('overview'))?.click();
      await stable();
      await flushAll();
      expect(section('overview').dataset['state']).toBe('ready');
    });
  });

  describe('run matching now', () => {
    it('is open to members: POSTs a run, says what it found and refreshes everything', async () => {
      await render(ME_MEMBER);
      buttonByText('Run matching now')?.click();
      await stable();
      const req = httpTesting.expectOne({ method: 'POST', url: `${base()}/runs` });
      expect(buttonByText('Matching…')?.getAttribute('aria-disabled')).toBe('true');
      const run = runSummary({
        id: '41',
        triggerType: 'manual',
        importJobId: null,
        matchedCount: 3,
        unmatchedSettlementCount: 1,
        unmatchedOrderCount: 4,
        triggeredBy: { id: '2', displayName: 'Ravi Shah', email: 'ravi@example.com' },
      });
      req.flush(run, { status: 201, statusText: 'Created' });
      await stable();

      expect(notice()).toBe(
        'Matching finished: 3 entries newly matched. 1 unmatched settlement entry and 4 orders without a settlement remain.',
      );
      await flushAll({ runs: paged([run, runSummary()], 1, 2, 10) });
      const runRows = Array.from(section('runs').querySelectorAll('tbody tr'));
      expect(runRows.map((r) => r.getAttribute('data-run-id'))).toEqual(['41', '40']);
      expect(textOf(runRows[0])).toContain('Run by hand by Ravi Shah');
      expect(runRows[1].querySelector('a')?.getAttribute('href')).toBe('/imports/510');
    });

    it('shows a failed run and a rejected request as errors', async () => {
      await render();
      buttonByText('Run matching now')?.click();
      await stable();
      httpTesting
        .expectOne(`${base()}/runs`)
        .flush(runSummary({ status: 'failed', failureMessage: 'Database busy.' }), {
          status: 201,
          statusText: 'Created',
        });
      await stable();
      expect(textOf(section('overview'))).toContain('Matching failed: Database busy.');
      expect(notice()).toBe('');
      await flushAll();

      buttonByText('Run matching now')?.click();
      await stable();
      httpTesting
        .expectOne(`${base()}/runs`)
        .flush(errorBody('RATE_LIMITED', 'A run is already in progress.'), {
          status: 429,
          statusText: 'Too Many',
        });
      await stable();
      expect(textOf(section('overview'))).toContain('Matching could not be run.');
      expect(textOf(section('overview'))).toContain('A run is already in progress.');
      // A failed attempt may still be recorded as a run: everything reloads to show it.
      await flushAll({
        runs: paged([runSummary({ id: '42', status: 'failed', failureMessage: 'Busy.' })], 1, 1, 10),
      });
      expect(textOf(section('runs'))).toContain('Failed Busy.');
      expect(textOf(section('overview'))).toContain('A run is already in progress.');
    });

    it('shows the server’s 409 when an import is running for the account', async () => {
      await render();
      buttonByText('Run matching now')?.click();
      await stable();
      httpTesting
        .expectOne(`${base()}/runs`)
        .flush(errorBody('CONFLICT', 'An import or another change is running for this account; try again shortly.'), {
          status: 409,
          statusText: 'Conflict',
        });
      await stable();
      const alert = textOf(section('overview').querySelector('[role="alert"]'));
      expect(alert).toContain('Matching could not be run.');
      expect(alert).toContain('An import or another change is running for this account; try again shortly.');
      expect(notice()).toBe('');
      await flushAll();
    });

    it('describeRun() words a completed, running and failed run', () => {
      expect(describeRun(runSummary({ matchedCount: 1, unmatchedSettlementCount: 0, unmatchedOrderCount: 1 }))).toBe(
        'Matching finished: 1 entry newly matched. 0 unmatched settlement entries and 1 order without a settlement remain.',
      );
      expect(describeRun(runSummary({ status: 'running' }))).toContain('Matching has started.');
      expect(describeRun(runSummary({ status: 'failed', failureMessage: null }))).toBe(
        'Matching failed.',
      );
    });
  });

  describe('unmatched settlements and "Match to order…"', () => {
    it('offers no match action to a member', async () => {
      await render(ME_MEMBER);
      expect(section('unmatched').querySelector('tbody tr')).not.toBeNull();
      expect(buttonByText('Match to order… (entry TXN-2)')).toBeUndefined();
    });

    async function openDialog(): Promise<HTMLButtonElement> {
      await render();
      const trigger = buttonByText('Match to order… (entry TXN-2)') as HTMLButtonElement;
      trigger.focus();
      trigger.click();
      await stable();
      return trigger;
    }

    async function searchFor(q: string, items: OrderSummary[]): Promise<void> {
      const input = dialog()?.querySelector('#match-order-q') as HTMLInputElement;
      input.value = q;
      input.dispatchEvent(new Event('input'));
      buttonByText('Search', dialog() as HTMLElement)?.click();
      await stable();
      const req = httpTesting.expectOne((r) => r.url === '/api/v1/accounts/100/orders');
      expect(req.request.params.get('q')).toBe(q.trim() || null);
      expect(req.request.params.get('pageSize')).toBe('10');
      req.flush(paged(items, 1, items.length, 10));
      await stable();
    }

    it('opens an accessible dialog with focus in the search box; Escape closes it', async () => {
      const trigger = await openDialog();
      expect(dialog()?.getAttribute('aria-modal')).toBe('true');
      expect(textOf(dialog()?.querySelector('h2'))).toBe('Match settlement entry to an order');
      const entryFields = Array.from(
        dialog()?.querySelectorAll('[data-testid="match-entry"] > div') ?? [],
      ).map((d) => `${textOf(d.querySelector('dt'))}: ${textOf(d.querySelector('dd'))}`);
      expect(entryFields).toEqual([
        'Transaction ID: TXN-2',
        'Sub order no. in the sheet: SO-9999',
        'Payment date: 20 Oct 2026',
        'Settlement amount: ₹450.00',
      ]);
      expect(document.activeElement).toBe(dialog()?.querySelector('#match-order-q'));

      (dialog() as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await stable();
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('searches orders, requires a choice, then matches and refreshes everything', async () => {
      await openDialog();
      await searchFor(' SO-99 ', [
        orderSummary({ id: '9020', subOrderNo: 'SO-9999_1', settlement: { entryCount: 0, amount: null } }),
        orderSummary({ id: '9021', subOrderNo: 'SO-99A' }),
      ]);
      const options = Array.from(dialog()?.querySelectorAll('input[type="radio"]') ?? []);
      expect(options.length).toBe(2);
      expect(textOf(dialog()?.querySelector('legend'))).toBe('Orders (2 of 2)');
      expect(textOf(options[1].closest('li'))).toContain(
        'Already settled (as reported): ₹1,180.40 from 1 entry',
      );

      buttonByText('Match to the selected order', dialog() as HTMLElement)?.click();
      await stable();
      expect(textOf(dialog())).toContain('Choose the order to match this entry to.');
      httpTesting.expectNone({ method: 'POST', url: `${base()}/manual-match` });

      (options[0] as HTMLInputElement).click();
      await stable();
      buttonByText('Match to SO-9999_1', dialog() as HTMLElement)?.click();
      await stable();
      const req = httpTesting.expectOne({ method: 'POST', url: `${base()}/manual-match` });
      expect(req.request.body).toEqual({ settlementEntryId: '3002', orderId: '9020' });
      expect(dialog()?.getAttribute('aria-busy')).toBe('true');
      req.flush(
        settlementEntry({
          id: '3002',
          transactionId: 'TXN-2',
          match: { ...settlementEntry().match, method: 'manual', orderId: '9020', orderSubOrderNo: 'SO-9999_1' },
        }),
      );
      await stable();

      expect(dialog()).toBeNull();
      expect(notice()).toBe('Matched entry TXN-2 to order SO-9999_1.');
      await flushAll({ unmatched: paged([], 1, 0, 25) });
      expect(textOf(section('no-unmatched'))).toBe('No unmatched settlement entries.');
    });

    it.each([
      [404, 'NOT_FOUND', 'Order not found.', 'Not found in this account'],
      [409, 'CONFLICT', 'A superseded entry cannot be matched.', 'This entry cannot be matched now'],
      [409, 'CONFLICT', 'An import or another change is running for this account; try again shortly.', 'This entry cannot be matched now'],
    ])('shows a %s in the dialog and keeps it open', async (status, code, message, heading) => {
      await openDialog();
      await searchFor('', [orderSummary()]);
      (dialog()?.querySelector('input[type="radio"]') as HTMLInputElement).click();
      await stable();
      buttonByText('Match to SO-1001', dialog() as HTMLElement)?.click();
      await stable();
      httpTesting
        .expectOne(`${base()}/manual-match`)
        .flush(errorBody(code, message), { status, statusText: 'Error' });
      await stable();

      const failure = dialog()?.querySelector('[data-testid="match-failure"]') as HTMLElement;
      expect(failure.getAttribute('role')).toBe('alert');
      expect(textOf(failure)).toContain(heading);
      expect(textOf(failure)).toContain(message);
      expect(notice()).toBe('');

      buttonByText('Cancel', dialog() as HTMLElement)?.click();
      await stable();
      expect(dialog()).toBeNull();
    });

    it('after a match on the last page, goes to the page that still exists', async () => {
      await render(ME_OWNER, {
        unmatched: paged(
          Array.from({ length: 25 }, (_, i) => unmatchedEntry({ id: `${5000 + i}` })),
          1,
          26,
          25,
        ),
      });
      buttonByText('Next page', section('unmatched'))?.click();
      await stable();
      httpTesting
        .expectOne(`${base()}/unmatched-settlements?page=2&pageSize=25`)
        .flush(paged([unmatchedEntry({ id: '3002', transactionId: 'TXN-2' })], 2, 26, 25));
      await stable();

      buttonByText('Match to order… (entry TXN-2)')?.click();
      await stable();
      await searchFor('SO', [orderSummary()]);
      (dialog()?.querySelector('input[type="radio"]') as HTMLInputElement).click();
      await stable();
      buttonByText('Match to SO-1001', dialog() as HTMLElement)?.click();
      await stable();
      httpTesting.expectOne(`${base()}/manual-match`).flush(settlementEntry({ id: '3002' }));
      await stable();

      // 25 entries left: page 2 no longer exists, so page 1 is loaded (not an empty page 2).
      await flushAll({ unmatched: paged([unmatchedEntry()], 1, 25, 25) });
      expect(section('unmatched').querySelectorAll('tbody tr').length).toBe(1);
    });

    it('moves to the last page when the requested one comes back empty', async () => {
      await render(ME_OWNER, {
        unmatched: paged(
          Array.from({ length: 25 }, (_, i) => unmatchedEntry({ id: `${5000 + i}` })),
          1,
          30,
          25,
        ),
      });
      buttonByText('Next page', section('unmatched'))?.click();
      await stable();
      // Matched elsewhere meanwhile: only 25 are left, so page 2 comes back empty.
      httpTesting
        .expectOne(`${base()}/unmatched-settlements?page=2&pageSize=25`)
        .flush(paged([], 2, 25, 25));
      await stable();
      httpTesting
        .expectOne(`${base()}/unmatched-settlements?page=1&pageSize=25`)
        .flush(paged([unmatchedEntry()], 1, 25, 25));
      await stable();
      expect(section('unmatched').querySelectorAll('tbody tr').length).toBe(1);
      expect(textOf(section('unmatched').querySelector('app-pager'))).toContain(
        'Showing 1–25 of 25 entries',
      );
    });

    it('says when a search finds nothing or fails', async () => {
      await openDialog();
      await searchFor('ZZZ', []);
      expect(textOf(dialog()?.querySelector('[data-testid="match-results"]'))).toBe(
        'No orders found. Try another search.',
      );

      buttonByText('Search', dialog() as HTMLElement)?.click();
      await stable();
      httpTesting
        .expectOne((r) => r.url === '/api/v1/accounts/100/orders')
        .flush(errorBody('INTERNAL_ERROR', 'Boom.'), { status: 500, statusText: 'Error' });
      await stable();
      expect(textOf(dialog()?.querySelector('[data-testid="match-results"]'))).toContain(
        'The orders could not be searched: Boom.',
      );
    });
  });

  describe('orders without a settlement and run history', () => {
    it('filters the orders without a settlement by status', async () => {
      await render();
      const select = host().querySelector('#without-status') as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => textOf(o))).toEqual([
        'All statuses',
        'Shipped (3)',
        'Cancelled (2)',
      ]);
      expect(section('without-settlement').querySelector('tbody tr a')?.getAttribute('href')).toBe(
        '/accounts/100/orders/9010',
      );

      select.value = 'Cancelled';
      select.dispatchEvent(new Event('change'));
      await stable();
      const req = httpTesting.expectOne((r) => r.url === `${base()}/orders-without-settlement`);
      expect(req.request.params.getAll('status')).toEqual(['Cancelled']);
      expect(req.request.params.get('page')).toBe('1');
      req.flush(paged([], 1, 0, 25));
      await stable();
      expect(textOf(section('no-without'))).toBe(
        'No orders with this status are without a settlement.',
      );
    });

    it('pages through the run history', async () => {
      await render(ME_OWNER, {
        runs: paged(Array.from({ length: 10 }, (_, i) => runSummary({ id: `${50 - i}` })), 1, 12, 10),
      });
      expect(textOf(section('runs').querySelector('app-pager'))).toContain(
        'Showing 1–10 of 12 runs',
      );
      buttonByText('Next page', section('runs'))?.click();
      await stable();
      expect(section('runs').getAttribute('aria-busy')).toBe('true');
      httpTesting
        .expectOne(`${base()}/runs?page=2&pageSize=10`)
        .flush(paged([runSummary({ id: '30' }), runSummary({ id: '29' })], 2, 12, 10));
      await stable();
      expect(
        Array.from(section('runs').querySelectorAll('tbody tr')).map((r) =>
          r.getAttribute('data-run-id'),
        ),
      ).toEqual(['30', '29']);
    });
  });
});
