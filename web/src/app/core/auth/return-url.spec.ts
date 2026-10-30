import { returnUrlParams, safeReturnUrl } from './return-url';

describe('safeReturnUrl', () => {
  it.each([
    '/overview',
    '/seller-accounts',
    '/orders?status=shipped&page=2',
    '/reports#monthly',
    '/settings/',
    '/loginhistory',
  ])('accepts the internal path %s', (url) => {
    expect(safeReturnUrl(url)).toBe(url);
  });

  it.each([
    ['an absolute URL', 'https://evil.example/phish'],
    ['a scheme without slashes', 'javascript:alert(1)'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash host', '/\\evil.example'],
    ['a backslash anywhere', '/orders\\..\\x'],
    ['a relative path', 'overview'],
    ['an empty string', ''],
    ['whitespace', '/ /evil.example'],
    ['a tab', '/\t/evil.example'],
    ['a newline', '/orders\n'],
    ['the sign-in page', '/login'],
    ['the sign-in page with a query', '/login?returnUrl=/orders'],
    ['the registration page', '/register/'],
    ['an over-long value', `/${'a'.repeat(2000)}`],
  ])('rejects %s', (_label, url) => {
    expect(safeReturnUrl(url)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(safeReturnUrl(undefined)).toBeNull();
    expect(safeReturnUrl(null)).toBeNull();
    expect(safeReturnUrl(['/orders'])).toBeNull();
  });
});

describe('returnUrlParams', () => {
  it('carries a safe internal URL and drops the root or unsafe ones', () => {
    expect(returnUrlParams('/orders?page=2')).toEqual({ returnUrl: '/orders?page=2' });
    expect(returnUrlParams('/')).toEqual({});
    expect(returnUrlParams('/login')).toEqual({});
    expect(returnUrlParams('//evil.example')).toEqual({});
  });
});
