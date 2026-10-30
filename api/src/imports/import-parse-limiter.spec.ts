import { ApiException } from '../common/errors/api.exception';
import {
  IMPORTS_BUSY_MESSAGE,
  ImportParseLimiter,
  MAX_CONCURRENT_PARSES,
} from './import-parse-limiter';

describe('ImportParseLimiter', () => {
  it('runs at most 2 parses at once; a third is refused with 429 RATE_LIMITED, not queued', async () => {
    expect(MAX_CONCURRENT_PARSES).toBe(2);
    const limiter = new ImportParseLimiter();
    const releases: (() => void)[] = [];
    const hold = () =>
      limiter.run(
        () =>
          new Promise<string>((resolve) =>
            releases.push(() => resolve('done')),
          ),
      );
    const first = hold();
    const second = hold();
    expect(limiter.running).toBe(2);

    const third = limiter.run(() => Promise.resolve('never'));
    await expect(third).rejects.toEqual(
      new ApiException('RATE_LIMITED', IMPORTS_BUSY_MESSAGE),
    );
    await expect(third).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    releases.forEach((release) => release());
    await expect(Promise.all([first, second])).resolves.toEqual([
      'done',
      'done',
    ]);
    expect(limiter.running).toBe(0);
    await expect(limiter.run(() => Promise.resolve(1))).resolves.toBe(1);
  });

  it('frees the slot when the work fails', async () => {
    const limiter = new ImportParseLimiter();
    await expect(
      limiter.run(() => Promise.reject(new Error('bad file'))),
    ).rejects.toThrow('bad file');
    expect(limiter.running).toBe(0);
  });
});
