import { Inflate, inflateSync } from 'fflate';
import { FileRejectedError } from './file-rejected.error';

export interface ZipLimits {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
}

/** Workbook limits checked before any XML is parsed: 500 entries, 60 MB uncompressed. */
export const WORKBOOK_ZIP_LIMITS: ZipLimits = {
  maxEntries: 500,
  maxTotalUncompressedBytes: 60 * 1024 * 1024,
};

/** One archive entry as the central directory describes it, after validation. */
export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflated. */
  method: number;
  /** General-purpose flags of the central record (bit 11 = UTF-8 name). */
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Offset of the entry's compressed data in the buffer. */
  dataStart: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
/** Input per inflate step: a 16 KB deflate chunk expands to at most ~17 MB before it is counted. */
const INFLATE_CHUNK = 16 * 1024;

const INVALID = 'The workbook is not a valid .xlsx (ZIP) file';
const tooManyEntries = (max: number) =>
  `The workbook has more than ${max} internal parts and is refused as unsafe`;
const tooLarge = (max: number) =>
  `The workbook expands to more than ${Math.round(max / 1024 / 1024)} MB and is refused as unsafe`;

class LimitExceeded extends Error {}

function reject(reason: string): never {
  throw FileRejectedError.of('file', reason);
}

/** Bounds-checked little-endian reads (a truncated or lying archive must not read past the buffer). */
class Reader {
  private readonly view: DataView;

  constructor(readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  private check(offset: number, size: number): void {
    if (offset < 0 || offset + size > this.buf.length) reject(INVALID);
  }

  u16(offset: number): number {
    this.check(offset, 2);
    return this.view.getUint16(offset, true);
  }

  u32(offset: number): number {
    this.check(offset, 4);
    return this.view.getUint32(offset, true);
  }

  u64(offset: number): number {
    this.check(offset, 8);
    const value = this.view.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) reject(INVALID);
    return Number(value);
  }

  text(offset: number, length: number): string {
    this.check(offset, length);
    return Buffer.from(
      this.buf.buffer,
      this.buf.byteOffset + offset,
      length,
    ).toString('utf8');
  }
}

interface CentralEntry {
  name: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function findEndOfCentralDirectory(r: Reader): number {
  // EOCD is 22 bytes plus a comment of at most 65535 bytes, at the very end.
  const last = r.buf.length - 22;
  const first = Math.max(0, last - 65535);
  for (let offset = last; offset >= first; offset--) {
    if (r.u32(offset) === SIG_EOCD) return offset;
  }
  return reject(INVALID);
}

/** ZIP64 "extended information" extra field (id 0x0001): 64-bit values for the fields set to 0xFFFFFFFF. */
function applyZip64Extra(
  r: Reader,
  extraStart: number,
  extraLength: number,
  entry: CentralEntry,
): void {
  let offset = extraStart;
  const end = extraStart + extraLength;
  while (offset + 4 <= end) {
    const id = r.u16(offset);
    const size = r.u16(offset + 2);
    if (id === 0x0001) {
      let p = offset + 4;
      if (entry.uncompressedSize === 0xffffffff) {
        entry.uncompressedSize = r.u64(p);
        p += 8;
      }
      if (entry.compressedSize === 0xffffffff) {
        entry.compressedSize = r.u64(p);
        p += 8;
      }
      if (entry.localHeaderOffset === 0xffffffff) {
        entry.localHeaderOffset = r.u64(p);
      }
      return;
    }
    offset += 4 + size;
  }
}

function readCentralDirectory(r: Reader, limits: ZipLimits): CentralEntry[] {
  const eocd = findEndOfCentralDirectory(r);
  let count = r.u16(eocd + 10);
  let offset = r.u32(eocd + 16);
  if (
    eocd >= 20 &&
    r.u32(eocd - 20) === SIG_ZIP64_LOCATOR &&
    (count === 0xffff || offset === 0xffffffff)
  ) {
    const zip64Eocd = r.u64(eocd - 12);
    if (r.u32(zip64Eocd) !== SIG_ZIP64_EOCD) reject(INVALID);
    count = r.u64(zip64Eocd + 32);
    offset = r.u64(zip64Eocd + 48);
  }
  if (count > limits.maxEntries) reject(tooManyEntries(limits.maxEntries));

  const entries: CentralEntry[] = [];
  let declaredTotal = 0;
  for (let i = 0; i < count; i++) {
    if (r.u32(offset) !== SIG_CENTRAL) reject(INVALID);
    const nameLength = r.u16(offset + 28);
    const extraLength = r.u16(offset + 30);
    const commentLength = r.u16(offset + 32);
    const entry: CentralEntry = {
      name: r.text(offset + 46, nameLength),
      flags: r.u16(offset + 8),
      method: r.u16(offset + 10),
      crc32: r.u32(offset + 16),
      compressedSize: r.u32(offset + 20),
      uncompressedSize: r.u32(offset + 24),
      localHeaderOffset: r.u32(offset + 42),
    };
    applyZip64Extra(r, offset + 46 + nameLength, extraLength, entry);
    declaredTotal += entry.uncompressedSize;
    if (declaredTotal > limits.maxTotalUncompressedBytes) {
      reject(tooLarge(limits.maxTotalUncompressedBytes));
    }
    entries.push(entry);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Inflates one entry in chunks, counting real output; stops as soon as the budget is exceeded. */
function inflatedSize(data: Uint8Array, budget: number): number {
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > budget) throw new LimitExceeded();
  });
  try {
    for (let start = 0; start < data.length; start += INFLATE_CHUNK) {
      const end = Math.min(start + INFLATE_CHUNK, data.length);
      inflater.push(data.subarray(start, end), end === data.length);
    }
    if (data.length === 0) inflater.push(new Uint8Array(0), true);
  } catch (err) {
    if (err instanceof LimitExceeded) throw err;
    reject(INVALID);
  }
  return total;
}

/**
 * Zip-bomb guard for uploaded workbooks, run before any XML is parsed. Returns the validated entries.
 * 1. Central directory: at most `maxEntries` entries and at most `maxTotalUncompressedBytes` declared.
 * 2. Real content: every entry is located through its local header and actually inflated in 16 KB
 *    chunks without keeping the output, so a header that lies about sizes cannot get past step 1; the real
 *    size must match the declared one. Encrypted entries and methods other than stored/deflate are refused.
 * Only these entries' bytes are ever handed to the XML reader (see workbook-stream.ts), so data hidden
 * between entries is never read. Any violation → FileRejectedError (422).
 */
export function inspectZip(
  buffer: Uint8Array,
  limits: ZipLimits = WORKBOOK_ZIP_LIMITS,
): ZipEntry[] {
  const r = new Reader(buffer);
  const central = readCentralDirectory(r, limits);
  const entries: ZipEntry[] = [];
  let actualTotal = 0;
  for (const entry of central) {
    if (entry.flags & 0x1) reject('Encrypted workbooks are not supported');
    const local = entry.localHeaderOffset;
    if (r.u32(local) !== SIG_LOCAL) reject(INVALID);
    const dataStart = local + 30 + r.u16(local + 26) + r.u16(local + 28);
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > buffer.length) reject(INVALID);
    const data = buffer.subarray(dataStart, dataEnd);
    const budget = limits.maxTotalUncompressedBytes - actualTotal;
    let size: number;
    if (entry.method === STORED) {
      size = data.length;
    } else if (entry.method === DEFLATED) {
      try {
        size = inflatedSize(data, budget);
      } catch (err) {
        if (err instanceof LimitExceeded) {
          reject(tooLarge(limits.maxTotalUncompressedBytes));
        }
        throw err;
      }
    } else {
      reject('The workbook uses an unsupported compression method');
    }
    if (size !== entry.uncompressedSize) reject(INVALID);
    actualTotal += size;
    if (actualTotal > limits.maxTotalUncompressedBytes) {
      reject(tooLarge(limits.maxTotalUncompressedBytes));
    }
    entries.push({
      name: entry.name,
      method: entry.method,
      flags: entry.flags,
      crc32: entry.crc32,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      dataStart,
    });
  }
  return entries;
}

/** inspectZip without the entry list. */
export function assertZipWithinLimits(
  buffer: Uint8Array,
  limits: ZipLimits = WORKBOOK_ZIP_LIMITS,
): void {
  inspectZip(buffer, limits);
}

/** The raw (still compressed) bytes of an entry. */
export function entryData(buffer: Uint8Array, entry: ZipEntry): Uint8Array {
  return buffer.subarray(
    entry.dataStart,
    entry.dataStart + entry.compressedSize,
  );
}

/** Inflates a small, already validated entry (workbook.xml, its relationships). */
export function inflateEntry(buffer: Uint8Array, entry: ZipEntry): Buffer {
  const data = entryData(buffer, entry);
  const out =
    entry.method === STORED
      ? data
      : inflateSync(data, { out: new Uint8Array(entry.uncompressedSize) });
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}
