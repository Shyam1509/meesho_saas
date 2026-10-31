import * as argon2 from 'argon2';
import { PasswordHasherService } from './password-hasher.service';

/**
 * Real Argon2id at the production cost (64 MiB, t=3, p=4): one hash or verify takes ~0.2–1 s and several
 * times that when the machine is busy (parallel suites, other builds). Each Argon2 step gets its own
 * generous timeout so a slow machine never fails the suite; the assertions are unchanged.
 */
const ARGON2_TIMEOUT_MS = 60_000;

describe('PasswordHasherService', () => {
  const hasher = new PasswordHasherService();
  const password = 'correct horse battery staple';
  let hash: string;

  beforeAll(async () => {
    hash = await hasher.hash(password);
  }, ARGON2_TIMEOUT_MS);

  it('produces an Argon2id hash with m=64 MiB, t=3, p=4 that does not contain the password', () => {
    const [, algorithm, version, params] = hash.split('$');
    expect([algorithm, version]).toEqual(['argon2id', 'v=19']);
    expect(params.split(',').sort()).toEqual(['m=65536', 'p=4', 't=3']);
    expect(hash).not.toContain(password);
  });

  it(
    'salts: hashing the same password twice gives different hashes',
    async () => {
      expect(await hasher.hash(password)).not.toBe(hash);
    },
    ARGON2_TIMEOUT_MS,
  );

  it(
    'verifies the right password and rejects others',
    async () => {
      expect(await hasher.verify(hash, password)).toBe(true);
      expect(await hasher.verify(hash, `${password} `)).toBe(false);
      expect(await hasher.verify(hash, 'Correct horse battery staple')).toBe(
        false,
      );
    },
    ARGON2_TIMEOUT_MS,
  );

  it('returns false (never throws) for a malformed stored hash', async () => {
    await expect(hasher.verify('not-a-hash', password)).resolves.toBe(false);
  });

  it(
    'needsRehash: false for current parameters, true for weaker ones or garbage',
    async () => {
      expect(hasher.needsRehash(hash)).toBe(false);
      const weak = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      });
      expect(hasher.needsRehash(weak)).toBe(true);
      expect(hasher.needsRehash('garbage')).toBe(true);
    },
    ARGON2_TIMEOUT_MS,
  );

  it(
    'verifyDummy completes without revealing anything',
    async () => {
      await hasher.onModuleInit();
      await expect(hasher.verifyDummy(password)).resolves.toBeUndefined();
    },
    ARGON2_TIMEOUT_MS,
  );
});
