import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { HealthResponseDto } from './dto/health-response.dto';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

function result(status: 'ok' | 'degraded'): HealthResponseDto {
  return {
    status,
    db: status === 'ok' ? 'up' : 'down',
    uptimeSeconds: 7,
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

describe('HealthController (HTTP status, stubbed service)', () => {
  let app: INestApplication | undefined;
  const check = jest.fn<Promise<HealthResponseDto>, []>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { check } }],
    }).compile();
    const nestApp = moduleRef.createNestApplication({ logger: false });
    await nestApp.init();
    app = nestApp;
  });

  afterAll(async () => {
    await app?.close();
  });

  function server(): Server {
    if (!app) throw new Error('app not initialised');
    return app.getHttpServer() as Server;
  }

  it('keeps 200 for an ok result', async () => {
    check.mockResolvedValueOnce(result('ok'));
    const res = await request(server()).get('/health').expect(200);
    expect(res.body).toEqual(result('ok'));
  });

  it('sets 503 for a degraded result', async () => {
    check.mockResolvedValueOnce(result('degraded'));
    const res = await request(server()).get('/health').expect(503);
    expect(res.body).toEqual(result('degraded'));
  });
});
