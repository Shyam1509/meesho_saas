import type { Response } from 'express';

/** The client went away (or stalled) mid-export: stop reading (the snapshot rolls back), send nothing more. */
export class ClientGoneError extends Error {
  constructor(reason = 'The client closed the connection during a CSV export') {
    super(reason);
    this.name = 'ClientGoneError';
  }
}

/**
 * Streams a CSV download to an Express response with backpressure: a chunk that fills the socket buffer
 * waits for 'drain'. It never waits forever (that would hold the read transaction and its pooled
 * connection): a closed connection rejects at once, and a client that accepts no data for `stallTimeoutMs`
 * has its response destroyed and rejects with ClientGoneError. Cache-Control: no-store is already set on
 * every API response (noStoreMiddleware).
 */
export class CsvResponseWriter {
  constructor(
    private readonly res: Response,
    private readonly stallTimeoutMs: number,
  ) {}

  /**
   * Status 200 and the download headers. `contentDisposition` is built by csvContentDisposition (an ASCII
   * `filename=` plus an RFC 5987 `filename*=`), so it never carries a raw user string.
   */
  start(contentDisposition: string): void {
    this.res.status(200);
    this.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    this.res.setHeader('Content-Disposition', contentDisposition);
    this.res.setHeader('X-Content-Type-Options', 'nosniff');
  }

  async write(chunk: string): Promise<void> {
    if (chunk === '') return;
    if (this.res.destroyed || this.res.writableEnded) {
      throw new ClientGoneError();
    }
    if (!this.res.write(chunk, 'utf8')) await this.drained();
  }

  end(): void {
    this.res.end();
  }

  private drained(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.res.off('drain', onDrain);
        this.res.off('close', onClose);
      };
      const onDrain = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new ClientGoneError());
      };
      const timer = setTimeout(() => {
        cleanup();
        // The client stopped reading: cut the connection so the transaction and its connection are freed.
        this.res.destroy();
        reject(
          new ClientGoneError(
            'The client accepted no data for too long during a CSV export',
          ),
        );
      }, this.stallTimeoutMs);
      this.res.once('drain', onDrain);
      this.res.once('close', onClose);
      if (this.res.destroyed) onClose();
    });
  }
}
