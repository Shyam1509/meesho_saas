import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  chooseFiles,
  dragEvent,
  fakeFile,
  textOf,
  typeInto,
} from '../../../../testing/test-data';
import { checkFile } from '../../../shared/file-drop-zone/file-drop-zone';
import { localDateString } from '../../../shared/format/format';
import { ImportUploadForm, ImportUploadRequest, latestStatusDate } from './import-upload-form';

@Component({
  imports: [ImportUploadForm],
  template: `
    <app-import-upload-form
      [pending]="pending()"
      [maxFileMb]="maxFileMb()"
      [maxRows]="maxRows()"
      (submitted)="requests.push($event)"
    />
  `,
})
class Host {
  readonly pending = signal(false);
  readonly maxFileMb = signal(10);
  readonly maxRows = signal<number | null>(null);
  readonly form = viewChild.required(ImportUploadForm);
  readonly requests: ImportUploadRequest[] = [];
}

const MB = 1024 * 1024;

describe('ImportUploadForm (uploader)', () => {
  let fixture: ComponentFixture<Host>;
  const host = () => fixture.nativeElement as HTMLElement;
  const fileInput = () => host().querySelector('input[type="file"]') as HTMLInputElement;
  const zone = () => host().querySelector('label[for="' + fileInput().id + '"]') as HTMLElement;
  const dateInput = () => host().querySelector('input[type="date"]') as HTMLInputElement | null;
  const submitButton = () => host().querySelector('button[type="submit"]') as HTMLButtonElement;
  const errorFor = (input: HTMLElement) => {
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    const errorId = ids.find((id) => id.endsWith('-error'));
    return errorId ? textOf(host().querySelector(`#${errorId}`)) : '';
  };
  const requests = () => fixture.componentInstance.requests;

  async function stable(): Promise<void> {
    await fixture.whenStable();
  }

  async function choose(...files: File[]): Promise<void> {
    chooseFiles(fileInput(), files);
    await stable();
  }

  async function submit(): Promise<void> {
    submitButton().click();
    await stable();
  }

  function dayOffset(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return localDateString(date);
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await stable();
  });

  it('is a labelled, keyboard-focusable file input that accepts .csv and .xlsx', () => {
    const input = fileInput();
    expect(input.accept).toBe('.csv,.xlsx');
    expect(input.disabled).toBe(false);
    expect(input.tabIndex).toBe(0);
    expect(textOf(zone())).toContain('Report file');
    expect(textOf(zone())).toContain('Drag and drop the file here, or choose a file.');
    const hintId = input.getAttribute('aria-describedby') as string;
    expect(textOf(host().querySelector(`#${hintId}`))).toContain('up to 10 MB');

    input.focus();
    expect(document.activeElement).toBe(input);
  });

  describe('file checks', () => {
    it('rejects a file that is not .csv or .xlsx', async () => {
      await choose(fakeFile('statement.pdf', 1000, 'application/pdf'));

      expect(fileInput().getAttribute('aria-invalid')).toBe('true');
      expect(errorFor(fileInput())).toBe(
        '“statement.pdf” is not a .csv or .xlsx file. Choose a .csv or .xlsx file.',
      );
      expect(host().textContent).not.toContain('Selected:');

      await submit();
      expect(requests()).toEqual([]);
    });

    it('uses the server limits from the page (GET /imports/config)', async () => {
      fixture.componentInstance.maxFileMb.set(5);
      fixture.componentInstance.maxRows.set(50000);
      await stable();
      const hintId = fileInput().getAttribute('aria-describedby') as string;
      expect(textOf(host().querySelector(`#${hintId}`))).toBe(
        'Meesho orders report (.csv) or settlement workbook (.xlsx), up to 5 MB and 50,000 rows.',
      );

      await choose(fakeFile('six.xlsx', 6 * MB));
      expect(errorFor(fileInput())).toBe('“six.xlsx” is larger than 5 MB. Choose a smaller file.');
      await choose(fakeFile('four.xlsx', 4 * MB));
      expect(textOf(host())).toContain('Selected: four.xlsx (4 MB)');
    });

    it('rejects a file over 10 MB and an empty file', async () => {
      await choose(fakeFile('big.xlsx', 10 * MB + 1));
      expect(errorFor(fileInput())).toBe('“big.xlsx” is larger than 10 MB. Choose a smaller file.');

      await choose(fakeFile('empty.csv', 0));
      expect(errorFor(fileInput())).toBe(
        '“empty.csv” is empty. Choose a file that contains the report.',
      );
    });

    it('accepts a file of exactly 10 MB and upper-case extensions', () => {
      expect(checkFile(fakeFile('ok.xlsx', 10 * MB), ['.csv', '.xlsx'], 10 * MB)).toBeNull();
      expect(checkFile(fakeFile('ORDERS.CSV'), ['.csv', '.xlsx'], 10 * MB)).toBeNull();
    });

    it('a valid file replaces the error and can be removed again', async () => {
      await choose(fakeFile('statement.pdf'));
      await choose(fakeFile('orders.csv', 2048));

      expect(fileInput().hasAttribute('aria-invalid')).toBe(false);
      expect(textOf(host())).toContain('Selected: orders.csv (2 KB)');

      const remove = Array.from(host().querySelectorAll('button')).find((b) =>
        textOf(b).startsWith('Remove'),
      ) as HTMLButtonElement;
      expect(textOf(remove)).toBe('Remove orders.csv');
      remove.click();
      await stable();

      expect(textOf(host())).not.toContain('Selected:');
      expect(document.activeElement).toBe(fileInput());
    });

    it('asks for a file when the form is submitted without one', async () => {
      await submit();

      expect(requests()).toEqual([]);
      expect(errorFor(fileInput())).toBe('Choose a .csv or .xlsx file to upload.');
      expect(document.activeElement).toBe(fileInput());

      await choose(fakeFile('orders.csv'));
      expect(errorFor(fileInput())).toBe('');
    });
  });

  describe('drag and drop', () => {
    it('highlights while a file is dragged over and takes a dropped file', async () => {
      const over = dragEvent('dragover');
      zone().dispatchEvent(over);
      await stable();
      expect(over.defaultPrevented).toBe(true);
      expect(zone().dataset['dragging']).toBe('true');

      zone().dispatchEvent(dragEvent('dragleave'));
      await stable();
      expect(zone().dataset['dragging']).toBeUndefined();

      const drop = dragEvent('drop', [fakeFile('settlement.xlsx', 4096)]);
      zone().dispatchEvent(drop);
      await stable();
      expect(drop.defaultPrevented).toBe(true);
      expect(textOf(host())).toContain('Selected: settlement.xlsx (4 KB)');
      expect(dateInput()).toBeNull();

      await submit();
      expect(requests()).toHaveLength(1);
      expect(requests()[0].file.name).toBe('settlement.xlsx');
      expect(requests()[0].dataAsOf).toBeNull();
    });

    it('checks dropped files too, one at a time', async () => {
      zone().dispatchEvent(dragEvent('drop', [fakeFile('a.csv'), fakeFile('b.csv')]));
      await stable();
      expect(errorFor(fileInput())).toBe('Choose one file at a time.');

      zone().dispatchEvent(dragEvent('drop', [fakeFile('notes.txt')]));
      await stable();
      expect(errorFor(fileInput())).toContain('is not a .csv or .xlsx file');
    });

    it('ignores drops while an upload is pending', async () => {
      fixture.componentInstance.pending.set(true);
      await stable();
      expect(fileInput().disabled).toBe(true);

      zone().dispatchEvent(dragEvent('drop', [fakeFile('orders.csv')]));
      await stable();
      expect(textOf(host())).not.toContain('Selected:');
    });
  });

  describe('"Statuses as of" date (CSV only, required)', () => {
    it('is asked for a CSV only, required, with today as the maximum', async () => {
      expect(dateInput()).toBeNull();
      await choose(fakeFile('orders.csv'));
      const input = dateInput() as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.max).toBe(latestStatusDate());
      expect(input.required).toBe(true);
      expect(textOf(host().querySelector(`label[for="${input.id}"]`))).toBe('Statuses as of');
      const hintId = input.getAttribute('aria-describedby') as string;
      expect(textOf(host().querySelector(`#${hintId}`))).toContain(
        'The day you downloaded this report from Meesho.',
      );

      await choose(fakeFile('settlement.xlsx'));
      expect(dateInput()).toBeNull();
    });

    it('rejects a date in the future', async () => {
      await choose(fakeFile('orders.csv'));
      typeInto(dateInput() as HTMLInputElement, dayOffset(1));
      await submit();

      expect(requests()).toEqual([]);
      const input = dateInput() as HTMLInputElement;
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(errorFor(input)).toBe('The date cannot be in the future.');
      expect(document.activeElement).toBe(input);
    });

    it('sends the chosen day as a date-only dataAsOf', async () => {
      await choose(fakeFile('orders.csv'));
      typeInto(dateInput() as HTMLInputElement, '2026-10-01');
      await submit();

      expect(requests()).toHaveLength(1);
      expect(requests()[0].file.name).toBe('orders.csv');
      expect(requests()[0].dataAsOf).toBe('2026-10-01');
    });

    it('accepts today', async () => {
      await choose(fakeFile('orders.csv'));
      typeInto(dateInput() as HTMLInputElement, latestStatusDate());
      await submit();
      expect(requests()[0].dataAsOf).toBe(latestStatusDate());
    });

    it('requires the date for a CSV', async () => {
      await choose(fakeFile('orders.csv'));
      await submit();

      expect(requests()).toEqual([]);
      const input = dateInput() as HTMLInputElement;
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(errorFor(input)).toBe('Enter the day you downloaded this report from Meesho.');
      expect(document.activeElement).toBe(input);
    });

    it('drops a typed date when the file is switched to a workbook', async () => {
      await choose(fakeFile('orders.csv'));
      typeInto(dateInput() as HTMLInputElement, dayOffset(5));
      await choose(fakeFile('settlement.xlsx'));
      await submit();
      expect(requests()).toHaveLength(1);
      expect(requests()[0].dataAsOf).toBeNull();
    });
  });

  it('reads as busy while pending and ignores submits', async () => {
    await choose(fakeFile('orders.csv'));
    typeInto(dateInput() as HTMLInputElement, '2026-10-01');
    fixture.componentInstance.pending.set(true);
    await stable();

    expect(textOf(submitButton())).toBe('Uploading…');
    expect(submitButton().getAttribute('aria-disabled')).toBe('true');
    await submit();
    expect(requests()).toEqual([]);
  });

  it('reset() empties the form', async () => {
    await choose(fakeFile('orders.csv'));
    typeInto(dateInput() as HTMLInputElement, '2026-10-01');
    fixture.componentInstance.form().reset();
    await stable();

    expect(textOf(host())).not.toContain('Selected:');
    expect(dateInput()).toBeNull();
    await choose(fakeFile('orders.csv'));
    expect(dateInput()?.value).toBe('');
  });
});

describe('latestStatusDate', () => {
  it('is today where the viewer is and in India, whichever is earlier', () => {
    // 20:00 UTC on 30 Oct: already 31 Oct in India (01:30 IST).
    const now = new Date(Date.UTC(2026, 9, 30, 20, 0));
    const local = localDateString(now);
    const expected = local < '2026-10-31' ? local : '2026-10-31';
    expect(latestStatusDate(now)).toBe(expected);
    expect(latestStatusDate(now) <= '2026-10-31').toBe(true);
  });
});
