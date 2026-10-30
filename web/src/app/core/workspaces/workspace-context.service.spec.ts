import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ME_MEMBER, ME_TWO_WORKSPACES } from '../../../testing/test-data';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { AuthStateService } from '../auth/auth-state.service';
import {
  SELECTED_WORKSPACE_STORAGE_KEY,
  WorkspaceContextService,
} from './workspace-context.service';

describe('WorkspaceContextService', () => {
  let auth: AuthStateService;

  /**
   * Creates the services after the test has prepared localStorage (the stored choice is read once,
   * when the auth state and its workspace store are first created, as at app startup).
   */
  function createContext(): WorkspaceContextService {
    auth = TestBed.inject(AuthStateService);
    const context = TestBed.inject(WorkspaceContextService);
    auth.setSession(ME_TWO_WORKSPACES);
    return context;
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('falls back to the first workspace when nothing is stored', () => {
    const context = createContext();
    expect(context.selectedId()).toBe('10');
    expect(context.role()).toBe('owner');
    expect(context.isOwner()).toBe(true);
  });

  it('restores a stored workspace the user still belongs to', () => {
    localStorage.setItem(SELECTED_WORKSPACE_STORAGE_KEY, '20');
    const context = createContext();
    expect(context.selectedId()).toBe('20');
    expect(context.role()).toBe('member');
    expect(context.isOwner()).toBe(false);
  });

  it.each([
    ['an id the user is not a member of', '999'],
    ['a malformed value', 'not-an-id'],
    ['a value with a leading zero', '010'],
  ])('ignores %s and falls back to the first workspace', (_label, stored) => {
    localStorage.setItem(SELECTED_WORKSPACE_STORAGE_KEY, stored);
    expect(createContext().selectedId()).toBe('10');
  });

  it('falls back to the first workspace when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    const context = createContext();
    expect(context.selectedId()).toBe('10');

    // Selecting still works for this session, it just is not remembered.
    expect(context.select('20')).toBe(true);
    expect(context.selectedId()).toBe('20');
  });

  it('select() switches and remembers only workspaces the user belongs to', () => {
    const context = createContext();

    expect(context.select('20')).toBe(true);
    expect(context.selectedId()).toBe('20');
    expect(localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY)).toBe('20');

    expect(context.select('999')).toBe(false);
    expect(context.selectedId()).toBe('20');
    expect(localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY)).toBe('20');
  });

  it('forgets the choice, in memory and in storage, when the session ends', () => {
    const context = createContext();
    context.select('20');
    expect(localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY)).toBe('20');

    auth.endSession();
    expect(localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY)).toBeNull();
    expect(context.selected()).toBeNull();

    // The next person to sign in (also a member of 20) starts on their first workspace.
    auth.setSession(ME_TWO_WORKSPACES);
    expect(context.selectedId()).toBe('10');
  });

  it('ending the session still works when localStorage throws', () => {
    const context = createContext();
    context.select('20');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });

    expect(() => auth.endSession()).not.toThrow();
    auth.setSession(ME_TWO_WORKSPACES);
    expect(context.selectedId()).toBe('10');
  });

  it('follows the memberships when another user signs in or the user signs out', () => {
    const context = createContext();
    context.select('10');

    auth.setSession(ME_MEMBER);
    expect(context.selectedId()).toBe('20');
    expect(context.isOwner()).toBe(false);

    auth.clear();
    expect(context.selected()).toBeNull();
    expect(context.role()).toBeNull();
  });
});
