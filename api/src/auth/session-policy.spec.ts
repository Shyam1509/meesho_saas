import {
  absoluteExpiry,
  idleCutoff,
  needsTouch,
  SESSION_TOUCH_INTERVAL_MS,
  sessionPolicy,
  sessionState,
  type SessionTimes,
} from './session-policy';

const MIN = 60_000;
const HOUR = 60 * MIN;
const policy = sessionPolicy(720, 168);
const created = new Date('2026-10-30T00:00:00.000Z');
const at = (ms: number) => new Date(created.getTime() + ms);

function session(overrides: Partial<SessionTimes> = {}): SessionTimes {
  return {
    lastUsedAt: created,
    absoluteExpiresAt: absoluteExpiry(created, policy),
    revokedAt: null,
    ...overrides,
  };
}

describe('session policy', () => {
  it('converts minutes/hours to milliseconds', () => {
    expect(policy).toEqual({ idleMs: 12 * HOUR, absoluteMs: 168 * HOUR });
  });

  it('active until the idle timeout, idle-expired exactly at it', () => {
    expect(sessionState(session(), at(12 * HOUR - 1), policy)).toBe('active');
    expect(sessionState(session(), at(12 * HOUR), policy)).toBe('idle_expired');
  });

  it('a recently used session stays active past the first idle window', () => {
    const used = session({ lastUsedAt: at(11 * HOUR) });
    expect(sessionState(used, at(20 * HOUR), policy)).toBe('active');
  });

  it('absolute expiry wins even for a session used a second ago', () => {
    const busy = session({ lastUsedAt: at(168 * HOUR - 1000) });
    expect(sessionState(busy, at(168 * HOUR - 1), policy)).toBe('active');
    expect(sessionState(busy, at(168 * HOUR), policy)).toBe('absolute_expired');
  });

  it('a revoked session is never active', () => {
    expect(sessionState(session({ revokedAt: at(1) }), at(2), policy)).toBe(
      'revoked',
    );
  });

  it('touches last_used_at at most every 5 minutes', () => {
    expect(SESSION_TOUCH_INTERVAL_MS).toBe(5 * MIN);
    expect(needsTouch(created, at(5 * MIN - 1))).toBe(false);
    expect(needsTouch(created, at(5 * MIN))).toBe(true);
  });

  it('idle cutoff and absolute expiry are relative to now', () => {
    expect(idleCutoff(at(12 * HOUR), policy)).toEqual(created);
    expect(absoluteExpiry(created, policy)).toEqual(at(168 * HOUR));
  });
});
