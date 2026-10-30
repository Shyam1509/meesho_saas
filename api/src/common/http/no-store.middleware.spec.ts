import type { IncomingMessage, ServerResponse } from 'node:http';
import { noStoreMiddleware } from './no-store.middleware';

describe('noStoreMiddleware', () => {
  it('sets Cache-Control: no-store and continues', () => {
    const setHeader = jest.fn();
    const next = jest.fn();

    noStoreMiddleware(
      {} as IncomingMessage,
      { setHeader } as unknown as ServerResponse,
      next,
    );

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
