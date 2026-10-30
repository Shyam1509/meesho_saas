import * as ExcelJS from 'exceljs';
import { Zip, ZipDeflate, zipSync } from 'fflate';

/**
 * Synthetic import files built in code (no real Meesho files exist yet). Header names follow the
 * blueprint §8 / src/imports/profiles/meesho-profiles.ts. Every expected number in the specs is worked
 * out by hand from these rows.
 */

export type Cell = string | number | Date | null;

/** RFC 4180 CSV text: fields with a comma, quote or line break are quoted; quotes are doubled. */
export function csv(rows: Cell[][]): string {
  const field = (value: Cell): string => {
    if (value === null) return '';
    const text = value instanceof Date ? value.toISOString() : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(field).join(',')).join('\r\n') + '\r\n';
}

export interface SheetSpec {
  name: string;
  /** Row 1 first; `null` cells stay empty. */
  rows: Cell[][];
}

/** An .xlsx workbook written by exceljs (numbers stay numbers, Dates become date cells). */
export async function workbook(sheets: SheetSpec[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const spec of sheets) {
    const sheet = book.addWorksheet(spec.name);
    spec.rows.forEach((cells, r) => {
      cells.forEach((value, c) => {
        if (value !== null) sheet.getCell(r + 1, c + 1).value = value;
      });
    });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

/**
 * A ZIP named like a workbook whose single entry inflates to `size` zero bytes (~1000:1), streamed so
 * the test never holds the expanded data.
 */
export function zeroBombXlsx(size: number): Buffer {
  const parts: Uint8Array[] = [];
  const zip = new Zip((err, data) => {
    if (err) throw err;
    parts.push(data);
  });
  const entry = new ZipDeflate('xl/worksheets/sheet1.xml', { level: 9 });
  zip.add(entry);
  const block = new Uint8Array(1024 * 1024);
  for (let written = 0; written < size; written += block.length) {
    const n = Math.min(block.length, size - written);
    entry.push(
      n === block.length ? block : block.subarray(0, n),
      written + n >= size,
    );
  }
  zip.end();
  return Buffer.concat(parts);
}

/** A tiny valid ZIP that is not a workbook at all. */
export function notAWorkbookZip(): Buffer {
  return Buffer.from(zipSync({ 'hello.txt': new TextEncoder().encode('hi') }));
}

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * A hand-written .xlsx (only the parts the importer reads): `sheets` are listed in workbook.xml in order
 * (names already XML-escaped) and point, through `rid`, to `rels` targets; `parts` maps archive paths to
 * worksheet XML bodies (the <sheetData> content).
 */
export function rawWorkbook(
  sheets: { name: string; rid: string }[],
  rels: { id: string; target: string }[],
  sheetData: Record<string, string>,
): Buffer {
  const enc = (text: string) => new TextEncoder().encode(text);
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': enc(
      `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>${sheets
        .map(
          (s, i) =>
            `<sheet name="${s.name}" sheetId="${i + 1}" r:id="${s.rid}"/>`,
        )
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': enc(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
        .map(
          (r) =>
            `<Relationship Id="${r.id}" Type="${REL_NS}/worksheet" Target="${r.target}"/>`,
        )
        .join('')}</Relationships>`,
    ),
  };
  for (const [path, data] of Object.entries(sheetData)) {
    files[path] = enc(
      `<worksheet xmlns="${MAIN_NS}"><sheetData>${data}</sheetData></worksheet>`,
    );
  }
  return Buffer.from(zipSync(files));
}

/** <row> XML with inline-string / number cells; `cells` maps a cell reference (A2, XFD3) to its value. */
export function rowXml(
  rowNumber: number,
  cells: Record<string, string | number>,
): string {
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = Object.entries(cells)
    .map(([ref, value]) =>
      typeof value === 'number'
        ? `<c r="${ref}"><v>${value}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`,
    )
    .join('');
  return `<row r="${rowNumber}">${body}</row>`;
}
