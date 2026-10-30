import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfigService } from '../config/app-config.service';

/**
 * Name of the throttler that ThrottlerGuard applies on POST /auth/login and POST /auth/register. Kept as
 * 'default' because any other name is appended to the response headers (Retry-After-<name>, ...).
 */
export const AUTH_THROTTLER = 'default';
export const RATE_LIMITED_MESSAGE =
  'Too many requests. Please try again later.';

/**
 * AUTH_RATE_LIMIT_PER_MINUTE requests per client IP per minute, counted separately for login and
 * register. ThrottlerGuard is applied only on those two routes (not globally). In-memory storage: one
 * API instance only; without 'trust proxy' the IP is the socket peer (deployment decision, M9).
 */
export function authThrottlerOptions(
  config: AppConfigService,
): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: AUTH_THROTTLER,
        ttl: 60_000,
        limit: config.authRateLimitPerMinute,
      },
    ],
    errorMessage: RATE_LIMITED_MESSAGE,
  };
}
