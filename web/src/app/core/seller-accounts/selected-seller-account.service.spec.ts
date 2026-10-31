import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  ME_OWNER,
  ME_TWO_WORKSPACES,
  errorBody,
  sellerAccount,
} from '../../../testing/test-data';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { AuthStateService } from '../auth/auth-state.service';
import { MeResponse } from '../auth/auth.models';
import { WorkspaceContextService } from '../workspaces/workspace-context.service';
import { SellerAccount } from './seller-account.models';
import {
  LEGACY_IMPORT_ACCOUNT_STORAGE_PREFIX,
  SELECTED_ACCOUNT_STORAGE_PREFIX,
  SelectedSellerAccountService,
} from './selected-seller-account.service';

const MAIN = sellerAccount({ id: '100', displayName: 'Main store' });
const OUTLET = sellerAccount({ id: '101', displayName: 'outlet' });
const ARCHIVED = sellerAccount({ id: '102', displayName: 'Archived', status: 'disabled' });

describe('SelectedSellerAccountService', () => {
  let httpTesting: HttpTestingController;
  let service: SelectedSellerAccountService;

  function start(me: MeResponse = ME_OWNER): void {
    TestBed.inject(AuthStateService).setSession(me);
    service = TestBed.inject(SelectedSellerAccountService);
  }

  function flushAccounts(workspaceId = '10', accounts: SellerAccount[] = [OUTLET, MAIN, ARCHIVED]) {
    httpTesting.expectOne(`/api/v1/workspaces/${workspaceId}/accounts`).flush({ items: accounts });
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
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('is loading until the active accounts arrive, then selects the first by name', () => {
    start();
    service.refresh();
    expect(service.state()).toEqual({ kind: 'loading' });
    expect(service.selectedId()).toBeNull();

    flushAccounts();
    const state = service.state();
    expect(state.kind).toBe('ready');
    expect(state.kind === 'ready' && state.accounts.map((a) => a.id)).toEqual(['100', '101']);
    expect(service.selectedId()).toBe('100');
    expect(service.selected()?.displayName).toBe('Main store');
  });

  it('loads by itself (no page asked yet) and does not load twice when a page refreshes first', () => {
    start();
    TestBed.tick();
    flushAccounts();
    expect(service.selectedId()).toBe('100');

    // A page opening later asks again: one new request, nothing else.
    service.refresh();
    TestBed.tick();
    flushAccounts();
    expect(service.selectedId()).toBe('100');
  });

  it('restores the remembered account, ignoring one that is disabled or unknown', () => {
    localStorage.setItem(`${SELECTED_ACCOUNT_STORAGE_PREFIX}10`, '101');
    start();
    service.refresh();
    flushAccounts();
    expect(service.selectedId()).toBe('101');

    localStorage.setItem(`${SELECTED_ACCOUNT_STORAGE_PREFIX}10`, '102');
    service.refresh();
    flushAccounts();
    expect(service.selectedId()).toBe('100');
  });

  it('falls back to the key the Imports page used before (never writing it)', () => {
    localStorage.setItem(`${LEGACY_IMPORT_ACCOUNT_STORAGE_PREFIX}10`, '101');
    start();
    service.refresh();
    flushAccounts();
    expect(service.selectedId()).toBe('101');

    expect(service.select('100')).toBe(true);
    expect(localStorage.getItem(`${SELECTED_ACCOUNT_STORAGE_PREFIX}10`)).toBe('100');
    expect(localStorage.getItem(`${LEGACY_IMPORT_ACCOUNT_STORAGE_PREFIX}10`)).toBe('101');
  });

  it('select() takes only a loaded active account and remembers it per workspace', () => {
    start();
    service.refresh();
    flushAccounts();

    expect(service.select('102')).toBe(false);
    expect(service.select('999')).toBe(false);
    expect(service.selectedId()).toBe('100');

    expect(service.select('101')).toBe(true);
    expect(service.selectedId()).toBe('101');
    expect(localStorage.getItem(`${SELECTED_ACCOUNT_STORAGE_PREFIX}10`)).toBe('101');

    // Reloading (another page opens) keeps the pick.
    service.refresh();
    expect(service.selectedId()).toBeNull();
    flushAccounts();
    expect(service.selectedId()).toBe('101');
  });

  it('keeps this session’s pick when localStorage throws, and never fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    start();
    service.refresh();
    flushAccounts();
    expect(service.selectedId()).toBe('100');

    expect(service.select('101')).toBe(true);
    service.refresh();
    flushAccounts();
    expect(service.selectedId()).toBe('101');
  });

  it('reloads for another workspace, loading at once (no stale account in between)', () => {
    start(ME_TWO_WORKSPACES);
    service.refresh();
    flushAccounts();
    expect(service.selectedId()).toBe('100');

    TestBed.inject(WorkspaceContextService).select('20');
    expect(service.state()).toEqual({ kind: 'loading' });
    expect(service.selectedId()).toBeNull();

    TestBed.tick();
    flushAccounts('20', [sellerAccount({ id: '200', workspaceId: '20', displayName: 'B2' })]);
    expect(service.selectedId()).toBe('200');
  });

  it('is "no-workspace" without a request when the user has no workspace', () => {
    start({ ...ME_OWNER, workspaces: [] });
    service.refresh();
    TestBed.tick();
    expect(service.state()).toEqual({ kind: 'no-workspace' });
    httpTesting.expectNone(() => true);
  });

  it('reports an error and loads again on refresh()', () => {
    start();
    service.refresh();
    httpTesting
      .expectOne('/api/v1/workspaces/10/accounts')
      .flush(errorBody('INTERNAL_ERROR', 'Something broke.'), {
        status: 500,
        statusText: 'Server Error',
      });
    expect(service.state()).toEqual({
      kind: 'error',
      message: 'Something broke. (request ID req-1)',
    });
    expect(service.selectedId()).toBeNull();

    service.refresh();
    flushAccounts('10', [MAIN]);
    expect(service.selectedId()).toBe('100');
  });

  it('has no selection when the workspace has no active account', () => {
    start();
    service.refresh();
    flushAccounts('10', [ARCHIVED]);
    expect(service.state().kind).toBe('ready');
    expect(service.selectedId()).toBeNull();
    expect(service.selected()).toBeNull();
  });
});
