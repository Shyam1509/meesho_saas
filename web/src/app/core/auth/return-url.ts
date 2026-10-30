/** Longest return URL we carry through the sign-in page. */
const MAX_RETURN_URL_LENGTH = 2000;

/** Pages that must never be a return target (they would bounce straight back). */
const AUTH_PAGE_PATHS = ['/login', '/register'];

/**
 * Accepts a `returnUrl` only if it is an internal app path: one leading `/`, not `//` (a
 * protocol-relative URL), no backslash (browsers read `/\host` as `//host`), no whitespace or
 * control characters, and not an auth page. Anything else gives `null`, so a crafted link
 * (`/login?returnUrl=https://evil.example`) can never send the user off-site.
 */
export function safeReturnUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_RETURN_URL_LENGTH) {
    return null;
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    return null;
  }
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  const path = value.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  return AUTH_PAGE_PATHS.some((page) => path === page || path.startsWith(`${page}/`))
    ? null
    : value;
}

/** Query params for the sign-in page that bring the user back to `url` afterwards. */
export function returnUrlParams(url: string): Record<string, string> {
  const safe = safeReturnUrl(url);
  return safe && safe !== '/' ? { returnUrl: safe } : {};
}
