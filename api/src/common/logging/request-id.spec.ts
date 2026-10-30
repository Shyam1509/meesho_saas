import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  getRequestId,
  requestIdMiddleware,
  resolveRequestId,
} from './request-id';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it.each(['abcd1234', 'req-2026-10-29-0001', 'A'.repeat(64)])(
    'keeps a valid header %s',
    (header) => {
      expect(resolveRequestId(header)).toBe(header);
    },
  );

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['too short', 'abc1234'],
    ['too long', 'a'.repeat(65)],
    ['illegal characters', 'abcd1234;DROP'],
    ['whitespace', 'abcd 1234'],
    ['newline injection', 'abcd1234\nx-evil: 1'],
    ['repeated header (array)', ['abcd1234', 'efgh5678']],
  ])('replaces a %s header with a UUID', (_label, header) => {
    const id = resolveRequestId(header);
    expect(id).toMatch(UUID_PATTERN);
    expect(id).not.toBe(header);
  });

  it('generates a different ID per request', () => {
    expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
  });
});

describe('requestIdMiddleware', () => {
  function run(headers: Record<string, string>) {
    const req = { headers } as unknown as IncomingMessage;
    const setHeader = jest.fn();
    const res = { setHeader } as unknown as ServerResponse;
    const next = jest.fn();
    requestIdMiddleware(req, res, next);
    return { req, setHeader, next };
  }

  it('assigns req.id, echoes it in x-request-id and calls next', () => {
    const { req, setHeader, next } = run({ 'x-request-id': 'client-req-0001' });
    expect(req.id).toBe('client-req-0001');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'client-req-0001');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replaces a malformed header', () => {
    const { req, setHeader } = run({ 'x-request-id': 'bad id!' });
    expect(req.id).toMatch(UUID_PATTERN);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', req.id);
  });
});

describe('getRequestId', () => {
  it('prefers an existing req.id', () => {
    const req = {
      id: 'existing-id-123',
      headers: {},
    } as unknown as IncomingMessage;
    expect(getRequestId(req)).toBe('existing-id-123');
  });

  it('falls back to the header or a new UUID', () => {
    const req = {
      headers: { 'x-request-id': 'header-id-1234' },
    } as unknown as IncomingMessage;
    expect(getRequestId(req)).toBe('header-id-1234');
    expect(getRequestId({ headers: {} } as unknown as IncomingMessage)).toMatch(
      UUID_PATTERN,
    );
  });
});
