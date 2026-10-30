import { Zip, ZipDeflate, zipSync } from 'fflate';
import { FileRejectedError } from './file-rejected.error';
import {
  assertZipWithinLimits,
  inspectZip,
  WORKBOOK_ZIP_LIMITS,
} from './zip-guard';

const MB = 1024 * 1024;

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof FileRejectedError) return err.details[0].reasons[0];
    throw err;
  }
  throw new Error('expected a FileRejectedError');
}

/** A deflated zip with one entry of `size` zero bytes, streamed in 1 MB chunks (no big allocation). */
function zeroBomb(size: number): Uint8Array {
  const parts: Uint8Array[] = [];
  const zip = new Zip((err, data) => {
    if (err) throw err;
    parts.push(data);
  });
  const entry = new ZipDeflate('xl/worksheets/sheet1.xml', { level: 9 });
  zip.add(entry);
  const block = new Uint8Array(MB);
  for (let written = 0; written < size; written += MB) {
    const n = Math.min(MB, size - written);
    entry.push(n === MB ? block : block.subarray(0, n), written + n >= size);
  }
  zip.end();
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Central-directory record offsets of every entry. */
function centralRecords(buf: Uint8Array): number[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const offsets: number[] = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (view.getUint32(i, true) === 0x02014b50) offsets.push(i);
  }
  return offsets;
}

describe('assertZipWithinLimits', () => {
  it('accepts a small normal archive (stored and deflated entries)', () => {
    const zip = zipSync({
      '[Content_Types].xml': [
        new TextEncoder().encode('<Types/>'),
        { level: 0 },
      ],
      'xl/workbook.xml': new TextEncoder().encode('<workbook>'.repeat(1000)),
    });
    expect(() => assertZipWithinLimits(zip)).not.toThrow();
  });

  it('defaults: 500 entries, 60 MB', () => {
    expect(WORKBOOK_ZIP_LIMITS).toEqual({
      maxEntries: 500,
      maxTotalUncompressedBytes: 60 * MB,
    });
  });

  it('returns the validated entries (name, method, sizes, data offset)', () => {
    const zip = zipSync({
      'a.xml': [new TextEncoder().encode('hello'), { level: 0 }],
      'b.xml': new TextEncoder().encode('x'.repeat(1000)),
    });
    const entries = inspectZip(zip);
    expect(entries.map((e) => [e.name, e.method, e.uncompressedSize])).toEqual([
      ['a.xml', 0, 5],
      ['b.xml', 8, 1000],
    ]);
    expect(
      new TextDecoder().decode(
        zip.subarray(entries[0].dataStart, entries[0].dataStart + 5),
      ),
    ).toBe('hello');
  });

  it('rejects more entries than allowed', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 6; i++) files[`f${i}.xml`] = new Uint8Array([1]);
    const zip = zipSync(files);
    expect(() =>
      assertZipWithinLimits(zip, {
        maxEntries: 6,
        maxTotalUncompressedBytes: MB,
      }),
    ).not.toThrow();
    expect(
      reasonOf(() =>
        assertZipWithinLimits(zip, {
          maxEntries: 5,
          maxTotalUncompressedBytes: MB,
        }),
      ),
    ).toBe(
      'The workbook has more than 5 internal parts and is refused as unsafe',
    );
  });

  it('rejects an honest zip bomb by its declared size (61 MB of zeros in ~60 KB)', () => {
    const bomb = zeroBomb(61 * MB);
    expect(bomb.length).toBeLessThan(MB);
    expect(reasonOf(() => assertZipWithinLimits(bomb))).toBe(
      'The workbook expands to more than 60 MB and is refused as unsafe',
    );
    // Building the 101 MB fixture takes a few seconds on a busy machine.
  }, 60_000);

  it('rejects a bomb whose central directory lies about the size, by actually inflating it', () => {
    const bomb = zeroBomb(3 * MB);
    const view = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
    const [record] = centralRecords(bomb);
    view.setUint32(record + 24, 100, true); // declared uncompressed size: 100 bytes
    const limits = { maxEntries: 10, maxTotalUncompressedBytes: 2 * MB };
    expect(reasonOf(() => assertZipWithinLimits(bomb, limits))).toBe(
      'The workbook expands to more than 2 MB and is refused as unsafe',
    );
    // Within budget, the real size still has to match the declared one.
    expect(
      reasonOf(() =>
        assertZipWithinLimits(bomb, {
          maxEntries: 10,
          maxTotalUncompressedBytes: 4 * MB,
        }),
      ),
    ).toBe('The workbook is not a valid .xlsx (ZIP) file');
  });

  it('rejects data that is not a zip, a truncated zip and corrupt deflate data', () => {
    expect(
      reasonOf(() =>
        assertZipWithinLimits(
          new TextEncoder().encode('PK\u0003\u0004 not really'),
        ),
      ),
    ).toBe('The workbook is not a valid .xlsx (ZIP) file');
    const zip = zipSync({
      'a.xml': new TextEncoder().encode('x'.repeat(5000)),
    });
    expect(
      reasonOf(() => assertZipWithinLimits(zip.subarray(0, zip.length - 30))),
    ).toBe('The workbook is not a valid .xlsx (ZIP) file');
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const dataStart = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    const corrupt = zip.slice();
    corrupt[dataStart] = 0x07; // final block with the reserved block type 11
    expect(reasonOf(() => assertZipWithinLimits(corrupt))).toBe(
      'The workbook is not a valid .xlsx (ZIP) file',
    );
    const badLocalHeader = zip.slice();
    badLocalHeader[0] = 0;
    expect(reasonOf(() => assertZipWithinLimits(badLocalHeader))).toBe(
      'The workbook is not a valid .xlsx (ZIP) file',
    );
  });

  it('rejects encrypted entries and unknown compression methods', () => {
    const zip = zipSync({ 'a.xml': new TextEncoder().encode('hello') });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const [record] = centralRecords(zip);
    const encrypted = zip.slice();
    new DataView(encrypted.buffer).setUint16(
      record + 8,
      view.getUint16(record + 8, true) | 1,
      true,
    );
    expect(reasonOf(() => assertZipWithinLimits(encrypted))).toBe(
      'Encrypted workbooks are not supported',
    );
    const bzip = zip.slice();
    new DataView(bzip.buffer).setUint16(record + 10, 12, true);
    expect(reasonOf(() => assertZipWithinLimits(bzip))).toBe(
      'The workbook uses an unsupported compression method',
    );
  });
});
