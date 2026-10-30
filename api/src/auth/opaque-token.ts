import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes = 256 bits of entropy, base64url without padding (43 characters). */
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** New opaque random token (session cookie, XSRF cookie). */
export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** True only for strings shaped like generateOpaqueToken() output; anything else is never looked up. */
export function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** SHA-256 hex of a token: what the database stores instead of the session token. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time equality of two well-formed tokens (false if either is missing or malformed). */
export function tokensMatch(a: unknown, b: unknown): boolean {
  if (!isWellFormedToken(a) || !isWellFormedToken(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
