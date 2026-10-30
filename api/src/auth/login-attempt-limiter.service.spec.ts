import {
  FAILED_LOGIN_WINDOW_MS,
  FailureCounter,
  LoginAttemptLimiter,
  MAX_FAILED_LOGINS_PER_EMAIL,
  MAX_FAILED_LOGINS_PER_IP,
} from './login-attempt-limiter.service';

const T0 = 1_800_000_000_000;
const EMAIL = 'asha@example.test';
const IP_A = '203.0.113.10';
const IP_B = '203.0.113.20';

describe('LoginAttemptLimiter', () => {
  let limiter: LoginAttemptLimiter;

  beforeEach(() => {
    limiter = new LoginAttemptLimiter();
  });

  function fail(
    times: number,
    ip: string | undefined = IP_A,
    email = EMAIL,
    now = T0,
  ): void {
    for (let i = 0; i < times; i += 1) limiter.recordFailure(email, ip, now);
  }

  it('limits: 5 per (email, IP), 50 per email', () => {
    expect([MAX_FAILED_LOGINS_PER_IP, MAX_FAILED_LOGINS_PER_EMAIL]).toEqual([
      5, 50,
    ]);
  });

  it('5 failures from one IP block that pair only: the same email from another IP still gets through', () => {
    fail(4);
    expect(limiter.retryAfterSeconds(EMAIL, IP_A, T0)).toBeNull();
    fail(1);
    expect(limiter.retryAfterSeconds(EMAIL, IP_A, T0)).toBe(15 * 60);
    expect(limiter.retryAfterSeconds(EMAIL, IP_B, T0)).toBeNull();
    expect(
      limiter.retryAfterSeconds('other@example.test', IP_A, T0),
    ).toBeNull();
  });

  it('50 failures from many IPs block the email from every IP, including a fresh one', () => {
    for (let i = 0; i < 10; i += 1) fail(5, `198.51.100.${i}`);
    expect(limiter.retryAfterSeconds(EMAIL, IP_B, T0)).toBe(15 * 60);
    expect(
      limiter.retryAfterSeconds('other@example.test', IP_B, T0),
    ).toBeNull();
  });

  it('49 failures across IPs do not block a fresh IP', () => {
    for (let i = 0; i < 9; i += 1) fail(5, `198.51.100.${i}`);
    fail(4, '198.51.100.9');
    expect(limiter.retryAfterSeconds(EMAIL, IP_B, T0)).toBeNull();
  });

  it('a success clears its own pair but not other pairs or the account-wide count', () => {
    fail(5, IP_A);
    fail(5, IP_B);
    limiter.recordSuccess(EMAIL, IP_B);
    expect(limiter.retryAfterSeconds(EMAIL, IP_B, T0)).toBeNull();
    expect(limiter.retryAfterSeconds(EMAIL, IP_A, T0)).toBe(15 * 60);

    // Account-wide: 10 so far; 40 more from other IPs reach 50 despite the success.
    for (let i = 0; i < 8; i += 1) fail(5, `198.51.100.${i}`);
    expect(limiter.retryAfterSeconds(EMAIL, IP_B, T0)).toBe(15 * 60);
  });

  it('blocks lift when the window that started at the first failure ends', () => {
    fail(1, IP_A, EMAIL, T0);
    fail(4, IP_A, EMAIL, T0 + 10 * 60_000);
    expect(limiter.retryAfterSeconds(EMAIL, IP_A, T0 + 10 * 60_000)).toBe(
      5 * 60,
    );
    expect(
      limiter.retryAfterSeconds(EMAIL, IP_A, T0 + FAILED_LOGIN_WINDOW_MS - 1),
    ).toBe(1);
    expect(
      limiter.retryAfterSeconds(EMAIL, IP_A, T0 + FAILED_LOGIN_WINDOW_MS),
    ).toBeNull();
  });

  it('groups IPs like the throttler: IPv4-mapped = IPv4, one IPv6 /64 = one client', () => {
    fail(5, '::ffff:203.0.113.10');
    expect(limiter.retryAfterSeconds(EMAIL, IP_A, T0)).not.toBeNull();

    fail(3, '2001:db8:1:2::1');
    fail(2, '2001:db8:1:2:ffff::9');
    expect(
      limiter.retryAfterSeconds(EMAIL, '2001:db8:1:2::77', T0),
    ).not.toBeNull();
    expect(limiter.retryAfterSeconds(EMAIL, '2001:db8:1:3::1', T0)).toBeNull();
  });

  it('an unknown client IP is still limited (as one shared "unknown" client)', () => {
    for (let i = 0; i < 5; i += 1) limiter.recordFailure(EMAIL, undefined, T0);
    expect(limiter.retryAfterSeconds(EMAIL, '', T0)).not.toBeNull();
    expect(limiter.retryAfterSeconds(EMAIL, IP_A, T0)).toBeNull();
  });
});

describe('FailureCounter (memory bound and eviction)', () => {
  it('never holds more than maxKeys entries', () => {
    const counter = new FailureCounter(5, 3);
    for (let i = 0; i < 10; i += 1) counter.record(`k${i}`, T0);
    expect(counter.size).toBe(3);
  });

  it('drops expired windows before evicting live ones', () => {
    const counter = new FailureCounter(5, 2);
    const later = T0 + FAILED_LOGIN_WINDOW_MS;
    counter.record('old', T0);
    counter.record('victim', later - 1000);
    counter.record('new', later); // 'old' has expired and makes room
    expect(counter.size).toBe(2);
    for (let i = 0; i < 4; i += 1) counter.record('victim', later);
    expect(counter.retryAfterMs('victim', later)).not.toBeNull();
  });

  it('a flood of fresh keys evicts the flood itself, not a victim with more failures', () => {
    const counter = new FailureCounter(5, 3);
    for (let i = 0; i < 4; i += 1) counter.record('victim', T0);
    for (let i = 0; i < 1000; i += 1) counter.record(`flood${i}`, T0);
    counter.record('victim', T0);
    expect(counter.retryAfterMs('victim', T0)).toBe(FAILED_LOGIN_WINDOW_MS);
  });

  it('never evicts a blocked entry; when all are blocked a new key is not tracked', () => {
    const counter = new FailureCounter(2, 2);
    for (const key of ['a', 'b']) {
      counter.record(key, T0);
      counter.record(key, T0);
    }
    expect(counter.record('c', T0)).toBe(false);
    expect(counter.size).toBe(2);
    expect(counter.retryAfterMs('a', T0)).not.toBeNull();
    expect(counter.retryAfterMs('b', T0)).not.toBeNull();
    expect(counter.retryAfterMs('c', T0)).toBeNull();
  });
});
