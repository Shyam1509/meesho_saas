import { tokensMatch } from '../opaque-token';

/** Methods that change state and therefore need CSRF protection. GET/HEAD/OPTIONS must stay read-only. */
export const UNSAFE_METHODS: ReadonlySet<string> = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

export type CsrfFailure = 'origin_not_allowed' | 'token_mismatch';

export interface CsrfRequestFacts {
  method: string;
  /** Origin header as received (undefined when the client sent none). */
  origin: string | string[] | undefined;
  /** msaas_xsrf cookie value. */
  cookieToken: string | undefined;
  /** X-XSRF-TOKEN header as received. */
  headerToken: string | string[] | undefined;
  allowedOrigins: readonly string[];
}

/**
 * CSRF layers 2 and 3 for one request (layer 1 is the SameSite=Strict session cookie):
 * - an unsafe request that carries an Origin header must come from an allowed origin (CORS_ORIGINS);
 * - an unsafe request must echo the msaas_xsrf cookie in X-XSRF-TOKEN (double submit, constant-time).
 * Returns null when the request may proceed.
 */
export function checkCsrf(facts: CsrfRequestFacts): CsrfFailure | null {
  if (!UNSAFE_METHODS.has(facts.method.toUpperCase())) return null;
  if (
    facts.origin !== undefined &&
    (typeof facts.origin !== 'string' ||
      !facts.allowedOrigins.includes(facts.origin))
  ) {
    return 'origin_not_allowed';
  }
  if (!tokensMatch(facts.cookieToken, facts.headerToken)) {
    return 'token_mismatch';
  }
  return null;
}
