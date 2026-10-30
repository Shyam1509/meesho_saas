import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfigService } from '../src/config/app-config.service';

/**
 * Runs against the real test database: NODE_ENV=test (set by the test:e2e script)
 * makes the config load .env.test → meesho_test.
 */
describe('API foundation (e2e)', () => {
  let app: NestExpressApplication | undefined;
  let server: Server;

  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error(
        'e2e tests must run with NODE_ENV=test (use npm run test:e2e)',
      );
    }
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const nestApp = moduleRef.createNestApplication<NestExpressApplication>({
      bufferLogs: true,
    });
    app = nestApp;
    configureApp(nestApp);
    await nestApp.init();
    server = nestApp.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/health → 200 with db up', async () => {
    const res = await request(server).get('/api/v1/health').expect(200);

    expect(res.body).toEqual({
      status: 'ok',
      db: 'up',
      uptimeSeconds: expect.any(Number) as number,
      timestamp: expect.any(String) as string,
    });
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS: allowed origin gets credentials + exposed x-request-id; others get no allow-origin', async () => {
    if (!app) throw new Error('app not initialised');
    // Whatever the test environment configures (default http://localhost:4310).
    const origin = app.get(AppConfigService).corsOrigins[0];
    const allowed = await request(server)
      .get('/api/v1/health')
      .set('Origin', origin)
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(origin);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowed.headers['access-control-expose-headers']).toBe(
      'x-request-id',
    );

    const denied = await request(server)
      .get('/api/v1/health')
      .set('Origin', 'http://evil.example')
      .expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('unknown route → 404 error envelope with a requestId', async () => {
    const res = await request(server).get('/api/v1/does-not-exist').expect(404);

    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String) as string,
        requestId: expect.any(String) as string,
      },
    });
    const body = res.body as { error: { requestId: string } };
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('echoes a supplied valid x-request-id', async () => {
    const res = await request(server)
      .get('/api/v1/health')
      .set('x-request-id', 'e2e-check-0001')
      .expect(200);

    expect(res.headers['x-request-id']).toBe('e2e-check-0001');
  });

  it('replaces a malformed x-request-id and uses it in the error envelope', async () => {
    const res = await request(server)
      .get('/api/v1/nope')
      .set('x-request-id', 'bad id!')
      .expect(404);

    const id = res.headers['x-request-id'];
    expect(id).not.toBe('bad id!');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((res.body as { error: { requestId: string } }).error.requestId).toBe(
      id,
    );
  });

  it('GET /api/docs-json → OpenAPI document containing the health path', async () => {
    const res = await request(server).get('/api/docs-json').expect(200);
    const doc = res.body as { openapi: string; paths: Record<string, unknown> };

    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toContain('/api/v1/health');
  });
});
