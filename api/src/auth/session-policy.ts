/** last_used_at is written at most this often, so an active session costs about one write per 5 minutes. */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionPolicy {
  /** Session ends after this long without a request (measured from last_used_at). */
  idleMs: number;
  /** Session ends this long after creation, however active. */
  absoluteMs: number;
}

export type SessionState =
  'active' | 'revoked' | 'idle_expired' | 'absolute_expired';

export interface SessionTimes {
  lastUsedAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

export function sessionPolicy(
  idleMinutes: number,
  absoluteHours: number,
): SessionPolicy {
  return {
    idleMs: idleMinutes * 60 * 1000,
    absoluteMs: absoluteHours * 60 * 60 * 1000,
  };
}

/**
 * Whether a session row may still authenticate at `now`. Because last_used_at is only touched every
 * SESSION_TOUCH_INTERVAL_MS, the idle timeout can end a session up to that much early, never late.
 */
export function sessionState(
  session: SessionTimes,
  now: Date,
  policy: SessionPolicy,
): SessionState {
  if (session.revokedAt !== null) return 'revoked';
  if (now.getTime() >= session.absoluteExpiresAt.getTime()) {
    return 'absolute_expired';
  }
  if (now.getTime() - session.lastUsedAt.getTime() >= policy.idleMs) {
    return 'idle_expired';
  }
  return 'active';
}

/** True when last_used_at is old enough to be refreshed on this request. */
export function needsTouch(lastUsedAt: Date, now: Date): boolean {
  return now.getTime() - lastUsedAt.getTime() >= SESSION_TOUCH_INTERVAL_MS;
}

export function absoluteExpiry(now: Date, policy: SessionPolicy): Date {
  return new Date(now.getTime() + policy.absoluteMs);
}

/** Sessions last used at or before this instant are idle-expired. */
export function idleCutoff(now: Date, policy: SessionPolicy): Date {
  return new Date(now.getTime() - policy.idleMs);
}
