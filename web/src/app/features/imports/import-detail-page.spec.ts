import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  ME_OWNER,
  errorBody,
  errorRow,
  importDetail,
  paged,
  textOf,
} from '../../../testing/test-data';
import { provideApiHttpClient } from '../../core/api/provide-api-http-client';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { ImportDetail } from '../../core/imports/import.models';
import { ImportDetailPage } from './import-detail-page';

const FAILED = importDetail({
  status: 'failed',
  errorRows: 0,
  validRows: 120,
  confirmedAt: '2026-10-30T08:35:00.000Z',
  failureMessage: 'The database was unavailable. Nothing was saved.',
});

const COMPLETED = importDetail({
  status: 'completed',
  insertedCount: 100,
  updatedCount: 17,
  unchangedCount: 0,
  historyOnlyCount: 2,
  confirmedAt: '2026-10-30T08:35:00.000Z',
  completedAt: '2026-10-30T08:35:02.000Z',
});

describe('ImportDetailPage', () => {
  let fixture: ComponentFixture<ImportDetailPage>;
  let httpTesting: HttpTestingController;

  const host = () => fixture.nativeElement as HTMLElement;
  const heading = () => host().querySelector('h1') as HTMLElement;
  const state = () => (host().querySelector('[data-state]') as HTMLElement).dataset['state'];
  const buttonByText = (text: string, root: ParentNode = host()) =>
    Array.from(root.querySelectorAll('button')).find((b) => textOf(b) === text) as
      | HTMLButtonElement
      | undefined;
  const actionLabels = () =>
    Array.from(host().querySelectorAll('[data-testid="import-actions"] button')).map((b) =>
      textOf(b),
    );
  const notice = () => textOf(host().querySelector('[data-testid="notice"]'));
  const dialog = () => host().querySelector('[role="alertdialog"]') as HTMLElement | null;
  const errorsTable = () => host().querySelector('app-import-errors-table') as HTMLElement;

  async function stable(): Promise<void> {
    await fixture.whenStable();
  }

  async function render(job: ImportDetail | null, importId = '500'): Promise<void> {
    fixture = TestBed.createComponent(ImportDetailPage);
    fixture.componentRef.setInput('importId', importId);
    await stable();
    if (job) {
      httpTesting.expectOne(`/api/v1/imports/${importId}`).flush(job);
      await stable();
    }
  }

  function flushErrors(page: number, total: number, count = 20): void {
    const first = (page - 1) * 20;
    httpTesting
      .expectOne(`/api/v1/imports/500/errors?page=${page}&pageSize=20`)
      .flush(
        paged(
          Array.from({ length: count }, (_, i) => errorRow(first + i + 2)),
          page,
          total,
        ),
      );
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(AuthStateService).setSession(ME_OWNER);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  describe('loading', () => {
    it('shows a loading state, then the import with a link back to all imports', async () => {
      await render(null);
      expect(state()).toBe('loading');
      expect(textOf(heading())).toBe('Import details');
      expect(textOf(host())).toContain('Loading the import…');
      expect(host().querySelector('a')?.getAttribute('href')).toBe('/imports');

      httpTesting.expectOne('/api/v1/imports/500').flush(importDetail());
      await stable();
      flushErrors(1, 3, 3);
      await stable();

      expect(state()).toBe('ready');
      expect(textOf(heading())).toBe('orders-oct.csv');
      expect(textOf(host().querySelector('app-import-status-badge'))).toBe('Previewed');
      expect(textOf(host())).toContain('What the import will do');
    });

    it('says when the import does not exist (404)', async () => {
      await render(null);
      httpTesting
        .expectOne('/api/v1/imports/500')
        .flush(errorBody('NOT_FOUND', 'Import not found.'), {
          status: 404,
          statusText: 'Not Found',
        });
      await stable();

      expect(state()).toBe('not-found');
      expect(textOf(host().querySelector('[role="alert"]'))).toContain(
        'This import was not found.',
      );
      expect(buttonByText('Try again')).toBeUndefined();
    });

    it('treats a 400 (malformed id) from the API as not found', async () => {
      await render(null, '9999999999');
      httpTesting
        .expectOne('/api/v1/imports/9999999999')
        .flush(errorBody('VALIDATION_ERROR', 'importId must be a positive integer.'), {
          status: 400,
          statusText: 'Bad Request',
        });
      await stable();
      expect(state()).toBe('not-found');
      expect(textOf(heading())).toBe('Import details');
    });

    it.each(['abc', '0', '12abc', '-5'])(
      'says "%s" is not found without asking the API',
      async (importId) => {
        await render(null, importId);
        httpTesting.expectNone((req) => req.url.startsWith('/api/v1/imports/'));
        expect(state()).toBe('not-found');
        expect(textOf(host().querySelector('[role="alert"]'))).toContain(
          'This import was not found.',
        );
      },
    );

    it('offers "Try again" after another error', async () => {
      await render(null);
      httpTesting
        .expectOne('/api/v1/imports/500')
        .flush(errorBody('INTERNAL_ERROR', 'Boom.'), { status: 500, statusText: 'Error' });
      await stable();
      expect(textOf(host().querySelector('[role="alert"]'))).toContain(
        'Boom. (request ID req-1)',
      );

      buttonByText('Try again')?.click();
      await stable();
      httpTesting.expectOne('/api/v1/imports/500').flush(COMPLETED);
      await stable();
      flushErrors(1, 3, 3);
      await stable();
      expect(state()).toBe('ready');
    });

    it('loads another import when the route parameter changes', async () => {
      await render(FAILED);
      fixture.componentRef.setInput('importId', '501');
      await stable();
      httpTesting
        .expectOne('/api/v1/imports/501')
        .flush({ ...COMPLETED, id: '501', originalFilename: 'settlement.xlsx' });
      await stable();
      httpTesting.expectOne('/api/v1/imports/501/errors?page=1&pageSize=20').flush(paged([]));
      await stable();
      expect(textOf(heading())).toBe('settlement.xlsx');
    });
  });

  describe('actions by status', () => {
    it('previewed: Confirm and Discard, Confirm gated by the skip box', async () => {
      await render(importDetail());
      flushErrors(1, 3, 3);
      await stable();

      expect(actionLabels()).toEqual(['Confirm import', 'Discard']);
      buttonByText('Confirm import')?.click();
      await stable();
      httpTesting.expectNone('/api/v1/imports/500/confirm');

      (host().querySelector('input[type="checkbox"]') as HTMLInputElement).click();
      await stable();
      buttonByText('Confirm import')?.click();
      await stable();
      const req = httpTesting.expectOne('/api/v1/imports/500/confirm');
      expect(req.request.body).toEqual({ skipErrorRows: true });
      req.flush(COMPLETED);
      await stable();

      const resultHeading = host().querySelector('app-import-result h2') as HTMLElement;
      expect(textOf(resultHeading)).toBe('Imported, 3 rows skipped');
      expect(document.activeElement).toBe(resultHeading);
      expect(host().querySelector('app-import-result a')).toBeNull();
      expect(host().querySelector('[data-testid="import-actions"]')).toBeNull();
      expect(notice()).toBe(
        'Imported orders-oct.csv: 100 inserted, 17 updated, 0 unchanged, 2 history only, 3 skipped.',
      );
    });

    it('failed: shows why, offers Retry and Discard (no Confirm); Retry completes it', async () => {
      await render(FAILED);

      expect(textOf(host().querySelector('[data-testid="failure"]'))).toContain(
        'The database was unavailable. Nothing was saved.',
      );
      expect(actionLabels()).toEqual(['Retry import', 'Discard']);
      buttonByText('Retry import')?.click();
      await stable();

      const req = httpTesting.expectOne('/api/v1/imports/500/retry');
      expect(req.request.method).toBe('POST');
      expect(buttonByText('Retrying…')?.getAttribute('aria-disabled')).toBe('true');
      req.flush({
        ...FAILED,
        status: 'completed',
        allowedActions: [],
        insertedCount: 120,
        updatedCount: 0,
        unchangedCount: 0,
        historyOnlyCount: 0,
        failureMessage: null,
      });
      await stable();

      const resultHeading = host().querySelector('app-import-result h2') as HTMLElement;
      expect(textOf(resultHeading)).toBe('Import completed');
      expect(document.activeElement).toBe(resultHeading);
      expect(actionLabels()).toEqual([]);
    });

    it('failed: a rejected retry shows the error and re-reads the job', async () => {
      await render(FAILED);
      buttonByText('Retry import')?.click();
      await stable();
      httpTesting
        .expectOne('/api/v1/imports/500/retry')
        .flush(errorBody('CONFLICT', 'Only a failed import can be retried.'), {
          status: 409,
          statusText: 'Conflict',
        });
      await stable();

      const box = host().querySelector('app-validation-summary [role="alert"]') as HTMLElement;
      expect(textOf(box)).toContain('The import could not be retried');
      expect(textOf(box)).toContain('Only a failed import can be retried.');
      expect(document.activeElement).toBe(box);

      httpTesting.expectOne('/api/v1/imports/500').flush(FAILED);
      await stable();
      expect(actionLabels()).toEqual(['Retry import', 'Discard']);
      expect(textOf(box)).toContain('Only a failed import can be retried.');
    });

    it('failed: Discard asks, then cancels it and focuses the heading', async () => {
      await render(FAILED);
      const discard = buttonByText('Discard') as HTMLButtonElement;
      discard.focus();
      discard.click();
      await stable();

      buttonByText('Discard import', dialog() as HTMLElement)?.click();
      await stable();
      const req = httpTesting.expectOne('/api/v1/imports/500/cancel');
      expect(buttonByText('Discarding…', dialog() as HTMLElement)?.getAttribute('aria-disabled')).toBe(
        'true',
      );
      req.flush({ ...FAILED, status: 'cancelled', allowedActions: [] });
      await stable();

      expect(dialog()).toBeNull();
      expect(textOf(host().querySelector('app-import-status-badge'))).toBe('Cancelled');
      expect(actionLabels()).toEqual([]);
      expect(notice()).toBe('Discarded the import of orders-oct.csv. Nothing was imported.');
      expect(document.activeElement).toBe(heading());
    });

    it('keeps the discard dialog open with the error when cancelling fails', async () => {
      await render(FAILED);
      buttonByText('Discard')?.click();
      await stable();
      buttonByText('Discard import', dialog() as HTMLElement)?.click();
      await stable();
      httpTesting
        .expectOne('/api/v1/imports/500/cancel')
        .flush(errorBody('CONFLICT', 'This import can no longer be discarded.'), {
          status: 409,
          statusText: 'Conflict',
        });
      await stable();
      expect(textOf(dialog()?.querySelector('[role="alert"]'))).toBe(
        'This import can no longer be discarded.',
      );
    });

    it('completed: shows the result and no actions', async () => {
      await render(COMPLETED);
      flushErrors(1, 3, 3);
      await stable();

      expect(textOf(host().querySelector('app-import-result h2'))).toBe(
        'Imported, 3 rows skipped',
      );
      expect(host().querySelector('[data-testid="import-actions"]')).toBeNull();
      expect(textOf(host().querySelector('#import-detail-preview-heading'))).toBe('Details');
      expect(textOf(host())).toContain('Planned at upload');
    });

    it('cancelled and importing: no actions (importing explains why)', async () => {
      await render(importDetail({ status: 'cancelled', errorRows: 0 }));
      expect(host().querySelector('[data-testid="import-actions"]')).toBeNull();
      expect(host().querySelector('app-import-result')).toBeNull();

      fixture.componentRef.setInput('importId', '501');
      await stable();
      httpTesting
        .expectOne('/api/v1/imports/501')
        .flush(importDetail({ id: '501', status: 'importing', errorRows: 0 }));
      await stable();
      expect(textOf(host().querySelector('[data-testid="importing-note"]'))).toContain(
        'This import is still running.',
      );
    });

    it('shows only the buttons the server allows', async () => {
      await render(importDetail({ errorRows: 0, allowedActions: ['cancel'] }));
      expect(actionLabels()).toEqual(['Discard']);

      fixture.componentRef.setInput('importId', '501');
      await stable();
      httpTesting
        .expectOne('/api/v1/imports/501')
        .flush(importDetail({ id: '501', status: 'failed', errorRows: 0, allowedActions: [] }));
      await stable();
      expect(host().querySelector('[data-testid="import-actions"]')).toBeNull();
    });

    it('a stale importing job offers Retry and Discard', async () => {
      await render(
        importDetail({
          status: 'importing',
          errorRows: 0,
          confirmedAt: '2026-10-30T07:00:00.000Z',
          allowedActions: ['retry', 'cancel'],
        }),
      );
      expect(textOf(host().querySelector('[data-testid="importing-note"]'))).toContain(
        'seems to have stopped',
      );
      expect(actionLabels()).toEqual(['Retry import', 'Discard']);

      buttonByText('Retry import')?.click();
      await stable();
      httpTesting
        .expectOne('/api/v1/imports/500/retry')
        .flush(importDetail({ status: 'completed', errorRows: 0, insertedCount: 120 }));
      await stable();
      expect(textOf(host().querySelector('app-import-result h2'))).toBe('Import completed');
    });

    it('cancelled: explains that the rows were deleted instead of showing errors', async () => {
      await render(importDetail({ status: 'cancelled' }));
      httpTesting.expectNone('/api/v1/imports/500/errors?page=1&pageSize=20');
      expect(host().querySelector('app-import-errors-table')).toBeNull();
      expect(textOf(host().querySelector('[data-testid="rows-deleted"]'))).toContain(
        'the rows read from the file, including the rows with errors, were deleted',
      );
      expect(host().querySelector('[data-testid="sample-table"]')).toBeNull();
      expect(host().querySelector('[data-testid="sheets-table"]')).not.toBeNull();
    });

    it('a previewed file with no valid rows cannot be confirmed', async () => {
      await render(importDetail({ validRows: 0, errorRows: 0 }));
      expect(textOf(host().querySelector('[data-testid="no-valid-rows"]'))).toContain(
        'there is nothing to import',
      );
      expect(actionLabels()).toEqual(['Discard']);
    });
  });

  describe('rows with errors', () => {
    it('pages through the errors on the server', async () => {
      await render(importDetail({ errorRows: 45 }));
      expect(errorsTable().querySelector('[data-state]')?.getAttribute('data-state')).toBe(
        'loading',
      );
      flushErrors(1, 45);
      await stable();

      const pager = errorsTable().querySelector('app-pager nav') as HTMLElement;
      expect(textOf(pager)).toContain('Showing 1–20 of 45 rows with errors');
      expect(errorsTable().querySelectorAll('tbody tr')).toHaveLength(20);
      expect(textOf(errorsTable().querySelector('tbody tr th'))).toBe('2');

      buttonByText('Next page', pager)?.click();
      await stable();
      expect(errorsTable().querySelector('[aria-busy="true"]')).not.toBeNull();
      flushErrors(2, 45);
      await stable();
      expect(textOf(errorsTable().querySelector('app-pager nav'))).toContain(
        'Showing 21–40 of 45 rows with errors',
      );
      expect(textOf(errorsTable().querySelector('tbody tr th'))).toBe('22');

      buttonByText('Next page', errorsTable())?.click();
      await stable();
      flushErrors(3, 45, 5);
      await stable();
      expect(errorsTable().querySelectorAll('tbody tr')).toHaveLength(5);
      expect(buttonByText('Next page', errorsTable())?.getAttribute('aria-disabled')).toBe('true');

      buttonByText('Previous page', errorsTable())?.click();
      await stable();
      flushErrors(2, 45);
      await stable();
      expect(textOf(errorsTable().querySelector('tbody tr th'))).toBe('22');
    });

    it('does not ask for errors when there are none', async () => {
      await render(importDetail({ errorRows: 0 }));
      httpTesting.expectNone('/api/v1/imports/500/errors?page=1&pageSize=20');
      expect(textOf(errorsTable())).toBe('No rows have errors.');
    });

    it('shows an error with "Try again" when the errors cannot be loaded', async () => {
      await render(importDetail());
      httpTesting
        .expectOne('/api/v1/imports/500/errors?page=1&pageSize=20')
        .flush(errorBody('INTERNAL_ERROR', 'Boom.'), { status: 500, statusText: 'Error' });
      await stable();
      expect(textOf(errorsTable())).toContain('The rows with errors could not be loaded.');

      buttonByText('Try again', errorsTable())?.click();
      await stable();
      flushErrors(1, 3, 3);
      await stable();
      expect(errorsTable().querySelectorAll('tbody tr')).toHaveLength(3);
    });
  });
});
