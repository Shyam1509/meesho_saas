import { FileRejectedError } from './file-rejected.error';
import { stripFormatChars } from './normalizers';
import { inflateEntry, type ZipEntry } from './zip-guard';

export const UNREADABLE_WORKBOOK =
  'The workbook could not be read: is it a valid .xlsx file?';

/** workbook.xml and its relationships are read directly; anything bigger is not a real workbook part. */
const MAX_INDEX_PART_BYTES = 2 * 1024 * 1024;
/** Shared strings and styles are cached whole by the reader: kept well below the 60 MB total budget. */
export const MAX_SHARED_PART_BYTES = 20 * 1024 * 1024;
/** More sheets than this is not a Meesho report (and each sheet costs work). */
export const MAX_SHEETS = 50;
/** import_rows.sheet_name / settlement_entries.sheet_name are VARCHAR(64); Excel itself allows 31. */
export const MAX_SHEET_NAME_LENGTH = 64;

export interface WorkbookSheetRef {
  /** Sheet name as shown in Excel (format characters removed). */
  name: string;
  /** Archive entry of the sheet XML. */
  entry: ZipEntry;
}

export interface WorkbookStructure {
  workbook: ZipEntry;
  styles: ZipEntry | null;
  sharedStrings: ZipEntry | null;
  /** Worksheets in workbook order (chart sheets and missing parts are skipped). */
  sheets: WorkbookSheetRef[];
}

function reject(reason: string): never {
  throw FileRejectedError.of('file', reason);
}

function unreadable(): never {
  return reject(UNREADABLE_WORKBOOK);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** XML 1.0 Char: tab, LF, CR, U+0020–U+D7FF, U+E000–U+FFFD, U+10000–U+10FFFF. */
function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/**
 * XML attribute value → text (the five named entities and numeric character references). A reference to
 * something that is not an XML character (e.g. &#x110000;, &#0;, a surrogate) is a malformed workbook
 * → FileRejectedError, never a crash.
 */
export function decodeXmlText(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g,
    (whole, ref: string) => {
      if (ref.startsWith('#')) {
        const code = ref.startsWith('#x')
          ? parseInt(ref.slice(2), 16)
          : Number(ref.slice(1));
        if (!Number.isSafeInteger(code) || !isXmlChar(code)) unreadable();
        return String.fromCodePoint(code);
      }
      return ENTITIES[ref] ?? whole;
    },
  );
}

/** Attributes of every `<prefix:tag ...>` element (namespace prefixes ignored), as local-name → value. */
export function elementsOf(xml: string, tag: string): Record<string, string>[] {
  const elements: Record<string, string>[] = [];
  const element = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b([^>]*)>`, 'g');
  for (const match of xml.matchAll(element)) {
    const attributes: Record<string, string> = {};
    for (const attr of match[1].matchAll(
      /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    )) {
      const local = attr[1].includes(':') ? attr[1].split(':')[1] : attr[1];
      // r:id and id both land on "id"; a prefixed name wins over a plain one.
      if (attr[1].includes(':') || !(local in attributes)) {
        attributes[local] = decodeXmlText(attr[2] ?? attr[3] ?? '');
      }
    }
    elements.push(attributes);
  }
  return elements;
}

/** A relationship target of xl/workbook.xml as an archive path ("worksheets/a.xml" → "xl/worksheets/a.xml"). */
export function resolveTarget(target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : `xl/${target}`)
    .split('/')
    .filter((p) => p !== '' && p !== '.');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.join('/');
}

function textOf(buffer: Uint8Array, entry: ZipEntry): string {
  if (entry.uncompressedSize > MAX_INDEX_PART_BYTES) unreadable();
  return inflateEntry(buffer, entry).toString('utf8');
}

function sharedPart(entry: ZipEntry | null, label: string): ZipEntry | null {
  if (entry && entry.uncompressedSize > MAX_SHARED_PART_BYTES) {
    reject(
      `The workbook's ${label} part expands to more than ${MAX_SHARED_PART_BYTES / 1024 / 1024} MB and is refused as unsafe`,
    );
  }
  return entry;
}

function structureOf(
  buffer: Uint8Array,
  entries: readonly ZipEntry[],
): WorkbookStructure {
  const byName = new Map(entries.map((e) => [e.name.replace(/^\//, ''), e]));
  const workbook = byName.get('xl/workbook.xml');
  const rels = byName.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) unreadable();

  const targets = new Map<string, { type: string; path: string }>();
  for (const rel of elementsOf(textOf(buffer, rels), 'Relationship')) {
    if (!rel.Id || !rel.Target || rel.TargetMode === 'External') continue;
    targets.set(rel.Id, {
      type: (rel.Type ?? '').split('/').pop() ?? '',
      path: resolveTarget(rel.Target),
    });
  }
  const partOfType = (type: string): ZipEntry | null => {
    for (const target of targets.values()) {
      if (target.type === type) return byName.get(target.path) ?? null;
    }
    return null;
  };
  const styles = sharedPart(partOfType('styles'), 'styles');
  const sharedStrings = sharedPart(
    partOfType('sharedStrings'),
    'shared strings',
  );

  const listed = elementsOf(textOf(buffer, workbook), 'sheet');
  if (listed.length > MAX_SHEETS) {
    reject(`The workbook has more than ${MAX_SHEETS} sheets`);
  }
  // Each part may be read once only: two sheets on one part (or a sheet on the shared strings / styles)
  // would read the same rows several times.
  const owners = new Map<ZipEntry, string>();
  if (styles) owners.set(styles, 'styles');
  if (sharedStrings) owners.set(sharedStrings, 'shared strings');
  const sheets: WorkbookSheetRef[] = [];
  for (const sheet of listed) {
    const target = sheet.id ? targets.get(sheet.id) : undefined;
    if (!sheet.name || !target || target.type !== 'worksheet') continue;
    const entry = byName.get(target.path);
    if (!entry) continue;
    const name = stripFormatChars(sheet.name).trim();
    if ([...name].length > MAX_SHEET_NAME_LENGTH) {
      reject(
        `A sheet name is longer than ${MAX_SHEET_NAME_LENGTH} characters: this is not a valid Excel workbook`,
      );
    }
    const owner = owners.get(entry);
    if (owner !== undefined) {
      reject(
        `Sheets "${owner}" and "${name}" point to the same data: this workbook is not supported`,
      );
    }
    owners.set(entry, name);
    sheets.push({ name, entry });
  }
  if (sheets.length === 0) unreadable();
  return { workbook, styles, sharedStrings, sheets };
}

/**
 * Sheet names and parts from xl/workbook.xml and xl/_rels/workbook.xml.rels (the standard locations every
 * spreadsheet writer uses), resolved through the relationships so any part naming works. Refused (422):
 * no workbook part or worksheet, more than 50 sheets, two sheets (or a sheet and the shared strings /
 * styles) on the same part, a shared strings / styles part over 20 MB, an over-long sheet name, and any
 * malformed content (never a 500).
 */
export function readWorkbookStructure(
  buffer: Uint8Array,
  entries: readonly ZipEntry[],
): WorkbookStructure {
  try {
    return structureOf(buffer, entries);
  } catch (err) {
    if (err instanceof FileRejectedError) throw err;
    return unreadable();
  }
}
