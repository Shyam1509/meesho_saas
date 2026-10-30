import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';
import type { LogLevel } from '../../config/env.validation';
import { sanitizeError } from './error-sanitizer';
import { getRequestId, REQUEST_ID_HEADER } from './request-id';

/** Header values replaced with [REDACTED] in request/response logs. */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers["proxy-authorization"]',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-xsrf-token"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
];

/** Logged form of a request URL: path only. Query strings can carry tokens, emails or filters. */
export function stripQueryString(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

/**
 * Request serializer applied after pino's standard one: the URL loses its query string and the parsed
 * `query` object is dropped. Headers stay (credential headers are redacted by REDACTED_PATHS).
 */
export function serializeRequest(
  req: Record<string, unknown>,
): Record<string, unknown> {
  const logged: Record<string, unknown> = {
    ...req,
    url: stripQueryString(req.url),
  };
  delete logged.query;
  return logged;
}

/**
 * pino-http options: one log line per request with its request ID, credentials redacted (Cookie,
 * Set-Cookie, X-XSRF-TOKEN, ...), URLs without query strings, errors reduced to type/message/stack/code.
 * Request/response bodies are never logged (the default req/res serializers do not include them and
 * nothing here adds them).
 */
export function buildPinoHttpOptions(level: LogLevel): Options {
  return {
    level,
    // req.id is normally set by requestIdMiddleware; this is the fallback.
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const id = getRequestId(req);
      if (!res.headersSent) res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    // `err` applies to every error logged through this logger, including Nest Logger.error(err).
    serializers: { err: sanitizeError, req: serializeRequest },
    customLogLevel: (
      _req: IncomingMessage,
      res: ServerResponse,
      err?: Error,
    ) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  };
}
