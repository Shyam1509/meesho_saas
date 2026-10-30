import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ME_MEMBER, ME_OWNER, errorBody, textOf, typeInto } from '../../../testing/test-data';
import { provideApiHttpClient } from '../../core/api/provide-api-http-client';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { MeResponse } from '../../core/auth/auth.models';
import { WorkspaceMember } from '../../core/workspaces/workspace.models';
import { WorkspaceSettingsPage } from './workspace-settings-page';

const MEMBERS: WorkspaceMember[] = [
  {
    userId: '1',
    email: 'asha@example.com',
    displayName: 'Asha Rao',
    role: 'owner',
    joinedAt: '2026-10-01T12:00:00.000Z',
  },
  {
    userId: '2',
    email: 'ravi@example.com',
    displayName: null,
    role: 'member',
    joinedAt: '2026-10-15T12:00:00.000Z',
  },
];

describe('WorkspaceSettingsPage', () => {
  let fixture: ComponentFixture<WorkspaceSettingsPage>;
  let httpTesting: HttpTestingController;
  let auth: AuthStateService;

  const host = () => fixture.nativeElement as HTMLElement;
  /** The details list as [term, value] pairs. */
  const details = () =>
    Array.from(host().querySelectorAll('dt')).map((dt) => [
      textOf(dt),
      textOf(dt.nextElementSibling),
    ]);
  const nameInput = () => host().querySelector('#workspace-name') as HTMLInputElement | null;
  const saveButton = () => host().querySelector('button[type="submit"]') as HTMLButtonElement;
  const membersSection = () =>
    host().querySelector('section[aria-labelledby="workspace-members-heading"]') as HTMLElement;

  async function render(me: MeResponse, members: WorkspaceMember[] | null = MEMBERS) {
    auth.setSession(me);
    fixture = TestBed.createComponent(WorkspaceSettingsPage);
    await fixture.whenStable();
    if (members) {
      httpTesting
        .expectOne(`/api/v1/workspaces/${me.workspaces[0].id}/members`)
        .flush({ items: members });
      await fixture.whenStable();
    }
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthStateService);
  });

  afterEach(() => {
    httpTesting.verify();
    localStorage.clear();
  });

  it('shows the workspace name and the caller role', async () => {
    await render(ME_OWNER);
    expect(details()).toEqual([
      ['Name', 'Asha Textiles'],
      ['Your role', 'Owner'],
    ]);
  });

  it('lists members read-only and says management comes later', async () => {
    await render(ME_OWNER);
    const rows = Array.from(membersSection().querySelectorAll('tbody tr')).map((r) =>
      Array.from(r.querySelectorAll('th, td')).map((c) => textOf(c)),
    );
    expect(rows).toEqual([
      ['Asha Rao', 'asha@example.com', 'Owner', '1 Oct 2026'],
      ['—No name set', 'ravi@example.com', 'Member', '15 Oct 2026'],
    ]);
    // The dash is decoration; screen readers get "No name set".
    const unnamed = membersSection().querySelectorAll('tbody tr')[1].querySelector('th');
    expect(unnamed?.querySelector('[aria-hidden="true"]')?.textContent).toBe('—');
    expect(textOf(unnamed?.querySelector('.sr-only'))).toBe('No name set');
    expect(textOf(membersSection())).toContain('arrives in a later milestone');
    expect(membersSection().querySelectorAll('button')).toHaveLength(0);
  });

  it('shows loading, then error with retry, for the members list', async () => {
    await render(ME_OWNER, null);
    expect(membersSection().dataset['state']).toBe('loading');
    expect(textOf(membersSection().querySelector('[role="status"]'))).toBe('Loading members…');

    httpTesting
      .expectOne('/api/v1/workspaces/10/members')
      .flush(errorBody('INTERNAL_ERROR', 'An unexpected error occurred. Please try again later.'), {
        status: 500,
        statusText: 'Server Error',
      });
    await fixture.whenStable();
    expect(textOf(membersSection().querySelector('[role="alert"]'))).toContain(
      'An unexpected error occurred. Please try again later. (request ID req-1)',
    );

    (membersSection().querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    httpTesting.expectOne('/api/v1/workspaces/10/members').flush({ items: MEMBERS });
    await fixture.whenStable();
    expect(membersSection().querySelectorAll('tbody tr')).toHaveLength(2);
  });

  describe('owner', () => {
    it('renames the workspace and updates the shared state', async () => {
      await render(ME_OWNER);
      expect(nameInput()?.value).toBe('Asha Textiles');

      typeInto(nameInput() as HTMLInputElement, '  Asha Fabrics ');
      saveButton().click();
      await fixture.whenStable();

      const req = httpTesting.expectOne('/api/v1/workspaces/10');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ name: 'Asha Fabrics' });
      expect(saveButton().getAttribute('aria-disabled')).toBe('true');

      req.flush({
        id: '10',
        name: 'Asha Fabrics',
        role: 'owner',
        createdAt: '2026-10-01T05:30:00.000Z',
      });
      await fixture.whenStable();

      expect(auth.workspaces()[0].name).toBe('Asha Fabrics');
      expect(details()[0]).toEqual(['Name', 'Asha Fabrics']);
      expect(textOf(host().querySelector('[aria-live="polite"]'))).toBe(
        'Workspace renamed to Asha Fabrics.',
      );
    });

    it('validates the name before sending', async () => {
      await render(ME_OWNER);
      typeInto(nameInput() as HTMLInputElement, '   ');
      saveButton().click();
      await fixture.whenStable();

      httpTesting.expectNone('/api/v1/workspaces/10');
      expect(textOf(host().querySelector('#workspace-name-error'))).toBe('Enter a workspace name.');
      expect(document.activeElement).toBe(nameInput());

      typeInto(nameInput() as HTMLInputElement, 'x'.repeat(121));
      saveButton().click();
      await fixture.whenStable();
      httpTesting.expectNone('/api/v1/workspaces/10');
      expect(textOf(host().querySelector('#workspace-name-error'))).toBe(
        'Workspace name must be at most 120 characters.',
      );
    });

    it('shows a server rejection and focuses it', async () => {
      await render(ME_OWNER);
      typeInto(nameInput() as HTMLInputElement, 'New name');
      saveButton().click();
      await fixture.whenStable();

      httpTesting
        .expectOne('/api/v1/workspaces/10')
        .flush(errorBody('FORBIDDEN', 'Only owners can rename this workspace.'), {
          status: 403,
          statusText: 'Forbidden',
        });
      await fixture.whenStable();

      const alert = host().querySelector('[role="alert"]');
      expect(textOf(alert)).toBe('Only owners can rename this workspace.');
      expect(document.activeElement).toBe(alert);
      expect(auth.workspaces()[0].name).toBe('Asha Textiles');
    });
  });

  it('members see the role and no rename form', async () => {
    await render(ME_MEMBER);
    expect(details()).toEqual([
      ['Name', 'Bharat Traders'],
      ['Your role', 'Member'],
    ]);
    expect(nameInput()).toBeNull();
    expect(textOf(host())).toContain('Only owners can rename this workspace.');
  });
});
