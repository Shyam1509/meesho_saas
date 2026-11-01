import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  ImportDetail,
  ImportRow,
  ImportSheetPreview,
  entryTypeLabel,
  fieldLabel,
  isDateField,
  isMoneyField,
  reportTypeLabel,
  rowActionLabel,
} from '../../../core/imports/import.models';
import { MISSING, formatDate, formatInr } from '../../../shared/format/format';
import {
  CountPipe,
  DateRangePipe,
  DisplayDateTimePipe,
  FileSizePipe,
} from '../../../shared/format/format.pipes';
import { ImportErrorsTable } from '../import-errors-table/import-errors-table';
import { ImportStatusBadge } from '../import-status-badge/import-status-badge';
import { TableRegion } from '../../../shared/table-region/table-region';

interface SampleGroup {
  key: string;
  sheetName: string | null;
  columns: { field: string; label: string }[];
  rows: { id: string; rowNumber: number; action: string | null; cells: string[] }[];
}

/**
 * Everything the upload found in one file, for checking before (or after) the import: report
 * type, file, period, counts, the planned inserts / updates / status events, how each sheet's
 * columns were matched, sample rows and the rows with errors. Section headings are `h3`; put it
 * under an `h2`.
 */
@Component({
  selector: 'app-import-review',
  imports: [
    CountPipe,
    DateRangePipe,
    DisplayDateTimePipe,
    FileSizePipe,
    ImportErrorsTable,
    ImportStatusBadge,
    TableRegion,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './import-review.html',
})
export class ImportReview {
  readonly job = input.required<ImportDetail>();

  protected readonly missing = MISSING;
  protected readonly isMoney = isMoneyField;
  protected readonly reportType = computed(() => reportTypeLabel(this.job().reportType));
  protected readonly dataAsOfLabel = computed(() =>
    this.job().reportType === 'orders_csv' ? 'Statuses as of' : 'Data as of',
  );
  protected readonly uploadedBy = computed(() => {
    const by = this.job().createdBy;
    return by ? (by.displayName ?? by.email) : null;
  });
  protected readonly usedSheets = computed(() =>
    (this.job().preview?.sheets ?? []).filter((sheet) => !sheet.ignored),
  );
  protected readonly ignoredSheets = computed(() =>
    (this.job().preview?.sheets ?? []).filter((sheet) => sheet.ignored).map((s) => s.name),
  );
  protected readonly sampleGroups = computed(() =>
    groupSamples(this.job().preview?.sampleRows ?? []),
  );

  protected sheetUse(sheet: ImportSheetPreview): string {
    return sheet.entryType ? entryTypeLabel(sheet.entryType) : reportTypeLabel(this.job().reportType);
  }

  protected columnList(columns: readonly string[]): string {
    return columns.length > 0 ? columns.join(', ') : 'None';
  }
}

/** Sample rows by sheet; each group's columns are the mapped fields its rows carry, in order. */
function groupSamples(rows: readonly ImportRow[]): SampleGroup[] {
  const groups = new Map<string, { sheetName: string | null; fields: string[]; rows: ImportRow[] }>();
  for (const row of rows) {
    const key = row.sheetName ?? '';
    let group = groups.get(key);
    if (!group) {
      group = { sheetName: row.sheetName, fields: [], rows: [] };
      groups.set(key, group);
    }
    for (const field of Object.keys(row.values)) {
      if (!group.fields.includes(field)) {
        group.fields.push(field);
      }
    }
    group.rows.push(row);
  }
  return Array.from(groups, ([key, group]) => ({
    key,
    sheetName: group.sheetName,
    columns: group.fields.map((field) => ({ field, label: fieldLabel(field) })),
    rows: group.rows.map((row) => ({
      id: row.id,
      rowNumber: row.rowNumber,
      action: rowActionLabel(row.action),
      cells: group.fields.map((field) => formatCell(field, row.values[field])),
    })),
  }));
}

/** INR for amounts, a calendar date for dates, else the text; empty → "—" (never 0). */
function formatCell(field: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return MISSING;
  }
  if (isMoneyField(field)) {
    return formatInr(value);
  }
  if (isDateField(field)) {
    return formatDate(value);
  }
  return value;
}
