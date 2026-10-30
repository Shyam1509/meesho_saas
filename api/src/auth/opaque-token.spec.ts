import {
  generateOpaqueToken,
  isWellFormedToken,
  sha256Hex,
  tokensMatch,
} from './opaque-token';

describe('opaque tokens', () => {
  it('generates distinct 43-character base64url tokens', () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => generateOpaqueToken()),
    );
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isWellFormedToken(token)).toBe(true);
    }
  });

  it.each([
    ['too short', 'a'.repeat(42)],
    ['too long', 'a'.repeat(44)],
    ['padding', `${'a'.repeat(42)}=`],
    ['standard base64 characters', `${'a'.repeat(42)}+`],
    ['empty', ''],
    ['non-string', 42],
    ['undefined', undefined],
  ])('rejects %s as malformed', (_label, value) => {
    expect(isWellFormedToken(value)).toBe(false);
  });

  it('hashes to lowercase SHA-256 hex (64 chars), deterministically', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const token = generateOpaqueToken();
    expect(sha256Hex(token)).toBe(sha256Hex(token));
    expect(sha256Hex(token)).not.toContain(token);
  });

  it('tokensMatch: equal well-formed tokens only', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(tokensMatch(a, a)).toBe(true);
    expect(tokensMatch(a, b)).toBe(false);
    expect(tokensMatch(a, undefined)).toBe(false);
    expect(tokensMatch(undefined, undefined)).toBe(false);
    expect(tokensMatch('short', 'short')).toBe(false);
    expect(tokensMatch(a, [a])).toBe(false);
  });
});
