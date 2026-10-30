import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  ME_MEMBER,
  ME_OWNER,
  ME_TWO_WORKSPACES,
  chooseFiles,
  errorBody,
  errorRow,
  fakeFile,
  importDetail,
  paged,
  sellerAccount,
  textOf,
  typeInto,
} from '../../../testing/test-data';
import { provideApiHttpClient } from '../../core/api/provide-api-http-client';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { MeResponse } from '../../core/auth/auth.models';
import { ImportConfig, ImportDetail } from '../../core/imports/import.models';
import { SellerAccount } from '../../core/seller-accounts/seller-account.models';
import { WorkspaceContextService } from '../../core/workspaces/workspace-context.service';
import { IMPORT_ACCOUNT_STORAGE_PREFIX, ImportsPage } from './imports-page';

const MAIN = sellerAccount({ id: '100', displayName: 'Main store' });
const OUTLET = sellerAccount({ id: '101', displayName: 'Outlet', meeshoSupplierId: null });
const ARCHIVED = sellerAccount({ id: '102', displayName: 'Archived', status: 'disabled' });

const CLEAN = importDetail({ errorRows: 0, validRows: 120 });

describe('ImportsPage', () => {
  let fixture: ComponentFixture<ImportsPage>;
  let httpTesting: HttpTestingController;

  const host = () => fixture.nativeElement as HTMLElement;
  const accountSelect = () => host().querySelector('#imports-account') as HTMLSelectElement | null;
  const fileInput = () => host().querySelector('input[type="file"]') as HTMLInputElement;
  const buttonByText = (text: string, root: ParentNode = host()) =>
    Array.from(root.querySelectorAll('button')).find((b) => textOf(b) === text) as
      | HTMLButtonElement
      | undefined;
  const preview = () => host().querySelector('[data-testid="preview"]') as HTMLElement | null;
  const notice = () => textOf(host().querySelector('[data-testid="notice"]'));
  const history = () => host().querySelector('[data-testid="import-history"]') as HTMLElement;
  const historyRows = () => Array.from(history().querySelectorAll('tbody tr'));
  const dialog = () => host().querySelector('[role="alertdialog"]') as HTMLElement | null;
  const checkbox = () => host().querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  const summaryBox = () =>
    host().querySelector('app-validation-summary [role="alert"]') as HTMLElement | null;

  async function stable(): Promise<void> {
    await fixture.whenStable();
  }

  /** Creates the page and answers `GET /imports/config`. */
  async function create(
    me: MeResponse = ME_OWNER,
    config: ImportConfig = { maxFileMb: 10, maxRows: 50000 },
  ): Promise<void> {
    TestBed.inject(AuthStateService).setSession(me);
    fixture = TestBed.createComponent(ImportsPage);
    await stable();
    httpTesting.expectOne('/api/v1/imports/config').flush(config);
    await stable();
  }

  async function render(
    me: MeResponse = ME_OWNER,
    accounts: SellerAccount[] = [OUTLET, MAIN, ARCHIVED],
    config?: ImportConfig,
  ): Promise<void> {
    await create(me, config);
    httpTesting
      .expectOne(`/api/v1/workspaces/${me.workspaces[0].id}/accounts`)
      .flush({ items: accounts });
    await stable();
  }

  function flushHistory(accountId = '100', items: ImportDetail[] = [], page = 1, total?: number) {
    httpTesting
      .expectOne(`/api/v1/accounts/${accountId}/imports?page=${page}&pageSize=20`)
      .flush(paged(items, page, total ?? items.length));
  }

  async function renderWithHistory(items: ImportDetail[] = []): Promise<void> {
    await render();
    flushHistory('100', items);
    await stable();
  }

  /**
   * Chooses a file (with "Statuses as of" 29 Oct 2026 for a CSV), submits, and returns the pending
   * upload request.
   */
  async function submitUpload(file: File = fakeFile('orders-oct.csv', 20480)) {
    chooseFiles(fileInput(), [file]);
    await stable();
    const date = host().querySelector('input[type="date"]') as HTMLInputElement | null;
    if (date) {
      typeInto(date, '2026-10-29');
      await stable();
    }
    buttonByText('Upload and preview')?.click();
    await stable();
    return httpTesting.expectOne({ method: 'POST', url: '/api/v1/accounts/100/imports' });
  }

  /** Uploads and answers with `job`, then answers the error table and history reloads. */
  async function uploadToPreview(job: ImportDetail = importDetail()): Promise<void> {
    const req = await submitUpload();
    req.flush(job, { status: 201, statusText: 'Created' });
    await stable();
    if ((job.errorRows ?? 0) > 0) {
      httpTesting
        .expectOne(`/api/v1/imports/${job.id}/errors?page=1&pageSize=20`)
        .flush(paged([errorRow(7), errorRow(9), errorRow(14)], 1, job.errorRows ?? 0));
    }
    flushHistory('100', [job]);
    await stable();
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

  describe('seller account picker', () => {
    it('shows an empty state linking to Seller accounts when no account is active', async () => {
      await render(ME_OWNER, [ARCHIVED]);

      const empty = host().querySelector('[data-testid="no-accounts"]') as HTMLElement;
      expect(textOf(empty)).toContain('No active seller accounts.');
      expect(textOf(empty)).toContain('Add one (or re-enable a disabled one) first.');
      expect(empty.querySelector('a')?.getAttribute('href')).toBe('/seller-accounts');
      expect(accountSelect()).toBeNull();
      expect(fileInput()).toBeNull();
    });

    it('tells a member to ask an owner', async () => {
      await render(ME_MEMBER, []);
      expect(textOf(host())).toContain('Ask an owner of this workspace to add one.');
    });

    it('shows an error with "Try again" when the accounts cannot be loaded', async () => {
      await create();
      httpTesting
        .expectOne('/api/v1/workspaces/10/accounts')
        .flush(errorBody('INTERNAL_ERROR', 'Something broke.'), {
          status: 500,
          statusText: 'Server Error',
        });
      await stable();
      expect(textOf(host().querySelector('[role="alert"]'))).toContain(
        'The seller accounts could not be loaded.',
      );

      buttonByText('Try again')?.click();
      await stable();
      httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: [MAIN] });
      await stable();
      flushHistory();
      await stable();
      expect(accountSelect()?.value).toBe('100');
    });

    it('lists active accounts only, by name, and loads the first one’s history', async () => {
      await render();

      const select = accountSelect() as HTMLSelectElement;
      expect(host().querySelector(`label[for="imports-account"]`)?.textContent?.trim()).toBe(
        'Seller account',
      );
      expect(Array.from(select.options).map((o) => o.text.trim())).toEqual([
        'Main store',
        'Outlet',
      ]);
      expect(select.value).toBe('100');
      expect(history().dataset['state']).toBe('loading');

      flushHistory('100');
      await stable();
      expect(textOf(history())).toContain('No imports for this account yet.');
    });

    it('switching account loads its history, clears the preview and is remembered', async () => {
      await renderWithHistory();
      await uploadToPreview();
      expect(preview()).not.toBeNull();

      const select = accountSelect() as HTMLSelectElement;
      select.value = '101';
      select.dispatchEvent(new Event('change'));
      await stable();

      expect(preview()).toBeNull();
      expect(notice()).toBe('');
      expect(localStorage.getItem(`${IMPORT_ACCOUNT_STORAGE_PREFIX}10`)).toBe('101');
      flushHistory('101');
      await stable();
      expect(textOf(host())).toContain('For Outlet.');
    });

    it('restores the remembered account of the workspace, ignoring a stale one', async () => {
      localStorage.setItem(`${IMPORT_ACCOUNT_STORAGE_PREFIX}10`, '101');
      await render();
      expect(accountSelect()?.value).toBe('101');
      flushHistory('101');
      await stable();

      fixture.destroy();
      localStorage.setItem(`${IMPORT_ACCOUNT_STORAGE_PREFIX}10`, '102'); // disabled now
      await render();
      expect(accountSelect()?.value).toBe('100');
      flushHistory('100');
    });

    it('still works when localStorage throws', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Access denied', 'SecurityError');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });
      await renderWithHistory();

      const select = accountSelect() as HTMLSelectElement;
      select.value = '101';
      select.dispatchEvent(new Event('change'));
      await stable();
      flushHistory('101');
      await stable();
      expect(select.value).toBe('101');
    });

    it('reloads the accounts when another workspace is selected', async () => {
      await render(ME_TWO_WORKSPACES);
      flushHistory('100');
      await stable();

      TestBed.inject(WorkspaceContextService).select('20');
      await stable();
      httpTesting
        .expectOne('/api/v1/workspaces/20/accounts')
        .flush({ items: [sellerAccount({ id: '200', workspaceId: '20', displayName: 'B2' })] });
      await stable();
      flushHistory('200');
      await stable();
      expect(accountSelect()?.value).toBe('200');
    });
  });

  describe('upload and preview', () => {
    it('uploads the file, shows a pending state, then the preview with focus on it', async () => {
      await renderWithHistory();
      const req = await submitUpload();

      expect((req.request.body as FormData).get('file')).toBeInstanceOf(File);
      expect((req.request.body as FormData).get('dataAsOf')).toBe('2026-10-29');
      expect(textOf(host().querySelector('[data-testid="uploading"]'))).toBe(
        'Uploading and checking orders-oct.csv…',
      );
      expect(buttonByText('Uploading…')?.getAttribute('aria-disabled')).toBe('true');

      req.flush(importDetail(), { status: 201, statusText: 'Created' });
      await stable();

      const heading = host().querySelector('#imports-preview-heading') as HTMLElement;
      expect(textOf(heading)).toBe('Preview: orders-oct.csv');
      expect(document.activeElement).toBe(heading);
      expect(notice()).toBe(
        'Uploaded orders-oct.csv. Check the preview, then confirm or discard it.',
      );
      expect(host().querySelector('[data-testid="uploading"]')).toBeNull();
      // The form is ready for the next file.
      expect(textOf(host())).not.toContain('Selected:');

      // File details, counts and planned changes.
      const details = Array.from(
        preview()?.querySelectorAll('[data-testid="file-details"] dt') ?? [],
      ).map((dt) => `${textOf(dt)}: ${textOf(dt.nextElementSibling)}`);
      expect(details.slice(0, 3)).toEqual([
        'Report type: Orders (CSV)',
        'File: orders-oct.csv (20 KB)',
        'Report period: 1 Oct 2026 – 29 Oct 2026',
      ]);
      expect(details[3]).toMatch(/^Statuses as of: \d{1,2} \w{3} 2026, \d{1,2}:\d{2} [ap]m$/);
      expect(details[4]).toBe('Status: Previewed');
      expect(details[5]).toMatch(/^Uploaded: Asha Rao · 30 Oct 2026, /);
      const counts = Array.from(
        preview()?.querySelectorAll('[data-testid="row-counts"] dd') ?? [],
      ).map((dd) => textOf(dd));
      expect(counts).toEqual(['120', '117', '3']);
      const planned = Array.from(
        preview()?.querySelectorAll('[data-testid="planned-counts"] > div') ?? [],
      ).map((div) => textOf(div));
      expect(planned).toEqual([
        'New records 100',
        'Updates 15',
        'Unchanged 0',
        'History only (older than the saved status) 2',
        'Status events 117',
      ]);

      // Sheets and columns.
      const sheetRow = preview()?.querySelector('[data-testid="sheets-table"] tbody tr');
      const sheetCells = Array.from(sheetRow?.querySelectorAll('th, td') ?? []).map((c) =>
        textOf(c),
      );
      expect(sheetCells).toEqual([
        'orders-oct.csv',
        'Orders (CSV)',
        '120',
        '117',
        '3',
        'Sub Order No, Reason for Credit Entry, Order Date, Quantity',
        'Packet Id',
        'Customer Name',
      ]);

      // Sample rows: INR and dates formatted, 0 stays ₹0.00, a missing value is "—".
      const sample = preview()?.querySelector('[data-testid="sample-table"]') as HTMLElement;
      expect(
        Array.from(sample.querySelectorAll('thead th')).map((th) => textOf(th)),
      ).toEqual([
        'Row',
        'Action',
        'Sub order no.',
        'Status',
        'Order date',
        'Quantity',
        'Supplier listed price',
        'SKU',
      ]);
      const sampleRows = Array.from(sample.querySelectorAll('tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('th, td')).map((c) => textOf(c)),
      );
      expect(sampleRows).toEqual([
        ['2', 'Insert', 'SO-1001', 'Delivered', '5 Oct 2026', '1', '₹1,249.50', '—'],
        ['3', 'Update', 'SO-1002', 'Shipped', '6 Oct 2026', '2', '₹0.00', 'KURTA-M'],
      ]);

      // Rows with errors come from the errors endpoint.
      httpTesting
        .expectOne('/api/v1/imports/500/errors?page=1&pageSize=20')
        .flush(
          paged(
            [
              errorRow(7),
              errorRow(9, {
                errors: [
                  { field: 'quantity', reason: 'must be a whole number above 0' },
                  { field: 'subOrderNo', reason: 'also on row 4' },
                ],
              }),
            ],
            1,
            3,
          ),
        );
      flushHistory('100', [importDetail()]);
      await stable();

      const errorLines = Array.from(
        preview()?.querySelectorAll('app-import-errors-table tbody tr') ?? [],
      ).map((tr) => Array.from(tr.querySelectorAll('th, td')).map((c) => textOf(c)));
      expect(errorLines).toEqual([
        ['7', '—None', 'Order date', 'is not a date (use DD-MM-YYYY)'],
        ['9', '—None', 'Quantity', 'must be a whole number above 0'],
        ['9', '—None', 'Sub order no.', 'also on row 4'],
      ]);
      expect(historyRows()).toHaveLength(1);
    });

    it('shows a 422 PARSE_ERROR as a validation summary listing each problem', async () => {
      await renderWithHistory();
      const req = await submitUpload();
      req.flush(
        errorBody('PARSE_ERROR', 'The file does not look like a Meesho orders report.', [
          { field: 'subOrderNo', reasons: ['required column “Sub Order No” is missing'] },
          { field: 'Order Payments', reasons: ['two columns match “Final Settlement Amount”'] },
        ]),
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await stable();

      const box = summaryBox() as HTMLElement;
      expect(textOf(box.querySelector('p'))).toBe('The file could not be read');
      expect(textOf(box)).toContain('The file does not look like a Meesho orders report.');
      expect(Array.from(box.querySelectorAll('li')).map((li) => textOf(li))).toEqual([
        'Sub order no.: required column “Sub Order No” is missing',
        'Order Payments: two columns match “Final Settlement Amount”',
      ]);
      expect(document.activeElement).toBe(box);
      expect(preview()).toBeNull();
      // The chosen file stays, so the user can fix and retry.
      expect(textOf(host())).toContain('Selected: orders-oct.csv');
    });

    it('explains a 409 duplicate file', async () => {
      await renderWithHistory();
      const req = await submitUpload();
      req.flush(
        errorBody('CONFLICT', 'This file was already imported for this account (import 480).', [
          { field: 'file', reasons: ['same file as import 480'] },
        ]),
        { status: 409, statusText: 'Conflict' },
      );
      await stable();

      const box = summaryBox() as HTMLElement;
      expect(textOf(box)).toContain('This file cannot be uploaded');
      expect(textOf(box)).toContain('already imported for this account (import 480).');
      expect(textOf(box.querySelector('li'))).toBe('File: same file as import 480');
    });

    it('explains a 413 even when the response is not the API envelope', async () => {
      await renderWithHistory();
      const req = await submitUpload();
      req.flush('<html>Request Entity Too Large</html>', {
        status: 413,
        statusText: 'Payload Too Large',
      });
      await stable();

      const box = summaryBox() as HTMLElement;
      expect(Array.from(box.querySelectorAll('p')).map((p) => textOf(p))).toEqual([
        'The file is too large',
        'Files can be at most 10 MB.',
      ]);
    });

    it('says the server limit from GET /imports/config for a bare 413', async () => {
      await render(ME_OWNER, [MAIN], { maxFileMb: 25, maxRows: 50000 });
      flushHistory();
      await stable();
      const req = await submitUpload();
      req.flush('Too large', { status: 413, statusText: 'Payload Too Large' });
      await stable();
      expect(textOf(summaryBox()?.querySelectorAll('p')[1])).toBe('Files can be at most 25 MB.');
    });

    it.each([
      ['the server message', errorBody('RATE_LIMITED', 'Imports are busy, try again in a moment.')],
      ['a plain text for a bare 429', 'Too Many Requests'],
    ])('explains a 429 (busy) with %s', async (_label, body) => {
      await renderWithHistory();
      const req = await submitUpload();
      req.flush(body, { status: 429, statusText: 'Too Many Requests' });
      await stable();

      const box = summaryBox() as HTMLElement;
      expect(Array.from(box.querySelectorAll('p')).map((p) => textOf(p))).toEqual([
        'Imports are busy',
        'Imports are busy, try again in a moment.',
      ]);
      expect(document.activeElement).toBe(box);
      expect(preview()).toBeNull();
    });

    it('checks files against the limits from GET /imports/config', async () => {
      await render(ME_OWNER, [MAIN], { maxFileMb: 5, maxRows: 20000 });
      flushHistory();
      await stable();
      expect(textOf(host())).toContain('up to 5 MB and 20,000 rows.');

      chooseFiles(fileInput(), [fakeFile('six.csv', 6 * 1024 * 1024)]);
      await stable();
      expect(textOf(host())).toContain('“six.csv” is larger than 5 MB.');
    });

    it('falls back to the default 10 MB when the limits cannot be loaded', async () => {
      TestBed.inject(AuthStateService).setSession(ME_OWNER);
      fixture = TestBed.createComponent(ImportsPage);
      await stable();
      httpTesting
        .expectOne('/api/v1/imports/config')
        .flush(errorBody('INTERNAL_ERROR', 'Boom.'), { status: 500, statusText: 'Error' });
      httpTesting.expectOne('/api/v1/workspaces/10/accounts').flush({ items: [MAIN] });
      await stable();
      flushHistory();
      await stable();
      expect(textOf(host())).toContain('up to 10 MB.');
      expect(accountSelect()?.value).toBe('100');
    });

    it('requires the "Statuses as of" day for an orders CSV', async () => {
      await renderWithHistory();
      chooseFiles(fileInput(), [fakeFile('orders-oct.csv')]);
      await stable();
      buttonByText('Upload and preview')?.click();
      await stable();
      httpTesting.expectNone({ method: 'POST', url: '/api/v1/accounts/100/imports' });
      expect(textOf(host())).toContain('Enter the day you downloaded this report from Meesho.');
    });

    it('sends no dataAsOf for a settlement workbook', async () => {
      await renderWithHistory();
      const req = await submitUpload(fakeFile('settlement.xlsx', 4096));
      expect((req.request.body as FormData).has('dataAsOf')).toBe(false);
      req.flush(importDetail({ reportType: 'settlement_xlsx', errorRows: 0 }), {
        status: 201,
        statusText: 'Created',
      });
      await stable();
      flushHistory('100', [importDetail()]);
      await stable();
      expect(preview()).not.toBeNull();
    });

    it('never sends a file the client already rejected', async () => {
      await renderWithHistory();
      chooseFiles(fileInput(), [fakeFile('huge.csv', 11 * 1024 * 1024)]);
      await stable();
      buttonByText('Upload and preview')?.click();
      await stable();
      httpTesting.expectNone({ method: 'POST', url: '/api/v1/accounts/100/imports' });
      expect(textOf(host())).toContain('“huge.csv” is larger than 10 MB.');
    });
  });

  describe('confirm', () => {
    it('confirms a file without errors and shows the result with focus on it', async () => {
      await renderWithHistory();
      await uploadToPreview(CLEAN);

      expect(checkbox()).toBeNull();
      expect(textOf(preview())).toContain('All rows are valid.');
      expect(textOf(preview())).toContain('No rows have errors.');
      buttonByText('Confirm import')?.click();
      await stable();

      const req = httpTesting.expectOne('/api/v1/imports/500/confirm');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      expect(buttonByText('Importing…')?.getAttribute('aria-disabled')).toBe('true');

      req.flush({
        ...CLEAN,
        status: 'completed',
        allowedActions: [],
        insertedCount: 100,
        updatedCount: 20,
        unchangedCount: 0,
        historyOnlyCount: 0,
        confirmedAt: '2026-10-30T08:35:00.000Z',
        completedAt: '2026-10-30T08:35:02.000Z',
      });
      await stable();
      flushHistory('100', [CLEAN]);
      await stable();

      const result = host().querySelector('app-import-result section') as HTMLElement;
      expect(result.dataset['outcome']).toBe('success');
      const heading = result.querySelector('h2') as HTMLElement;
      expect(textOf(heading)).toBe('Import completed');
      expect(document.activeElement).toBe(heading);
      expect(
        Array.from(result.querySelectorAll('[data-testid="result-counts"] > div')).map((d) =>
          textOf(d),
        ),
      ).toEqual([
        'Inserted 100',
        'Updated 20',
        'Unchanged 0',
        'History only (older than the saved status) 0',
        'Skipped (errors) 0',
      ]);
      expect(result.querySelector('a')?.getAttribute('href')).toBe('/imports/500');
      expect(preview()).toBeNull();
      expect(notice()).toBe(
        'Imported orders-oct.csv: 100 inserted, 20 updated, 0 unchanged, 0 history only, 0 skipped.',
      );
    });

    it('requires the "skip the rows with errors" box, then sends skipErrorRows: true', async () => {
      await renderWithHistory();
      await uploadToPreview();

      const box = checkbox() as HTMLInputElement;
      expect(textOf(host().querySelector(`label[for="${box.id}"]`))).toBe(
        'Skip the 3 rows with errors',
      );
      expect(box.required).toBe(true);
      expect(box.checked).toBe(false);

      buttonByText('Confirm import')?.click();
      await stable();
      httpTesting.expectNone('/api/v1/imports/500/confirm');
      expect(box.getAttribute('aria-invalid')).toBe('true');
      expect(textOf(preview())).toContain(
        'Tick “Skip the 3 rows with errors” to import only the valid rows, or discard this import.',
      );
      expect(document.activeElement).toBe(box);

      box.click();
      await stable();
      expect(box.hasAttribute('aria-invalid')).toBe(false);
      buttonByText('Confirm import')?.click();
      await stable();

      const req = httpTesting.expectOne('/api/v1/imports/500/confirm');
      expect(req.request.body).toEqual({ skipErrorRows: true });
      req.flush(
        importDetail({
          status: 'completed',
          insertedCount: 100,
          updatedCount: 15,
          unchangedCount: 0,
          historyOnlyCount: 2,
        }),
      );
      await stable();
      flushHistory('100', [importDetail()]);
      await stable();

      const result = host().querySelector('app-import-result section') as HTMLElement;
      expect(result.dataset['outcome']).toBe('partial');
      expect(textOf(result.querySelector('h2'))).toBe('Imported, 3 rows skipped');
      expect(textOf(result)).toContain('Skipped (errors) 3');
      expect(notice()).toBe(
        'Imported orders-oct.csv: 100 inserted, 15 updated, 0 unchanged, 2 history only, 3 skipped.',
      );
    });

    it('shows a 409 from confirm and re-reads the job', async () => {
      await renderWithHistory();
      await uploadToPreview(CLEAN);
      buttonByText('Confirm import')?.click();
      await stable();

      httpTesting
        .expectOne('/api/v1/imports/500/confirm')
        .flush(errorBody('CONFLICT', 'This import is no longer waiting for confirmation.'), {
          status: 409,
          statusText: 'Conflict',
        });
      await stable();

      const box = summaryBox() as HTMLElement;
      expect(textOf(box)).toContain('The import could not be confirmed');
      expect(textOf(box)).toContain('This import is no longer waiting for confirmation.');
      expect(document.activeElement).toBe(box);

      // The job is re-read; it has been cancelled elsewhere meanwhile.
      httpTesting.expectOne('/api/v1/imports/500').flush({ ...CLEAN, status: 'cancelled', allowedActions: [] });
      await stable();
      flushHistory('100', [CLEAN]);
      await stable();
      expect(preview()).toBeNull();
    });

    it('a failed import (DB error) stays in the preview with Retry', async () => {
      await renderWithHistory();
      await uploadToPreview(CLEAN);
      buttonByText('Confirm import')?.click();
      await stable();

      httpTesting.expectOne('/api/v1/imports/500/confirm').flush({
        ...CLEAN,
        status: 'failed',
        allowedActions: ['retry', 'cancel'],
        failureMessage: 'The database was unavailable. Nothing was saved.',
      });
      await stable();
      flushHistory('100', [CLEAN]);
      await stable();

      expect(textOf(preview()?.querySelector('[data-testid="failure"]'))).toContain(
        'The database was unavailable. Nothing was saved.',
      );
      expect(buttonByText('Retry import')).toBeDefined();
      expect(buttonByText('Confirm import')).toBeUndefined();
      expect(notice()).toBe('The import of orders-oct.csv failed. Nothing was imported.');
      expect(document.activeElement).toBe(host().querySelector('#imports-preview-heading'));
    });
  });

  describe('discard', () => {
    it('asks first; Cancel keeps the preview', async () => {
      await renderWithHistory();
      await uploadToPreview();
      buttonByText('Discard')?.click();
      await stable();

      expect(textOf(dialog()?.querySelector('h2'))).toBe('Discard this import?');
      expect(textOf(dialog())).toContain(
        'Nothing from orders-oct.csv is imported, and the rows read from it are deleted.',
      );
      buttonByText('Cancel', dialog() as HTMLElement)?.click();
      await stable();
      expect(dialog()).toBeNull();
      expect(preview()).not.toBeNull();
    });

    it('cancels the import after confirmation and clears the preview', async () => {
      await renderWithHistory();
      await uploadToPreview();
      buttonByText('Discard')?.click();
      await stable();
      buttonByText('Discard import', dialog() as HTMLElement)?.click();
      await stable();

      const req = httpTesting.expectOne('/api/v1/imports/500/cancel');
      expect(req.request.method).toBe('POST');
      req.flush(importDetail({ status: 'cancelled' }));
      await stable();
      flushHistory('100', [importDetail({ status: 'cancelled' })]);
      await stable();

      expect(dialog()).toBeNull();
      expect(preview()).toBeNull();
      expect(notice()).toBe('Discarded the import of orders-oct.csv. Nothing was imported.');
      expect(document.activeElement).toBe(host().querySelector('#imports-upload-heading'));
      expect(textOf(historyRows()[0])).toContain('Cancelled');
    });
  });

  describe('history', () => {
    const page1 = Array.from({ length: 20 }, (_, i) =>
      importDetail({ id: String(700 - i), originalFilename: `file-${i + 1}.csv` }),
    );
    const page2 = Array.from({ length: 20 }, (_, i) =>
      importDetail({ id: String(680 - i), originalFilename: `file-${i + 21}.csv` }),
    );

    it('lists imports with status, counts ("—" when not known), uploader and a detail link', async () => {
      await renderWithHistory([
        importDetail({
          id: '501',
          status: 'completed',
          reportType: 'settlement_xlsx',
          originalFilename: 'settlement.xlsx',
          errorRows: 0,
          insertedCount: 40,
          updatedCount: 0,
          unchangedCount: 2,
          historyOnlyCount: 5,
          createdBy: { id: '2', displayName: null, email: 'ravi@example.com' },
        }),
        importDetail(),
      ]);

      const [done, previewed] = historyRows();
      const doneCells = Array.from(done.querySelectorAll('th, td')).map((c) => textOf(c));
      expect(doneCells.slice(0, 8)).toEqual([
        'settlement.xlsx 20 KB',
        'Settlement (XLSX)',
        'Completed',
        '120',
        '40',
        '0',
        '2',
        '5',
      ]);
      expect(doneCells[8]).toContain('ravi@example.com');
      expect(done.querySelector('a')?.getAttribute('href')).toBe('/imports/501');

      const previewedCells = Array.from(previewed.querySelectorAll('td')).map((c) => textOf(c));
      expect(previewedCells.slice(0, 7)).toEqual([
        'Orders (CSV)',
        'Previewed',
        '120 3 with errors',
        '—',
        '—',
        '—',
        '—',
      ]);
    });

    it('pages through the history, keeping the table while the next page loads', async () => {
      await render();
      flushHistory('100', page1, 1, 45);
      await stable();

      const pager = history().querySelector('app-pager nav') as HTMLElement;
      expect(textOf(pager)).toContain('Showing 1–20 of 45 imports');
      expect(textOf(pager)).toContain('Page 1 of 3');
      const previous = buttonByText('Previous page', pager) as HTMLButtonElement;
      expect(previous.getAttribute('aria-disabled')).toBe('true');
      previous.click();
      await stable();
      httpTesting.expectNone('/api/v1/accounts/100/imports?page=0&pageSize=20');

      buttonByText('Next page', pager)?.click();
      await stable();
      expect(history().getAttribute('aria-busy')).toBe('true');
      expect(historyRows()).toHaveLength(20);
      flushHistory('100', page2, 2, 45);
      await stable();

      expect(history().getAttribute('aria-busy')).toBe('false');
      expect(textOf(history().querySelector('app-pager nav'))).toContain(
        'Showing 21–40 of 45 imports',
      );
      expect(textOf(historyRows()[0].querySelector('th'))).toContain('file-21.csv');
    });

    it('shows an error with "Try again" for the same page', async () => {
      await render();
      httpTesting
        .expectOne('/api/v1/accounts/100/imports?page=1&pageSize=20')
        .flush(errorBody('INTERNAL_ERROR', 'Boom.'), { status: 500, statusText: 'Error' });
      await stable();
      expect(textOf(history())).toContain('The import history could not be loaded.');
      expect(textOf(history())).toContain('Boom. (request ID req-1)');

      buttonByText('Try again', history())?.click();
      await stable();
      flushHistory('100', [importDetail()]);
      await stable();
      expect(historyRows()).toHaveLength(1);
    });

    it('goes back to the first page after an upload', async () => {
      await render();
      flushHistory('100', page1, 1, 45);
      await stable();
      buttonByText('Next page', history())?.click();
      await stable();
      flushHistory('100', page2, 2, 45);
      await stable();

      const req = await submitUpload();
      req.flush(CLEAN, { status: 201, statusText: 'Created' });
      await stable();
      flushHistory('100', [CLEAN, ...page1.slice(0, 19)], 1, 46);
      await stable();
      expect(textOf(history().querySelector('app-pager nav'))).toContain(
        'Showing 1–20 of 46 imports',
      );
    });
  });
});
