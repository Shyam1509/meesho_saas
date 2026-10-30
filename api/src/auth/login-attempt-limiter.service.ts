import { Injectable, Logger } from '@nestjs/common';
import { normalizeIp } from '@nestjs/throttler';

/** Both counters use fixed 15-minute windows that start at the first failure. */
export const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Failures allowed per (normalised email, client IP) per window; that pair's next attempt gets 429. */
export const MAX_FAILED_LOGINS_PER_IP = 5;
/** Failures allowed per normalised email from all IPs together per window: bounds distributed guessing. */
export const MAX_FAILED_LOGINS_PER_EMAIL = 50;
/** Memory bounds: the most (email, IP) pairs and emails tracked at once. */
export const MAX_TRACKED_PAIRS = 50_000;
export const MAX_TRACKED_EMAILS = 20_000;

interface FailureWindow {
  count: number;
  windowStart: number;
}

/**
 * Bounded map of fixed-window failure counts. When full it first drops expired windows, then evicts the
 * not-yet-blocked entry with the FEWEST failures (oldest first on ties). A blocked entry is never evicted
 * before its window ends; if every entry is blocked, a new key is simply not tracked (record() → false).
 * Flooding the table with fresh keys therefore evicts the flood's own count-1 entries first, not a victim's
 * counter that is closer to (or at) the limit.
 */
export class FailureCounter {
  private readonly windows = new Map<string, FailureWindow>();

  constructor(
    readonly limit: number,
    readonly maxKeys: number,
    readonly windowMs: number = FAILED_LOGIN_WINDOW_MS,
  ) {}

  /** Milliseconds until `key` may try again, or null when it is not blocked. */
  retryAfterMs(key: string, now: number): number | null {
    const window = this.current(key, now);
    if (!window || window.count < this.limit) return null;
    return window.windowStart + this.windowMs - now;
  }

  /** Counts one failure. False when the table is full of blocked keys and `key` could not be tracked. */
  record(key: string, now: number): boolean {
    const window = this.current(key, now);
    if (window) {
      window.count += 1;
      return true;
    }
    if (!this.makeRoom(now)) return false;
    this.windows.set(key, { count: 1, windowStart: now });
    return true;
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  get size(): number {
    return this.windows.size;
  }

  private current(key: string, now: number): FailureWindow | undefined {
    const window = this.windows.get(key);
    if (window && now - window.windowStart >= this.windowMs) {
      this.windows.delete(key);
      return undefined;
    }
    return window;
  }

  private makeRoom(now: number): boolean {
    if (this.windows.size < this.maxKeys) return true;
    for (const [key, window] of this.windows) {
      if (now - window.windowStart >= this.windowMs) this.windows.delete(key);
    }
    if (this.windows.size < this.maxKeys) return true;

    let victim: string | undefined;
    let fewest = Infinity;
    for (const [key, window] of this.windows) {
      if (window.count < this.limit && window.count < fewest) {
        victim = key;
        fewest = window.count;
      }
    }
    if (victim === undefined) return false;
    this.windows.delete(victim);
    return true;
  }
}

/**
 * Failed-login limiter, applied whether or not the email belongs to an account (so it reveals nothing):
 * - per (normalised email, client IP): 5 failures / 15 min block that pair only, so a stranger guessing
 *   from one IP cannot lock the real user out from their own IP;
 * - per normalised email: 50 failures / 15 min from all IPs together block the email everywhere.
 * A successful login clears its pair's counter. The account-wide counter is NOT cleared by a success: it
 * caps the guesses an account can receive per window, so a login must not hand out fresh guesses; it only
 * ages out with its window.
 * IPs are grouped like the per-IP throttler (IPv4-mapped IPv6 → IPv4, IPv6 → its /64).
 * In memory: correct for a single API instance only (a shared store is a Milestone 9 decision).
 */
@Injectable()
export class LoginAttemptLimiter {
  private readonly logger = new Logger(LoginAttemptLimiter.name);
  private readonly pairs = new FailureCounter(
    MAX_FAILED_LOGINS_PER_IP,
    MAX_TRACKED_PAIRS,
  );
  private readonly emails = new FailureCounter(
    MAX_FAILED_LOGINS_PER_EMAIL,
    MAX_TRACKED_EMAILS,
  );
  private lastFullWarning = 0;

  /** Seconds until this email may try again from this IP, or null when it is not blocked. */
  retryAfterSeconds(
    email: string,
    ip: string | undefined,
    now = Date.now(),
  ): number | null {
    const waits = [
      this.pairs.retryAfterMs(pairKey(email, ip), now),
      this.emails.retryAfterMs(email, now),
    ].filter((ms): ms is number => ms !== null);
    if (waits.length === 0) return null;
    return Math.max(1, Math.ceil(Math.max(...waits) / 1000));
  }

  recordFailure(email: string, ip: string | undefined, now = Date.now()): void {
    const pairTracked = this.pairs.record(pairKey(email, ip), now);
    const emailTracked = this.emails.record(email, now);
    if (
      (!pairTracked || !emailTracked) &&
      now - this.lastFullWarning > 60_000
    ) {
      this.lastFullWarning = now;
      this.logger.warn(
        { event: 'auth.login_limiter_full' },
        'Failed-login limiter is full of blocked entries; new keys are not tracked',
      );
    }
  }

  /** Successful login: clears this (email, IP) pair; the account-wide counter keeps running. */
  recordSuccess(email: string, ip: string | undefined): void {
    this.pairs.reset(pairKey(email, ip));
  }
}

/** Emails are printable ASCII without spaces (see the DTOs), so a space cannot be forged into the key. */
function pairKey(email: string, ip: string | undefined): string {
  return `${normalizeIp(ip || 'unknown')} ${email}`;
}
