import type { ArgumentMetadata } from '@nestjs/common';
import { RequestValidationException } from '../errors/request-validation.exception';
import { ParseIdPipe } from './parse-id.pipe';

const meta: ArgumentMetadata = { type: 'param', data: 'workspaceId' };

describe('ParseIdPipe', () => {
  const pipe = new ParseIdPipe();

  it.each(['1', '42', '9007199254740993', '9'.repeat(16)])(
    'keeps %s as the same string',
    (id) => {
      expect(pipe.transform(id, meta)).toBe(id);
    },
  );

  it.each([
    ['zero', '0'],
    ['leading zero', '012'],
    ['negative', '-1'],
    ['decimal', '1.5'],
    ['exponent', '1e3'],
    ['17 digits', '1'.repeat(17)],
    ['letters', 'abc'],
    ['whitespace', ' 1'],
    ['empty', ''],
    ['non-string', 7],
  ])('rejects %s with a 400 naming the parameter', (_label, value) => {
    let caught: unknown;
    try {
      pipe.transform(value, meta);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RequestValidationException);
    expect((caught as RequestValidationException).details).toEqual([
      { field: 'workspaceId', reasons: ['must be a positive integer id'] },
    ]);
  });
});
