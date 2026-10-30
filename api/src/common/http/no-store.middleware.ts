import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * API responses carry personal data (emails in /auth/me and member lists) and per-user state, so no
 * browser or proxy may store them. Mounted on the API prefix in configureApp; applies to errors too.
 */
export function noStoreMiddleware(
  _req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
