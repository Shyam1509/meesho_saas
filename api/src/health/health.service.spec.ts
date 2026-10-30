import { Logger } from '@nestjs/common';
import type { Sequelize } from 'sequelize-typescript';
import { DB_CHECK_TIMEOUT_MS, HealthService } from './health.service';

describe('HealthService', () => {
  let authenticate: jest.Mock;
  let service: HealthService;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    authenticate = jest.fn();
    service = new HealthService({ authenticate } as unknown as Sequelize);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  it('reports ok / db up when authenticate resolves', async () => {
    authenticate.mockResolvedValue(undefined);

    const result = await service.check();

    expect(result.status).toBe('ok');
    expect(result.db).toBe('up');
    expect(Number.isInteger(result.uptimeSeconds)).toBe(true);
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    expect(authenticate).toHaveBeenCalledWith({ logging: false });
  });

  it('reports degraded / db down when authenticate rejects', async () => {
    authenticate.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await service.check();

    expect(result).toEqual(
      expect.objectContaining({ status: 'degraded', db: 'down' }),
    );
    expect(warnSpy).toHaveBeenCalled();
  });

  it('reports degraded / db down when authenticate hangs past the timeout', async () => {
    jest.useFakeTimers();
    authenticate.mockReturnValue(new Promise(() => undefined));

    const pending = service.check();
    await jest.advanceTimersByTimeAsync(DB_CHECK_TIMEOUT_MS);
    const result = await pending;

    expect(result.status).toBe('degraded');
    expect(result.db).toBe('down');
  });

  it('bounds the DB check at about 2 seconds', () => {
    expect(DB_CHECK_TIMEOUT_MS).toBe(2000);
  });
});
