import * as ExcelJS from 'exceljs';
import { crc32 } from 'node:zlib';
import { Readable } from 'node:stream';
import { FileRejectedError } from './file-rejected.error';
import type { RawCell } from './normalizers';
import { MAX_COLUMNS, tooManyColumnsReason } from './parsed-report';
import {
  UNREADABLE_WORKBOOK,
  type WorkbookSheetRef,
  type WorkbookStructure,
} from './workbook-structure';
import { entryData, type ZipEntry } from './zip-guard';

/** One worksheet row: `cells[0]` is column A. */
export interface SheetRow {
  rowNumber: number;
  cells: RawCell[];
}

export interface WorkbookSheet {
  name: string;
  rows: SheetRow[];
}

/**
 * Reduces an exceljs cell value to a plain value: formulas → their cached result, rich text → its
 * text, hyperlinks → their text, errors → their code (e.g. "#N/A"). Dates stay Dates (UTC).
 */
export function cellToRaw(value: ExcelJS.CellValue | undefined): RawCell {
  if (value === null || value === undefined) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  ) {
    return value;
  }
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('formula' in value || 'sharedFormula' in value) {
      return cellToRaw((value as { result?: ExcelJS.CellValue }).result);
    }
    if ('hyperlink' in value && 'text' in value) {
      return cellToRaw(value.text);
    }
    if ('error' in value) return String(value.error);
  }
  return null;
}

/** A local file header for `entry` renamed to `name`, with exact sizes (no data descriptor). */
function localHeader(entry: ZipEntry, name: string): Buffer {
  const nameBytes = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(30 + nameBytes.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  // Keep only the UTF-8 name flag; bit 3 (sizes in a trailing descriptor) is cleared on purpose.
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt32LE(entry.crc32, 14);
  header.writeUInt32LE(entry.compressedSize, 18);
  header.writeUInt32LE(entry.uncompressedSize, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  nameBytes.copy(header, 30);
  return header;
}

/** Header, then a VIEW of the entry's compressed bytes in the upload (no copy). */
function* localEntry(
  buffer: Uint8Array,
  entry: ZipEntry,
  name: string,
): Generator<Buffer> {
  yield localHeader(entry, name);
  const data = entryData(buffer, entry);
  yield Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

/** A stored (uncompressed) entry with the given content. */
function* storedEntry(name: string, content: string): Generator<Buffer> {
  const data = Buffer.from(content, 'utf8');
  yield localHeader(
    {
      name,
      method: 0,
      flags: 0,
      crc32: crc32(data),
      compressedSize: data.length,
      uncompressedSize: data.length,
      dataStart: 0,
    },
    name,
  );
  yield data;
}

const EMPTY_RELATIONSHIPS =
  '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';
const EMPTY_SHARED_STRINGS =
  '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>';

/**
 * The byte stream exceljs's streaming reader gets, produced lazily as the reader pulls it: ONLY the
 * validated entries it needs, in the order that lets it parse sheets as they arrive (workbook,
 * relationships, styles, shared strings, then the wanted sheets renamed xl/worksheets/sheet1..n.xml), with
 * exact sizes in every local header and an empty end-of-central-directory record. Entry data is handed over
 * as views of the upload (never copied); nothing else of the upload (hidden data, other parts) is ever read,
 * and no sheet is ever spooled to a temporary file.
 */
function* readerChunks(
  buffer: Uint8Array,
  structure: WorkbookStructure,
  sheets: readonly WorkbookSheetRef[],
): Generator<Buffer> {
  yield* localEntry(buffer, structure.workbook, 'xl/workbook.xml');
  // Empty on purpose: sheet names come from readWorkbookStructure, not from exceljs.
  yield* storedEntry('xl/_rels/workbook.xml.rels', EMPTY_RELATIONSHIPS);
  if (structure.styles) {
    yield* localEntry(buffer, structure.styles, 'xl/styles.xml');
  }
  if (structure.sharedStrings) {
    yield* localEntry(buffer, structure.sharedStrings, 'xl/sharedStrings.xml');
  } else {
    yield* storedEntry('xl/sharedStrings.xml', EMPTY_SHARED_STRINGS);
  }
  for (let i = 0; i < sheets.length; i++) {
    yield* localEntry(
      buffer,
      sheets[i].entry,
      `xl/worksheets/sheet${i + 1}.xml`,
    );
  }
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  yield endOfCentralDirectory;
}

export interface SheetVisitor {
  /** Called for every streamed row of the sheet; return false to stop reading this sheet. */
  row(rowNumber: number, cells: RawCell[]): boolean;
}

export interface StreamLimits {
  /** Every streamed row of the visited sheets counts, empty ones included. */
  maxPhysicalRows: number;
  tooManyRowsReason: string;
}

/**
 * Streams the rows of `sheets` (in order) through exceljs's WorkbookReader, one row in memory at a time
 * (shared strings are cached; their size is bounded by readWorkbookStructure). Rows are counted as they
 * stream and the read aborts as soon as `maxPhysicalRows` is exceeded or a row has any cell beyond
 * MAX_COLUMNS. Call only with entries from inspectZip. Malformed XML → FileRejectedError.
 */
export async function streamWorkbookRows(
  buffer: Uint8Array,
  structure: WorkbookStructure,
  sheets: readonly WorkbookSheetRef[],
  visitorFor: (index: number) => SheetVisitor,
  limits: StreamLimits,
): Promise<void> {
  if (sheets.length === 0) return;
  const input = Readable.from(readerChunks(buffer, structure, sheets), {
    objectMode: false,
  });
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(input, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    // Needed to recognise date-formatted number cells.
    styles: 'cache',
    hyperlinks: 'ignore',
    entries: 'ignore',
  });
  let physicalRows = 0;
  let index = 0;
  try {
    for await (const worksheet of reader) {
      const visitor = visitorFor(index++);
      for await (const row of worksheet) {
        physicalRows += 1;
        if (physicalRows > limits.maxPhysicalRows) {
          throw FileRejectedError.of('file', limits.tooManyRowsReason);
        }
        // Checked before row.values (which allocates one slot per column up to the last cell): any cell
        // beyond column 200, even an empty or styled one, rejects the file at its first such row.
        if (row.cellCount > MAX_COLUMNS) {
          throw FileRejectedError.of('file', tooManyColumnsReason(MAX_COLUMNS));
        }
        const values = row.values as ExcelJS.CellValue[];
        const cells: RawCell[] = [];
        for (let col = 1; col < values.length; col++) {
          cells.push(cellToRaw(values[col]));
        }
        if (!visitor.row(row.number, cells)) break;
      }
    }
  } catch (err) {
    if (err instanceof FileRejectedError) throw err;
    throw FileRejectedError.of('file', UNREADABLE_WORKBOOK);
  } finally {
    // Stops the unzip pipeline when the read ended early (row cap, bad header, error).
    input.destroy();
  }
}
