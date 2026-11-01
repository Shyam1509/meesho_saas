import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { AppConfigService } from '../config/app-config.service';
import { ClientGoneError, CsvResponseWriter } from './csv-response';
import { ExportLimiter } from './export-limiter';

/** A response whose socket buffer is always full (write → false) until told otherwise. */
class FakeResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  accept = false;
  written: string[] = [];
  write(chunk: string): boolean {
    this.written.push(chunk);
    return this.accept;
  }
  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
  end(): void {
    this.writableEnded = true;
  }
}

const writerFor = (res: FakeResponse, stallMs: number) =>
  new CsvResponseWriter(res as unknown as Response, stallMs);

describe('CsvResponseWriter backpressure', () => {
  it('waits for drain, then continues', async () => {
    const res = new FakeResponse();
    const pending = writerFor(res, 1000).write('a');
    res.emit('drain');
    await expect(pending).resolves.toBeUndefined();
    expect(res.listenerCount('drain')).toBe(0);
    expect(res.listenerCount('close')).toBe(0);
  });

  it('a client that accepts nothing for the stall timeout is cut off: response destroyed, ClientGoneError', async () => {
    const res = new FakeResponse();
    const started = Date.now();
    await expect(writerFor(res, 50).write('a')).rejects.toBeInstanceOf(
      ClientGoneError,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    expect(res.destroyed).toBe(true);
    expect(res.listenerCount('drain')).toBe(0);
  });

  it('a client that closes while we wait rejects at once; a gone client is refused before writing', async () => {
    const res = new FakeResponse();
    const pending = writerFor(res, 60_000).write('a');
    res.emit('close');
    await expect(pending).rejects.toBeInstanceOf(ClientGoneError);
    res.accept = true;
    await expect(writerFor(res, 60_000).write('b')).resolves.toBeUndefined();
    res.destroyed = true;
    await expect(writerFor(res, 60_000).write('c')).rejects.toBeInstanceOf(
      ClientGoneError,
    );
    expect(res.written).toEqual(['a', 'b']);
  });
});

describe('ExportLimiter', () => {
  it('hands out at most the configured number of slots; a release frees one, twice is harmless', () => {
    const limiter = new ExportLimiter({
      reportMaxConcurrentExports: 2,
    } as AppConfigService);
    const first = limiter.tryAcquire();
    const second = limiter.tryAcquire();
    expect([first, second].every((r) => typeof r === 'function')).toBe(true);
    expect(limiter.tryAcquire()).toBeNull();
    expect(limiter.active).toBe(2);
    first?.();
    first?.();
    expect(limiter.active).toBe(1);
    expect(limiter.tryAcquire()).not.toBeNull();
    expect(limiter.tryAcquire()).toBeNull();
  });
});
