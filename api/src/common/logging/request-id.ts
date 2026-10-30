import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Accepted client-supplied request IDs: 8–64 chars of letters, digits and hyphens. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Keeps a well-formed incoming `x-request-id`; anything else (missing, malformed, too long, repeated) gets a fresh UUID. */
export function resolveRequestId(
  header: string | string[] | undefined,
): string {
  if (typeof header === 'string' && REQUEST_ID_PATTERN.test(header)) {
    return header;
  }
  return randomUUID();
}

/**
 * Express-level middleware (registered with app.use, so it covers every path, including
 * unknown routes and Swagger): assigns req.id and echoes it in the response header.
 * pino-http reuses req.id, so log lines and the error envelope share the same ID.
 */
export function requestIdMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

/** Request ID for a request that may not have passed through the middleware (defensive). */
export function getRequestId(req: IncomingMessage): string {
  const id: unknown = req.id;
  return typeof id === 'string' && id.length > 0
    ? id
    : resolveRequestId(req.headers[REQUEST_ID_HEADER]);
}
