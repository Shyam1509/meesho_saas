import {
  countPhysicalLines,
  decodeCsv,
  forEachCsvRecord,
  readCsvRecords,
} from './csv-reader';
import { FileRejectedError } from './file-rejected.error';

function rejection(fn: () => unknown): FileRejectedError {
  try {
    fn();
  } catch (err) {
    if (err instanceof FileRejectedError) return err;
    throw err;
  }
  throw new Error('expected a FileRejectedError');
}

describe('decodeCsv', () => {
  it('strips a UTF-8 byte-order mark', () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('Sub Order No\n1\n'),
    ]);
    expect(decodeCsv(bytes)).toBe('Sub Order No\n1\n');
  });

  it('keeps non-ASCII UTF-8 text (₹, Hindi)', () => {
    expect(decodeCsv(Buffer.from('₹,साड़ी\n', 'utf8'))).toBe('₹,साड़ी\n');
  });

  it('rejects bytes that are not UTF-8 (e.g. Windows-1252 / Latin-1 exports)', () => {
    // "Café" in Latin-1: 0xE9 is not valid UTF-8 on its own.
    const latin1 = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x0a]);
    expect(rejection(() => decodeCsv(latin1)).details).toEqual([
      {
        field: 'file',
        reasons: [
          'The file is not UTF-8 text: in Excel use "Save As → CSV UTF-8 (Comma delimited)"',
        ],
      },
    ]);
  });

  it('rejects UTF-16 / binary content (NUL characters)', () => {
    const utf16 = Buffer.from('\ufeffa,b', 'utf16le');
    expect(() => decodeCsv(utf16)).toThrow(FileRejectedError);
  });
});

describe('readCsvRecords', () => {
  it('RFC 4180 quoting: commas, doubled quotes and line breaks inside quotes', () => {
    const text =
      'Sub Order No,Product Name,Size\r\n' +
      '1,"Kurti, cotton","Free ""size"""\r\n' +
      '2,"Two\nline name",M\r\n';
    expect(readCsvRecords(text)).toEqual([
      ['Sub Order No', 'Product Name', 'Size'],
      ['1', 'Kurti, cotton', 'Free "size"'],
      ['2', 'Two\nline name', 'M'],
    ]);
  });

  it('keeps blank lines as records (so record i is spreadsheet row i + 1) and allows ragged rows', () => {
    expect(readCsvRecords('a,b,c\n\n1,2\n3,4,5,6\n')).toEqual([
      ['a', 'b', 'c'],
      [''],
      ['1', '2'],
      ['3', '4', '5', '6'],
    ]);
  });

  it('rejects broken quoting with the line', () => {
    const error = rejection(() => readCsvRecords('a,b\n1,"unclosed\n2,3\n'));
    expect(error.details[0].field).toBe('file');
    expect(error.details[0].reasons[0]).toMatch(
      /^The CSV file is malformed near line \d+ /,
    );
  });
});

describe('CSV size guards', () => {
  it('countPhysicalLines counts LF, CRLF and lone CR line ends, blank lines and an unterminated last line', () => {
    expect(countPhysicalLines('')).toBe(0);
    expect(countPhysicalLines('a')).toBe(1);
    expect(countPhysicalLines('a\n')).toBe(1);
    expect(countPhysicalLines('a\r\nb\r\n')).toBe(2);
    expect(countPhysicalLines('a\rb\rc')).toBe(3);
    expect(countPhysicalLines('\n\n\n')).toBe(3);
    expect(countPhysicalLines('a,"x\ny"\nb')).toBe(3);
  });

  it('a record with more than 200 fields rejects the file (even empty fields)', () => {
    expect(readCsvRecords(`${','.repeat(199)}\n`)[0]).toHaveLength(200);
    expect(
      rejection(() => readCsvRecords(`${','.repeat(200)}\n`)).details[0]
        .reasons,
    ).toEqual([
      'A row uses more than 200 columns: this does not look like a Meesho report',
    ]);
  });

  it('a record longer than 64 KB rejects the file', () => {
    const error = rejection(() =>
      readCsvRecords(`a\n"${'x'.repeat(70 * 1024)}"\n`),
    );
    expect(error.details[0].reasons[0]).toMatch(
      /^A CSV row is longer than 64 KB/,
    );
  });

  it('records are streamed: the visitor sees them in order, and its errors propagate unchanged', () => {
    const seen: [number, string[]][] = [];
    forEachCsvRecord('a,b\n1,2\n', (record, index) =>
      seen.push([index, record]),
    );
    expect(seen).toEqual([
      [0, ['a', 'b']],
      [1, ['1', '2']],
    ]);
    const stop = FileRejectedError.of('file', 'stop');
    expect(() =>
      forEachCsvRecord('a\nb\n', () => {
        throw stop;
      }),
    ).toThrow(stop);
  });
});
