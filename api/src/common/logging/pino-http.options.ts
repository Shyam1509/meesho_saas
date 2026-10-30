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

/**
 * pino-http options: one log line per request with its request ID, credentials redacted, errors
 * reduced to type/message/stack/code. Request/response bodies are never logged (the default
 * req/res serializers do not include them and nothing here adds them).
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
    // TODO(M3): decide whether to strip or allowlist query strings in logged URLs (req.url / req.query).
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    // Applies to every `err` key logged through this logger, including Nest Logger.error(err).
    serializers: { err: sanitizeError },
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
