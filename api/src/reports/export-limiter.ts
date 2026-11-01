import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

/**
 * At most REPORT max-concurrent CSV exports stream at once in this process (default 2): each holds one
 * read-only transaction (one pooled connection of 5) while it streams, so unbounded exports would starve
 * every other request. In memory: one API instance only (like the import parse limiter).
 */
@Injectable()
export class ExportLimiter {
  private running = 0;

  constructor(private readonly config: AppConfigService) {}

  /** Exports streaming now. */
  get active(): number {
    return this.running;
  }

  /** A release function when a slot is free (call it exactly once; extra calls are ignored), else null. */
  tryAcquire(): (() => void) | null {
    if (this.running >= this.config.reportMaxConcurrentExports) return null;
    this.running += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running -= 1;
    };
  }
}
