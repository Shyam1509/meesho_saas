import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception';

/** Uploads parsed at the same time, process-wide (parsing is CPU and memory heavy). */
export const MAX_CONCURRENT_PARSES = 2;
export const IMPORTS_BUSY_MESSAGE = 'Imports are busy, try again in a moment';

/**
 * Process-wide limit on concurrent upload parses: beyond MAX_CONCURRENT_PARSES a request is refused at
 * once with 429 RATE_LIMITED instead of queueing (in memory: one API instance, like the rate limiters).
 */
@Injectable()
export class ImportParseLimiter {
  private active = 0;
  private readonly max = MAX_CONCURRENT_PARSES;

  get running(): number {
    return this.active;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      throw new ApiException('RATE_LIMITED', IMPORTS_BUSY_MESSAGE);
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
    }
  }
}
