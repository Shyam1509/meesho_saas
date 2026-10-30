import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorBody } from '../../../testing/test-data';
import { provideApiHttpClient } from '../api/provide-api-http-client';
import { WorkspaceMember, WorkspaceSummary } from './workspace.models';
import { WorkspacesApiService } from './workspaces-api.service';

const SUMMARY: WorkspaceSummary = {
  id: '10',
  name: 'Asha Textiles',
  role: 'owner',
  createdAt: '2026-10-01T05:30:00.000Z',
};

const MEMBER: WorkspaceMember = {
  userId: '1',
  email: 'asha@example.com',
  displayName: 'Asha Rao',
  role: 'owner',
  joinedAt: '2026-10-01T05:30:00.000Z',
};

describe('WorkspacesApiService', () => {
  let service: WorkspacesApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WorkspacesApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('list() GETs /workspaces and unwraps items', async () => {
    const result = firstValueFrom(service.list());
    const req = httpTesting.expectOne('/api/v1/workspaces');
    expect(req.request.method).toBe('GET');
    req.flush({ items: [SUMMARY] });
    expect(await result).toEqual([SUMMARY]);
  });

  it('get() GETs /workspaces/:id', async () => {
    const result = firstValueFrom(service.get('10'));
    const req = httpTesting.expectOne('/api/v1/workspaces/10');
    expect(req.request.method).toBe('GET');
    req.flush(SUMMARY);
    expect(await result).toEqual(SUMMARY);
  });

  it('rename() PATCHes { name } to /workspaces/:id', async () => {
    const result = firstValueFrom(service.rename('10', 'New name'));
    const req = httpTesting.expectOne('/api/v1/workspaces/10');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'New name' });
    req.flush({ ...SUMMARY, name: 'New name' });
    expect((await result).name).toBe('New name');
  });

  it('members() GETs /workspaces/:id/members and unwraps items', async () => {
    const result = firstValueFrom(service.members('10'));
    const req = httpTesting.expectOne('/api/v1/workspaces/10/members');
    expect(req.request.method).toBe('GET');
    req.flush({ items: [MEMBER] });
    expect(await result).toEqual([MEMBER]);
  });

  it('maps a 404 (not a member) and a 403 (not an owner) to ApiErrors', async () => {
    const notFound = firstValueFrom(service.get('99'));
    httpTesting
      .expectOne('/api/v1/workspaces/99')
      .flush(errorBody('NOT_FOUND', 'Workspace not found.'), {
        status: 404,
        statusText: 'Not Found',
      });
    await expect(notFound).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });

    const forbidden = firstValueFrom(service.rename('20', 'X'));
    httpTesting
      .expectOne('/api/v1/workspaces/20')
      .flush(errorBody('FORBIDDEN', 'Only owners can do this.'), {
        status: 403,
        statusText: 'Forbidden',
      });
    await expect(forbidden).rejects.toMatchObject({
      status: 403,
      message: 'Only owners can do this.',
    });
  });

  it('encodes the id in the path', () => {
    service.get('1/../2').subscribe({ error: () => undefined });
    httpTesting.expectOne('/api/v1/workspaces/1%2F..%2F2').flush(SUMMARY);
  });
});
